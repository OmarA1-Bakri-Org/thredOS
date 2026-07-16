import { spawn, type ChildProcess } from 'child_process'
import { access } from 'fs/promises'
import { win32 } from 'path'

export type ProcessSignal = 'SIGTERM' | 'SIGKILL'
export type RawProcessStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'ERROR'

export interface ProcessOutputEvent {
  stream: 'stdout' | 'stderr'
  at: Date
  bytes: number
}

export interface ProcessHeartbeatEvent {
  at: Date
}

export interface RawProcessResult {
  stepId: string
  runId: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  status: RawProcessStatus
  duration: number
  stdout: string
  stderr: string
  startTime: Date
  endTime: Date
}

export type ProcessControlResult =
  | {
    success: true
    signal: ProcessSignal
    escalated: boolean
  }
  | {
    success: false
    code: 'PROCESS_CONTROL_FAILED'
    message: string
    signal: ProcessSignal
  }

export class ProcessControlError extends Error {
  readonly code = 'PROCESS_CONTROL_FAILED'

  constructor(
    message: string,
    readonly controlResult: ProcessControlResult,
  ) {
    super(message)
    this.name = 'ProcessControlError'
  }
}

export class ProcessSpawnError extends Error {
  readonly code = 'PROCESS_SPAWN_FAILED'

  constructor(
    message: string,
    readonly result: RawProcessResult,
  ) {
    super(message)
    this.name = 'ProcessSpawnError'
  }
}

export class ProcessCallbackError extends Error {
  readonly code = 'PROCESS_CALLBACK_FAILED'

  constructor(
    message: string,
    readonly result: RawProcessResult,
  ) {
    super(message)
    this.name = 'ProcessCallbackError'
  }
}

export interface RunningProcessHandle {
  processId: string
  pid: number | null
  result: Promise<RawProcessResult>
  cancel(signal?: ProcessSignal): Promise<ProcessControlResult>
}

export interface ProcessLaunchConfig {
  processId: string
  stepId: string
  runId: string
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  cancellationGraceMs: number
  forceKillWaitMs: number
  maxOutputBytes: number
  callbackThrottleMs: number
  heartbeatIntervalMs: number
  onOutput?: (event: ProcessOutputEvent) => Promise<void> | void
  onHeartbeat?: (event: ProcessHeartbeatEvent) => Promise<void> | void
  cleanup: () => Promise<void>
}

interface TreeSignalAttempt {
  success: boolean
  signaled?: boolean
  message?: string
  canEscalate?: boolean
}

type TerminationHook = (
  pid: number,
  signal: ProcessSignal,
) => Promise<TreeSignalAttempt>

let processTerminationHookForTests: TerminationHook | null = null

interface WindowsTaskkillCommandContext {
  command: string
  args: string[]
  pid: number
  signal: AbortSignal
}

interface WindowsTaskkillCommandOutcome {
  code: number | null
  stderr: string
  timedOut?: boolean
}

type WindowsTaskkillCommandHook = (
  context: WindowsTaskkillCommandContext,
) => Promise<WindowsTaskkillCommandOutcome>

let windowsTaskkillCommandHookForTests: WindowsTaskkillCommandHook | null = null
let windowsTaskkillTimeoutForTests: number | null = null

export function setProcessTerminationHookForTests(hook: TerminationHook | null): void {
  processTerminationHookForTests = hook
}

export function setWindowsTaskkillCommandHookForTests(
  hook: WindowsTaskkillCommandHook | null,
  timeoutMs?: number,
): void {
  windowsTaskkillCommandHookForTests = hook
  windowsTaskkillTimeoutForTests = hook ? timeoutMs ?? null : null
}

export function resolveWindowsTaskkillPath(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const systemRoot = env.SystemRoot ?? env.windir
  if (!systemRoot || !win32.isAbsolute(systemRoot)) {
    throw new Error('Windows SystemRoot must be an absolute path')
  }
  return win32.join(win32.resolve(systemRoot), 'System32', 'taskkill.exe')
}

