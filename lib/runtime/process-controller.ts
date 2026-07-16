import type {
  ProcessControlResult,
  ProcessSignal,
  RawProcessResult,
  RunningProcessHandle,
} from '../runner/process-handle'
import {
  buildExecutionEnv,
  ProcessCallbackError,
  ProcessControlError,
  ProcessSpawnError,
  startProcess,
  type RunnerConfig,
} from '../runner/wrapper'
import { assertProcessTransition } from './lifecycle'
import type { ProcessRepository } from './process-repository'
import type { ProcessRecord, ProcessStatus } from './schema'

type ProcessRepositoryPort = Pick<ProcessRepository, 'create' | 'get' | 'update'>
type ProcessStarter = (config: RunnerConfig) => Promise<RunningProcessHandle>

export interface ProcessControllerOptions {
  processes: ProcessRepositoryPort
  now(): string
  startProcess?: ProcessStarter
  activityPersistIntervalMs?: number
}

export interface StartControlledProcessInput {
  processId: string
  workflowRunId: string
  attemptId: string
  runnerConfig: RunnerConfig
}

export type ControlledProcessCompletion =
  | { process: ProcessRecord; result: RawProcessResult; error: Error | null }
  | { process: ProcessRecord; result: null; error: Error }

export interface ControlledProcess {
  process: ProcessRecord
  handle: RunningProcessHandle
  completion: Promise<ControlledProcessCompletion>
}

interface ManagedProcess {
  record: ProcessRecord
  handle: RunningProcessHandle | null
  handleReady: Promise<RunningProcessHandle>
  resolveHandle(handle: RunningProcessHandle): void
  rejectHandle(error: Error): void
  operation: Promise<void>
  completion: Promise<ControlledProcessCompletion> | null
  pendingOutputAt: string | null
  pendingHeartbeatAt: string | null
  activityTimer: NodeJS.Timeout | null
  lastActivityWriteAt: number
  cancellation: Promise<ProcessControlResult> | null
  activityPersistenceError: Error | null
  registrationFailed: boolean
  controlResultFailed: boolean
  pendingTerminal: TerminalEvidence | null
  finalizationFailed: boolean
}

interface TerminalEvidence {
  status: 'exited' | 'lost'
  endedAt: string
  exitCode: number | null
  signal: string | null
}

const DEFAULT_ACTIVITY_PERSIST_INTERVAL_MS = 1_000

function launchPayload(config: RunnerConfig): {
  command: string
  args: string[]
  cwd: string
} {
  return config.executablePayload ?? {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd ?? process.cwd(),
  }
}

function laterTimestamp(current: string | null | undefined, candidate: string): string {
  if (!current || Date.parse(candidate) > Date.parse(current)) return candidate
  return current
}

