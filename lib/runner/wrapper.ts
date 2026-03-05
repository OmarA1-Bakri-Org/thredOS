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

/** Environment variables safe to pass to child processes */
const SAFE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'BUN_INSTALL',
  'THREADOS_BASE_PATH', 'THREADOS_MPROCS_PATH',
])

function getSafeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const safe: Record<string, string> = {}
  for (const key of Object.keys(process.env)) {
    if (SAFE_ENV_KEYS.has(key) || key.startsWith('THREADOS_')) {
      safe[key] = process.env[key]!
    }
  }
  // User-provided env vars are explicitly requested — pass them all through
  for (const key of Object.keys(extra)) {
    safe[key] = extra[key]
  }
  return safe as NodeJS.ProcessEnv
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
      env: getSafeEnv(env),
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