function isTreeAlive(pid: number): boolean {
  const target = process.platform === 'win32' ? pid : -pid
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForTreeDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  do {
    if (!isTreeAlive(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  return !isTreeAlive(pid)
}

const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000

async function executeTaskkill(
  command: string,
  args: string[],
  pid: number,
): Promise<WindowsTaskkillCommandOutcome> {
  const timeoutMs = windowsTaskkillTimeoutForTests ?? WINDOWS_TASKKILL_TIMEOUT_MS
  const controller = new AbortController()
  if (windowsTaskkillCommandHookForTests) {
    const hookResult = windowsTaskkillCommandHookForTests({
      command,
      args,
      pid,
      signal: controller.signal,
    })
    return new Promise(resolve => {
      let settled = false
      const finish = (outcome: WindowsTaskkillCommandOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      }
      const timer = setTimeout(() => {
        controller.abort()
        finish({
          code: null,
          stderr: `taskkill timed out after ${timeoutMs}ms`,
          timedOut: true,
        })
      }, timeoutMs)
      void hookResult.then(
        finish,
        error => finish({
          code: null,
          stderr: error instanceof Error ? error.message : String(error),
        }),
      )
    })
  }

  return new Promise(resolve => {
    let exitCode: number | null | undefined
    let resolved = false
    let killer: ChildProcess | null = null
    const finish = (outcome?: WindowsTaskkillCommandOutcome): void => {
      if (resolved || (outcome === undefined && exitCode === undefined)) return
      resolved = true
      clearTimeout(timer)
      killer?.removeAllListeners()
      killer?.unref()
      killer = null
      resolve(outcome ?? { code: exitCode ?? null, stderr: '' })
    }
    const timer = setTimeout(() => {
      controller.abort()
      killer?.kill('SIGKILL')
      finish({
        code: null,
        stderr: `taskkill timed out after ${timeoutMs}ms`,
        timedOut: true,
      })
    }, timeoutMs)
    try {
      killer = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch (error) {
      finish({
        code: null,
        stderr: error instanceof Error ? error.message : String(error),
      })
      return
    }
    killer.once('error', error => {
      finish({ code: null, stderr: error.message })
    })
    killer.once('close', code => {
      exitCode = code
      finish()
    })
  })
}

async function runTaskkill(pid: number, signal: ProcessSignal): Promise<TreeSignalAttempt> {
  const args = ['/PID', String(pid), '/T']
  if (signal === 'SIGKILL') args.push('/F')

  let command: string
  try {
    command = resolveWindowsTaskkillPath(process.env)
    await access(command)
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      canEscalate: false,
    }
  }

  const outcome = await executeTaskkill(command, args, pid)
  if (outcome.code === 0) {
    return { success: true, signaled: true }
  }
  return {
    success: false,
    message: outcome.stderr.trim() || `taskkill exited with code ${outcome.code ?? 'unknown'}`,
    canEscalate: signal === 'SIGTERM' && outcome.code !== null && outcome.timedOut !== true,
  }
}

async function signalProcessTree(pid: number, signal: ProcessSignal): Promise<TreeSignalAttempt> {
  if (processTerminationHookForTests) {
    const result = await processTerminationHookForTests(pid, signal)
    return result.success
      ? { success: true, signaled: result.signaled ?? true }
      : { success: false, message: result.message, canEscalate: result.canEscalate ?? false }
  }
  if (process.platform === 'win32') {
    return runTaskkill(pid, signal)
  }

  try {
    process.kill(-pid, signal)
    return { success: true, signaled: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH' && !isTreeAlive(pid)) {
      return { success: true, signaled: false }
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      canEscalate: false,
    }
  }
}

function appendBounded(chunks: Buffer[], chunk: Buffer, currentBytes: number, limit: number): number {
  if (currentBytes >= limit) return currentBytes
  const remaining = limit - currentBytes
  const accepted = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining)
  chunks.push(accepted)
  return currentBytes + accepted.byteLength
}

export async function createRunningProcessHandle(config: ProcessLaunchConfig): Promise<RunningProcessHandle> {
  const startTime = new Date()
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let lastOutputCallbackAt = 0
  let lastHeartbeatCallbackAt = 0
  let terminationReason: 'cancelled' | 'timed_out' | null = null
  let spawnError: Error | null = null
  let closed = false
  let resultSettled = false
  let cleanupPromise: Promise<void> | null = null
  let timeoutTimer: NodeJS.Timeout | undefined
  let heartbeatTimer: NodeJS.Timeout | undefined
  let activeControl: Promise<ProcessControlResult> | null = null
  let terminationProof: Promise<ProcessControlResult> | null = null
  let controlInProgress = false
  let callbackQueue: Promise<void> = Promise.resolve()
  let callbackFailure: Error | null = null
  let child: ChildProcess | null = null
  let childClose: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let stdoutEnded = false
  let stderrEnded = false

  let resolveResult!: (result: RawProcessResult) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<RawProcessResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  let resolveSpawn!: () => void
  let rejectSpawn!: (error: Error) => void
  const spawnReady = new Promise<void>((resolve, reject) => {
    resolveSpawn = resolve
    rejectSpawn = reject
  })

  const cleanup = (): Promise<void> => {
    cleanupPromise ??= config.cleanup()
    return cleanupPromise
  }

  const queueCallback = <T>(
    callback: ((event: T) => Promise<void> | void) | undefined,
    event: T,
  ): void => {
    if (!callback) return
    callbackQueue = callbackQueue.then(async () => {
      try {
        await callback(event)
      } catch (error) {
        callbackFailure ??= error instanceof Error ? error : new Error(String(error))
      }
    })
  }

  const finalize = (
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (closed) return
    closed = true
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    child?.stdout?.removeAllListeners()
    child?.stdout?.destroy()
    child?.stderr?.removeAllListeners()
    child?.stderr?.destroy()
    child?.removeAllListeners()
    child?.unref()
    child = null
    const endTime = new Date()
    let status: RawProcessStatus
    if (terminationReason === 'timed_out') status = 'TIMEOUT'
    else if (terminationReason === 'cancelled') status = 'CANCELLED'
    else if (spawnError || exitCode === null) status = 'ERROR'
    else if (exitCode === 0) status = 'SUCCESS'
    else status = 'FAILED'

    const stderr = Buffer.concat(stderrChunks, stderrBytes).toString('utf8')
    const errorSuffix = spawnError ? `${stderr ? '\n' : ''}${spawnError.message}` : ''
    const rawResult: RawProcessResult = {
      stepId: config.stepId,
      runId: config.runId,
      exitCode: spawnError ? null : exitCode,
      signal,
      status,
      duration: endTime.getTime() - startTime.getTime(),
      stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
      stderr: stderr + errorSuffix,
      startTime,
      endTime,
    }
    void cleanup().catch(() => undefined).then(async () => {
      if (resultSettled) return
      if (terminationReason !== null && terminationProof !== null) {
        const controlResult = await terminationProof
        if (!controlResult.success) {
          rejectForControlFailure(controlResult)
          return
        }
      }
      await callbackQueue
      await new Promise<void>(resolveRelease => setImmediate(resolveRelease))
      if (resultSettled) return
      if (callbackFailure) {
        resultSettled = true
        rejectResult(new ProcessCallbackError(callbackFailure.message, rawResult))
        return
      }
      resultSettled = true
      resolveResult(rawResult)
    })
  }

  const rejectForControlFailure = (controlResult: ProcessControlResult): void => {
    if (resultSettled || controlResult.success) return
    resultSettled = true
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    rejectResult(new ProcessControlError(controlResult.message, controlResult))
  }

  const finalizeAfterStreams = (): void => {
    if (controlInProgress || !childClose || !stdoutEnded || !stderrEnded) return
    finalize(childClose.code, childClose.signal)
  }

  try {
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: config.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    spawnError = error instanceof Error ? error : new Error(String(error))
    rejectSpawn(spawnError)
    finalize(null, null)
  }

  const pid = child?.pid ?? null

  if (child) {
    child.once('spawn', resolveSpawn)
    stdoutEnded = child.stdout === null
    stderrEnded = child.stderr === null
    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      stdoutBytes = appendBounded(stdoutChunks, chunk, stdoutBytes, config.maxOutputBytes)
      const now = Date.now()
      if (now - lastOutputCallbackAt >= config.callbackThrottleMs) {
        lastOutputCallbackAt = now
        queueCallback(config.onOutput, { stream: 'stdout', at: new Date(now), bytes: chunk.byteLength })
      }
    })
    child.stdout?.once('end', () => {
      stdoutEnded = true
      finalizeAfterStreams()
    })
    child.stdout?.once('close', () => {
      stdoutEnded = true
      finalizeAfterStreams()
    })
    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      stderrBytes = appendBounded(stderrChunks, chunk, stderrBytes, config.maxOutputBytes)
      const now = Date.now()
      if (now - lastOutputCallbackAt >= config.callbackThrottleMs) {
        lastOutputCallbackAt = now
        queueCallback(config.onOutput, { stream: 'stderr', at: new Date(now), bytes: chunk.byteLength })
      }
    })
    child.stderr?.once('end', () => {
      stderrEnded = true
      finalizeAfterStreams()
    })
    child.stderr?.once('close', () => {
      stderrEnded = true
      finalizeAfterStreams()
    })
    child.once('error', error => {
      spawnError = error
      rejectSpawn(error)
    })
    child.once('close', (code, signal) => {
      childClose = { code, signal }
      finalizeAfterStreams()
    })
  }

  const terminate = async (
    requestedSignal: ProcessSignal,
    reason: 'cancelled' | 'timed_out',
  ): Promise<ProcessControlResult> => {
    if (closed || pid === null) {
      return { success: true, signal: requestedSignal, escalated: false }
    }
    if (activeControl) return activeControl
    if (!isTreeAlive(pid)) {
      finalizeAfterStreams()
      return { success: true, signal: requestedSignal, escalated: false }
    }

    controlInProgress = true
    activeControl = (async () => {
      const previousReason = terminationReason
      const requested = await signalProcessTree(pid, requestedSignal)
      if (requested.success && requested.signaled === false) {
        return { success: true, signal: requestedSignal, escalated: false }
      }
      if (requested.success) {
        terminationReason = reason
      }
      const shouldEscalateImmediately = !requested.success
        && requestedSignal === 'SIGTERM'
        && requested.canEscalate === true
      if (!requested.success && !shouldEscalateImmediately) {
        terminationReason = previousReason
        return {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: requested.message ?? `Failed to signal process tree ${pid}`,
          signal: requestedSignal,
        }
      }

      const requestedWait = requestedSignal === 'SIGKILL'
        ? config.forceKillWaitMs
        : config.cancellationGraceMs
      if (!shouldEscalateImmediately && await waitForTreeDeath(pid, requestedWait)) {
        finalize(null, requestedSignal)
        return { success: true, signal: requestedSignal, escalated: requestedSignal === 'SIGKILL' }
      }
      if (requestedSignal === 'SIGKILL') {
        terminationReason = previousReason
        return {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: `Process tree ${pid} remained alive after forced termination`,
          signal: requestedSignal,
        }
      }

      const forced = await signalProcessTree(pid, 'SIGKILL')
      if (!forced.success) {
        terminationReason = previousReason
        return {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: forced.message ?? `Failed to force process tree ${pid}`,
          signal: requestedSignal,
        }
      }
      if (forced.signaled === false) {
        if (!await waitForTreeDeath(pid, config.forceKillWaitMs)) {
          terminationReason = previousReason
          return {
            success: false,
            code: 'PROCESS_CONTROL_FAILED',
            message: `Process tree ${pid} remained alive after escalation race`,
            signal: requestedSignal,
          }
        }
        finalize(null, 'SIGKILL')
        return { success: true, signal: requestedSignal, escalated: true }
      }
      terminationReason = reason
      if (!await waitForTreeDeath(pid, config.forceKillWaitMs)) {
        terminationReason = previousReason
        return {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: `Process tree ${pid} remained alive after escalation`,
          signal: requestedSignal,
        }
      }
      finalize(null, 'SIGKILL')
      return { success: true, signal: requestedSignal, escalated: true }
    })()
    terminationProof = activeControl

    try {
      return await activeControl
    } finally {
      controlInProgress = false
      activeControl = null
      if (terminationReason === null) finalizeAfterStreams()
    }
  }

  if (pid !== null && config.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      void terminate('SIGTERM', 'timed_out').then(
        controlResult => rejectForControlFailure(controlResult),
        error => rejectForControlFailure({
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: error instanceof Error ? error.message : String(error),
          signal: 'SIGTERM',
        }),
      )
    }, config.timeoutMs)
  }
  if (pid !== null && config.onHeartbeat && config.heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      const now = Date.now()
      if (now - lastHeartbeatCallbackAt >= config.callbackThrottleMs) {
        lastHeartbeatCallbackAt = now
        queueCallback(config.onHeartbeat, { at: new Date(now) })
      }
    }, config.heartbeatIntervalMs)
  }

  const handle: RunningProcessHandle = {
    processId: config.processId,
    pid,
    result,
    cancel: signal => terminate(signal ?? 'SIGTERM', 'cancelled'),
  }

  try {
    await spawnReady
    return handle
  } catch (error) {
    const rawResult = await result
    throw new ProcessSpawnError(
      error instanceof Error ? error.message : String(error),
      rawResult,
    )
  }
}