function terminal(status: ProcessStatus): boolean {
  return status === 'exited' || status === 'lost'
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export class ProcessController {
  private readonly live = new Map<string, ManagedProcess>()
  private readonly starter: ProcessStarter
  private readonly activityPersistIntervalMs: number

  constructor(private readonly options: ProcessControllerOptions) {
    this.starter = options.startProcess ?? startProcess
    this.activityPersistIntervalMs = options.activityPersistIntervalMs
      ?? DEFAULT_ACTIVITY_PERSIST_INTERVAL_MS
  }

  hasLiveHandle(processId: string): boolean {
    return (this.live.get(processId)?.handle ?? null) !== null
  }

  async start(input: StartControlledProcessInput): Promise<ControlledProcess> {
    if (this.live.has(input.processId)) {
      throw new Error(`process ${input.processId} already has a live handle`)
    }
    const payload = launchPayload(input.runnerConfig)
    const launchRequestedAt = this.options.now()
    let record: ProcessRecord = {
      schema_version: 1,
      id: input.processId,
      revision: 0,
      workflow_run_id: input.workflowRunId,
      attempt_id: input.attemptId,
      provider: 'local-process',
      provider_handle: null,
      pid: null,
      command: payload.command,
      redacted_args: payload.args.map(() => '[REDACTED]'),
      environment_keys: Object.keys(
        buildExecutionEnv(process.env, input.runnerConfig.env ?? {}),
      ).sort(),
      cwd: payload.cwd,
      status: 'planned',
      launch_requested_at: launchRequestedAt,
      started_at: null,
      ended_at: null,
      last_output_at: null,
      last_heartbeat_at: null,
      cancellation_requested_at: null,
      exit_code: null,
      signal: null,
    }
    await this.options.processes.create(record)
    record = await this.transition(record, 'starting')

    const handleReady = deferred<RunningProcessHandle>()
    void handleReady.promise.catch(() => undefined)
    const managed: ManagedProcess = {
      record,
      handle: null,
      handleReady: handleReady.promise,
      resolveHandle: handleReady.resolve,
      rejectHandle: handleReady.reject,
      operation: Promise.resolve(),
      completion: null,
      pendingOutputAt: null,
      pendingHeartbeatAt: null,
      activityTimer: null,
      lastActivityWriteAt: Date.now(),
      cancellation: null,
      activityPersistenceError: null,
      registrationFailed: false,
      controlResultFailed: false,
      pendingTerminal: null,
      finalizationFailed: false,
    }
    this.live.set(record.id, managed)

    const markOutput = (at: Date): void => {
      const timestamp = at.toISOString()
      managed.pendingOutputAt = laterTimestamp(managed.pendingOutputAt, timestamp)
      this.scheduleActivityWrite(managed)
    }
    const markHeartbeat = (at: Date): void => {
      const timestamp = at.toISOString()
      managed.pendingHeartbeatAt = laterTimestamp(managed.pendingHeartbeatAt, timestamp)
      this.scheduleActivityWrite(managed)
    }
    const configuredOutput = input.runnerConfig.onOutput
    const configuredHeartbeat = input.runnerConfig.onHeartbeat

    let handle: RunningProcessHandle
    try {
      handle = await this.starter({
        ...input.runnerConfig,
        processId: input.processId,
        onOutput: async event => {
          markOutput(event.at)
          await configuredOutput?.(event)
        },
        onHeartbeat: async event => {
          markHeartbeat(event.at)
          await configuredHeartbeat?.(event)
        },
      })
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      managed.rejectHandle(normalized)
      try {
        await this.mutate(managed, current => ({
          ...current,
          status: 'lost',
          ended_at: error instanceof ProcessSpawnError
            ? error.result.endTime.toISOString()
            : this.options.now(),
        }))
      } catch {
        // Spawn failure remains authoritative even if the lost-state write also fails.
      } finally {
        this.live.delete(input.processId)
      }
      throw error
    }

    if (handle.pid === null) {
      const error = new Error(`process ${input.processId} spawned without a PID`)
      managed.handle = handle
      if (await this.cleanupFailedRegistration(managed)) {
        managed.rejectHandle(error)
      } else {
        managed.registrationFailed = true
        managed.completion = this.observeCompletion(managed, handle)
        void managed.completion.catch(() => undefined)
        managed.resolveHandle(handle)
      }
      throw error
    }

    managed.handle = handle
    try {
      await this.mutate(managed, current => {
        assertProcessTransition(current.status, 'running')
        return {
          ...current,
          status: 'running',
          provider_handle: `pid:${handle.pid}`,
          pid: handle.pid,
          started_at: this.options.now(),
        }
      })
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (await this.cleanupFailedRegistration(managed)) {
        managed.rejectHandle(normalized)
      } else {
        managed.registrationFailed = true
        managed.completion = this.observeCompletion(managed, handle)
        void managed.completion.catch(() => undefined)
        managed.resolveHandle(handle)
      }
      throw error
    }

    managed.completion = this.observeCompletion(managed, handle)
    managed.resolveHandle(handle)
    if (managed.pendingOutputAt || managed.pendingHeartbeatAt) {
      this.scheduleActivityWrite(managed)
    }

    return { process: managed.record, handle, completion: managed.completion }
  }

  async cancel(
    processId: string,
    signal: ProcessSignal = 'SIGTERM',
  ): Promise<ProcessControlResult> {
    const managed = this.live.get(processId)
    if (!managed) {
      const record = await this.options.processes.get(processId)
      if (record && terminal(record.status)) {
        return { success: true, signal, escalated: false }
      }
      return {
        success: false,
        code: 'PROCESS_CONTROL_FAILED',
        message: `process ${processId} has no live process handle`,
        signal,
      }
    }
    if (managed.cancellation) return await managed.cancellation

    const cancellation = (async (): Promise<ProcessControlResult> => {
      try {
        await this.mutate(managed, current => {
          if (terminal(current.status) || current.cancellation_requested_at) return current
          return {
            ...current,
            cancellation_requested_at: this.options.now(),
          }
        })
        if (terminal(managed.record.status)) {
          return { success: true, signal, escalated: false }
        }
        const handle = await managed.handleReady
        await this.mutate(managed, current => {
          if (terminal(current.status) || current.status === 'terminating') return current
          if (current.status === 'starting') return current
          assertProcessTransition(current.status, 'terminating')
          return { ...current, status: 'terminating' }
        })
        if (terminal(managed.record.status)) {
          return { success: true, signal, escalated: false }
        }
        const result = await handle.cancel(signal)
        if (
          result.success
          && (managed.registrationFailed || managed.controlResultFailed)
        ) {
          let observed: RawProcessResult | null = null
          try {
            observed = await handle.result
          } catch (error) {
            if (error instanceof ProcessCallbackError) observed = error.result
          }
          const finalizationError = await this.persistTerminal(managed, {
            status: managed.registrationFailed ? 'lost' : 'exited',
            endedAt: observed?.endTime.toISOString() ?? this.options.now(),
            exitCode: observed?.exitCode ?? null,
            signal: observed?.signal ?? result.signal,
          })
          if (!finalizationError) {
            this.releaseManaged(managed)
          }
        }
        return result
      } catch (error) {
        return {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: error instanceof Error ? error.message : String(error),
          signal,
        }
      }
    })()
    managed.cancellation = cancellation
    const controlResult = await cancellation
    if (!controlResult.success && managed.cancellation === cancellation) {
      managed.cancellation = null
    }
    return controlResult
  }

  async retryFinalization(processId: string): Promise<ProcessRecord> {
    const managed = this.live.get(processId)
    if (!managed?.pendingTerminal) {
      throw new Error(`process ${processId} has no pending terminal evidence`)
    }
    const finalizationError = await this.persistTerminal(
      managed,
      managed.pendingTerminal,
      1,
    )
    if (finalizationError) throw finalizationError
    this.releaseManaged(managed)
    return managed.record
  }

  private async observeCompletion(
    managed: ManagedProcess,
    handle: RunningProcessHandle,
  ): Promise<ControlledProcessCompletion> {
    let completion: ControlledProcessCompletion
    try {
      const result = await handle.result
      const activityError = await this.flushActivity(managed)
      const terminalError = await this.persistTerminal(managed, {
        status: managed.registrationFailed ? 'lost' : 'exited',
        endedAt: result.endTime.toISOString(),
        exitCode: result.exitCode,
        signal: result.signal,
      })
      completion = {
        process: managed.record,
        result,
        error: terminalError ?? activityError,
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (error instanceof ProcessControlError) {
        managed.controlResultFailed = true
        completion = { process: managed.record, result: null, error: normalized }
        return completion
      }
      const activityError = await this.flushActivity(managed)
      const callbackResult = error instanceof ProcessCallbackError
        ? error.result
        : null
      const terminalError = await this.persistTerminal(managed, {
        status: callbackResult && !managed.registrationFailed ? 'exited' : 'lost',
        endedAt: callbackResult?.endTime.toISOString() ?? this.options.now(),
        exitCode: callbackResult?.exitCode ?? null,
        signal: callbackResult?.signal ?? null,
      })
      completion = {
        process: managed.record,
        result: callbackResult,
        error: terminalError ?? activityError ?? normalized,
      }
    } finally {
      if (
        !managed.controlResultFailed
        && !managed.finalizationFailed
        && terminal(managed.record.status)
      ) {
        this.releaseManaged(managed)
      }
    }
    return completion
  }

  private async cleanupFailedRegistration(
    managed: ManagedProcess,
  ): Promise<boolean> {
    const handle = managed.handle
    let result: RawProcessResult | null = null
    let controlResult: ProcessControlResult | null = null
    let resultObserved = false
    if (handle) {
      try {
        await this.mutate(managed, current => ({
          ...current,
          cancellation_requested_at: current.cancellation_requested_at ?? this.options.now(),
        }))
      } catch {
        // Preserve the original registration failure and continue controlling the live process.
      }
      try {
        controlResult = await handle.cancel('SIGTERM')
      } catch (error) {
        controlResult = {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: error instanceof Error ? error.message : String(error),
          signal: 'SIGTERM',
        }
      }
      if (controlResult.success) {
        try {
          result = await handle.result
        } catch (error) {
          if (error instanceof ProcessCallbackError) result = error.result
        } finally {
          resultObserved = true
        }
      }
    }
    if (controlResult?.success === true && resultObserved) {
      const finalizationError = await this.persistTerminal(managed, {
        status: 'lost',
        endedAt: result?.endTime.toISOString() ?? this.options.now(),
        exitCode: result?.exitCode ?? null,
        signal: result?.signal ?? controlResult.signal,
      })
      if (!finalizationError) {
        this.releaseManaged(managed)
      }
      return true
    }
    if (managed.activityTimer) clearTimeout(managed.activityTimer)
    return false
  }

  private async persistTerminal(
    managed: ManagedProcess,
    evidence: TerminalEvidence,
    attempts = 2,
  ): Promise<Error | null> {
    managed.pendingTerminal = evidence
    let lastError: Error | null = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.mutate(managed, current => {
          if (terminal(current.status)) return current
          assertProcessTransition(current.status, evidence.status)
          return {
            ...current,
            status: evidence.status,
            ended_at: evidence.endedAt,
            exit_code: evidence.exitCode,
            signal: evidence.signal,
          }
        })
        managed.pendingTerminal = null
        managed.finalizationFailed = false
        return null
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    managed.finalizationFailed = true
    return lastError
  }

  private releaseManaged(managed: ManagedProcess): void {
    if (managed.activityTimer) {
      clearTimeout(managed.activityTimer)
      managed.activityTimer = null
    }
    this.live.delete(managed.record.id)
  }

  private scheduleActivityWrite(managed: ManagedProcess): void {
    if (managed.activityTimer || terminal(managed.record.status)) return
    const elapsed = Date.now() - managed.lastActivityWriteAt
    const delay = Math.max(0, this.activityPersistIntervalMs - elapsed)
    managed.activityTimer = setTimeout(() => {
      managed.activityTimer = null
      void this.persistActivity(managed).catch(error => {
        managed.activityPersistenceError = error instanceof Error
          ? error
          : new Error(String(error))
      })
    }, delay)
  }

  private async persistActivity(managed: ManagedProcess): Promise<void> {
    const outputAt = managed.pendingOutputAt
    const heartbeatAt = managed.pendingHeartbeatAt
    if (!outputAt && !heartbeatAt) return
    await this.mutate(managed, current => ({
      ...current,
      last_output_at: outputAt
        ? laterTimestamp(current.last_output_at, outputAt)
        : current.last_output_at,
      last_heartbeat_at: heartbeatAt
        ? laterTimestamp(current.last_heartbeat_at, heartbeatAt)
        : current.last_heartbeat_at,
    }))
    if (managed.pendingOutputAt === outputAt) managed.pendingOutputAt = null
    if (managed.pendingHeartbeatAt === heartbeatAt) managed.pendingHeartbeatAt = null
    managed.activityPersistenceError = null
    managed.lastActivityWriteAt = Date.now()
    if (managed.pendingOutputAt || managed.pendingHeartbeatAt) {
      this.scheduleActivityWrite(managed)
    }
  }

  private async flushActivity(managed: ManagedProcess): Promise<Error | null> {
    if (managed.activityTimer) {
      clearTimeout(managed.activityTimer)
      managed.activityTimer = null
    }
    try {
      await this.persistActivity(managed)
      await managed.operation
      return null
    } catch (error) {
      managed.activityPersistenceError = error instanceof Error
        ? error
        : new Error(String(error))
    }
    try {
      await this.persistActivity(managed)
      await managed.operation
      return null
    } catch (error) {
      managed.activityPersistenceError = error instanceof Error
        ? error
        : new Error(String(error))
      return managed.activityPersistenceError
    }
  }

  private async transition(
    current: ProcessRecord,
    status: ProcessStatus,
    patch: Partial<ProcessRecord> = {},
  ): Promise<ProcessRecord> {
    assertProcessTransition(current.status, status)
    return await this.options.processes.update(current.id, current.revision, value => ({
      ...value,
      ...patch,
      status,
    }))
  }

  private async mutate(
    managed: ManagedProcess,
    mutation: (current: ProcessRecord) => ProcessRecord,
  ): Promise<void> {
    managed.operation = managed.operation.catch(() => undefined).then(async () => {
      const current = managed.record
      const next = mutation(current)
      if (next === current) return
      managed.record = await this.options.processes.update(
        current.id,
        current.revision,
        () => next,
      )
    })
    await managed.operation
  }
}
