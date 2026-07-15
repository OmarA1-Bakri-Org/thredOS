import { spawn, type ChildProcess } from 'child_process'
import { ProcessTimeoutError } from '../errors'

export interface RunnerConfig {
  stepId: string
  runId: string
  command: string
  args?: string[]
  cwd?: string
  timeout?: number // in milliseconds, default 30 minutes
  env?: Record<string, string>
}

export type RunStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'ERROR'

export interface RunResult {
  stepId: string
  runId: string
  exitCode: number | null
  status: RunStatus
  duration: number // in milliseconds
  stdout: string
  stderr: string
  startTime: Date
  endTime: Date
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/** Exact parent environment keys required for portable child execution. */
const INHERITED_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'BUN_INSTALL',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA',
] as const

const WINDOWS_ENVIRONMENT = process.platform === 'win32'

function environmentKeyIdentity(key: string): string {
  return WINDOWS_ENVIRONMENT ? key.toUpperCase() : key
}

const INHERITED_ENV_KEY_IDENTITIES = new Set(
  INHERITED_ENV_KEYS.map(environmentKeyIdentity),
)

/**
 * Build the environment for an agent process.
 *
 * Parent values cross the process boundary only through the exact portable
 * allowlist. Callers may add trusted, attempt-scoped grants explicitly; those
 * grants replace inherited values using the host platform's key semantics.
 */
export function buildExecutionEnv(
  inherited: NodeJS.ProcessEnv,
  granted: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv
  const outputKeys = new Map<string, string>()

  const replace = (key: string, value: string | undefined): void => {
    const identity = environmentKeyIdentity(key)
    const previousKey = outputKeys.get(identity)
    if (previousKey !== undefined) {
      delete result[previousKey]
      outputKeys.delete(identity)
    }
    if (value !== undefined) {
      result[key] = value
      outputKeys.set(identity, key)
    }
  }

  for (const [key, value] of Object.entries(inherited)) {
    if (INHERITED_ENV_KEY_IDENTITIES.has(environmentKeyIdentity(key)) && value !== undefined) {
      replace(key, value)
    }
  }

  for (const [key, value] of Object.entries(granted)) {
    replace(key, value)
  }

  return result
}

/**
 * Execute a step command with stdout/stderr capture and timeout handling
 *
 * @param config - The runner configuration
 * @returns The run result with captured output
 * @throws ProcessTimeoutError if the process exceeds the timeout
 */
export async function runStep(config: RunnerConfig): Promise<RunResult> {
  const {
    stepId,
    runId,
    command,
    args = [],
    cwd = process.cwd(),
    timeout = DEFAULT_TIMEOUT_MS,
    env = {},
  } = config

  const startTime = new Date()
  let stdout = ''
  let stderr = ''
  let graceTimer: NodeJS.Timeout | undefined
  let timedOut = false

  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(command, args, {
      cwd,
      shell: false,
      env: buildExecutionEnv(process.env, env),
    })

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      // Give it a moment to terminate gracefully
      graceTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 5000)

      reject(new ProcessTimeoutError(stepId, timeout))
    }, timeout)

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeoutId)
      if (graceTimer) {
        clearTimeout(graceTimer)
      }
      if (timedOut) return
      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      let status: RunStatus
      if (code === 0) {
        status = 'SUCCESS'
      } else if (code === null) {
        status = 'ERROR'
      } else {
        status = 'FAILED'
      }

      resolve({
        stepId,
        runId,
        exitCode: code,
        status,
        duration,
        stdout,
        stderr,
        startTime,
        endTime,
      })
    })

    proc.on('error', (error) => {
      clearTimeout(timeoutId)
      if (graceTimer) {
        clearTimeout(graceTimer)
      }
      if (timedOut) return
      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      resolve({
        stepId,
        runId,
        exitCode: null,
        status: 'ERROR',
        duration,
        stdout,
        stderr: stderr + '\n' + error.message,
        startTime,
        endTime,
      })
    })
  })
}
