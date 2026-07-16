import { randomUUID } from 'crypto'
import { readFile, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ProcessTimeoutError } from '../errors'
import { assertValidExecutablePayload, sha256Bytes } from '../policy/executable'
import type { ExecutablePayload } from '../policy/schema'
import {
  createRunningProcessHandle,
  ProcessSpawnError,
  type ProcessHeartbeatEvent,
  type ProcessOutputEvent,
  type RawProcessResult,
  type RunningProcessHandle,
} from './process-handle'

export {
  ProcessCallbackError,
  ProcessControlError,
  ProcessSpawnError,
  resolveWindowsTaskkillPath,
  setProcessTerminationHookForTests,
  setWindowsTaskkillCommandHookForTests,
  type ProcessControlResult,
  type ProcessHeartbeatEvent,
  type ProcessOutputEvent,
  type ProcessSignal,
  type RawProcessResult,
  type RunningProcessHandle,
} from './process-handle'

export interface RunnerConfig {
  stepId: string
  runId: string
  command: string
  args?: string[]
  cwd?: string
  timeout?: number // in milliseconds, default 30 minutes
  env?: Record<string, string>
  executablePayload?: ExecutablePayload
  processId?: string
  cancellationGraceMs?: number
  forceKillWaitMs?: number
  maxOutputBytes?: number
  callbackThrottleMs?: number
  heartbeatIntervalMs?: number
  onOutput?: (event: ProcessOutputEvent) => Promise<void> | void
  onHeartbeat?: (event: ProcessHeartbeatEvent) => Promise<void> | void
}

export type RunStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'ERROR'
export interface RunResult {
  stepId: string
  runId: string
  exitCode: number | null
  status: RunStatus
  duration: number
  stdout: string
  stderr: string
  startTime: Date
  endTime: Date
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const DEFAULT_CANCELLATION_GRACE_MS = 5_000
const DEFAULT_FORCE_KILL_WAIT_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_CALLBACK_THROTTLE_MS = 250
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000

function toCompatibilityResult(result: RawProcessResult): RunResult {
  const { signal: _signal, status, ...compatibilityResult } = result
  return {
    ...compatibilityResult,
    status: status === 'CANCELLED' ? 'ERROR' : status,
  }
}

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

export async function startProcess(config: RunnerConfig): Promise<RunningProcessHandle> {
  const launch = await materializeLaunch(config)
  try {
    return await createRunningProcessHandle({
      processId: config.processId ?? randomUUID(),
      stepId: config.stepId,
      runId: config.runId,
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: buildExecutionEnv(process.env, config.env ?? {}),
      timeoutMs: config.timeout ?? DEFAULT_TIMEOUT_MS,
      cancellationGraceMs: config.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
      forceKillWaitMs: config.forceKillWaitMs ?? DEFAULT_FORCE_KILL_WAIT_MS,
      maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      callbackThrottleMs: config.callbackThrottleMs ?? DEFAULT_CALLBACK_THROTTLE_MS,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      onOutput: config.onOutput,
      onHeartbeat: config.onHeartbeat,
      cleanup: launch.cleanup,
    })
  } catch (error) {
    await launch.cleanup()
    throw error
  }
}

/**
 * Compatibility wrapper for callers that still await one terminal result.
 * Timeout is reported only after the process tree has been observed dead.
 */
export async function runStep(config: RunnerConfig): Promise<RunResult> {
  let handle: RunningProcessHandle
  try {
    handle = await startProcess(config)
  } catch (error) {
    if (error instanceof ProcessSpawnError) return toCompatibilityResult(error.result)
    throw error
  }
  const result = await handle.result
  if (result.status === 'TIMEOUT') {
    throw new ProcessTimeoutError(config.stepId, config.timeout ?? DEFAULT_TIMEOUT_MS)
  }
  return toCompatibilityResult(result)
}
