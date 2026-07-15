import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ProcessTimeoutError } from '../errors'
import { assertValidExecutablePayload, sha256Bytes } from '../policy/executable'
import type { ExecutablePayload } from '../policy/schema'

export interface RunnerConfig {
  stepId: string
  runId: string
  command: string
  args?: string[]
  cwd?: string
  timeout?: number // in milliseconds, default 30 minutes
  env?: Record<string, string>
  executablePayload?: ExecutablePayload
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

type BeforeExecutableSpawnHook = (context: { scriptPath: string }) => Promise<void> | void
let beforeExecutableSpawnHookForTests: BeforeExecutableSpawnHook | null = null

export function setBeforeExecutableSpawnHookForTests(hook: BeforeExecutableSpawnHook | null): void {
  beforeExecutableSpawnHookForTests = hook
}

interface MaterializedLaunch {
  command: string
  args: string[]
  cwd: string
  cleanup: () => Promise<void>
}

async function materializeLaunch(config: RunnerConfig): Promise<MaterializedLaunch> {
  const payload = config.executablePayload ?? {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd ?? process.cwd(),
  }
  assertValidExecutablePayload(payload)
  if (!payload.script) {
    return { ...payload, cleanup: async () => {} }
  }

  const expectedHash = sha256Bytes(payload.script.content)
  if (payload.script.sha256 !== undefined && payload.script.sha256 !== expectedHash) {
    throw new Error('Executable script hash does not match approved bytes')
  }

  const scriptPath = join(tmpdir(), `threados-script-${config.stepId}-${randomUUID()}.tmp`)
  await writeFile(scriptPath, payload.script.content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
  const cleanup = async (): Promise<void> => {
    await unlink(scriptPath).catch(() => {})
  }

  try {
    await beforeExecutableSpawnHookForTests?.({ scriptPath })
    const actualHash = sha256Bytes(await readFile(scriptPath))
    if (actualHash !== expectedHash) {
      throw new Error('Executable script hash mismatch immediately before spawn')
    }
    return {
      command: payload.command,
      args: [scriptPath, ...payload.args],
      cwd: payload.cwd,
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

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
  const launch = await materializeLaunch(config)
  const {
    stepId,
    runId,
    timeout = DEFAULT_TIMEOUT_MS,
    env = {},
  } = config

  const startTime = new Date()
  let stdout = ''
  let stderr = ''
  let graceTimer: NodeJS.Timeout | undefined
  let timedOut = false

  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
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
      void launch.cleanup()
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
      void launch.cleanup()
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
      void launch.cleanup()
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
