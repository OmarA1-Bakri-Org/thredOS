import { describe, expect, test } from 'bun:test'
import type {
  ProcessControlResult,
  ProcessSignal,
  RawProcessResult,
  RunningProcessHandle,
} from '../runner/process-handle'
import type { RunnerConfig } from '../runner/wrapper'
import { ProcessCallbackError, ProcessControlError } from '../runner/wrapper'
import type { ProcessRecord } from './schema'
import { ProcessController } from './process-controller'

const timestamp = '2026-07-16T00:00:00.000Z'

class MemoryProcesses {
  record: ProcessRecord | null = null
  writes: ProcessRecord[] = []
  events: string[] = []

  async create(value: ProcessRecord): Promise<void> {
    this.events.push('persist:create')
    this.record = structuredClone(value)
    this.writes.push(structuredClone(value))
  }

  async get(): Promise<ProcessRecord | null> {
    return this.record ? structuredClone(this.record) : null
  }

  async update(
    _processId: string,
    expectedRevision: number,
    mutate: (current: ProcessRecord) => ProcessRecord,
  ): Promise<ProcessRecord> {
    if (!this.record || this.record.revision !== expectedRevision) {
      throw new Error('revision conflict')
    }
    const next = {
      ...mutate(structuredClone(this.record)),
      revision: this.record.revision + 1,
    }
    this.events.push(`persist:${next.status}`)
    this.record = next
    this.writes.push(structuredClone(next))
    return structuredClone(next)
  }
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

function result(overrides: Partial<RawProcessResult> = {}): RawProcessResult {
  return {
    stepId: 'step-01',
    runId: 'run-01',
    exitCode: 0,
    signal: null,
    status: 'SUCCESS',
    duration: 100,
    stdout: '',
    stderr: '',
    startTime: new Date(timestamp),
    endTime: new Date('2026-07-16T00:00:01.000Z'),
    ...overrides,
  }
}

function runnerConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    stepId: 'step-01',
    runId: 'run-01',
    command: 'node',
    args: ['--token', 'secret-value'],
    cwd: 'C:\\surface',
    env: { THREADOS_ATTEMPT_ID: 'attempt-01', SECRET_TOKEN: 'secret-value' },
    ...overrides,
  }
}

function handle(
  completion: Promise<RawProcessResult>,
  cancel: (signal?: ProcessSignal) => Promise<ProcessControlResult> = async () => ({
    success: true,
    signal: 'SIGTERM',
    escalated: false,
  }),
): RunningProcessHandle {
  return {
    processId: 'process-01',
    pid: 101,
    result: completion,
    cancel,
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('ProcessController', () => {
  test('persists redacted launch intent before spawn and hands off PID as running', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const receivedConfigs: RunnerConfig[] = []
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async config => {
        processes.events.push('spawn')
        receivedConfigs.push(config)
        return handle(pending.promise)
      },
    })

    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    expect(processes.events.slice(0, 4)).toEqual([
      'persist:create',
      'persist:starting',
      'spawn',
      'persist:running',
    ])
    expect(started.process).toMatchObject({
      status: 'running',
      pid: 101,
      provider_handle: 'pid:101',
    })
    expect(processes.writes[0]).toMatchObject({
      status: 'planned',
      pid: null,
      provider_handle: null,
      redacted_args: ['[REDACTED]', '[REDACTED]'],
    })
    expect(processes.writes[0].environment_keys).toContain('THREADOS_ATTEMPT_ID')
    expect(processes.writes[0].environment_keys).toContain('SECRET_TOKEN')
    expect(JSON.stringify(processes.writes)).not.toContain('secret-value')
    expect(receivedConfigs[0]?.processId).toBe('process-01')

    pending.resolve(result())
    await started.completion
  })

  test('throttles activity writes and final-flushes the newest evidence before exit', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    let callbacks: Pick<RunnerConfig, 'onOutput' | 'onHeartbeat'> = {}
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      activityPersistIntervalMs: 60_000,
      startProcess: async config => {
        callbacks = config
        return handle(pending.promise)
      },
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    for (let index = 1; index <= 20; index += 1) {
      const at = new Date(`2026-07-16T00:00:00.${String(index).padStart(3, '0')}Z`)
      await callbacks.onOutput?.({ stream: 'stdout', at, bytes: 1 })
      await callbacks.onHeartbeat?.({ at })
    }
    pending.resolve(result())
    const completion = await started.completion

    expect(processes.writes.length).toBeLessThanOrEqual(5)
    expect(completion.process).toMatchObject({
      status: 'exited',
      last_output_at: '2026-07-16T00:00:00.020Z',
      last_heartbeat_at: '2026-07-16T00:00:00.020Z',
      exit_code: 0,
    })
    expect(processes.events.slice(-2)).toEqual(['persist:running', 'persist:exited'])
  })

  test('retains output and heartbeat evidence emitted before the starter returns', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      activityPersistIntervalMs: 60_000,
      startProcess: async config => {
        await config.onOutput?.({
          stream: 'stdout',
          at: new Date('2026-07-16T00:00:00.100Z'),
          bytes: 10,
        })
        await config.onHeartbeat?.({
          at: new Date('2026-07-16T00:00:00.200Z'),
        })
        return handle(pending.promise)
      },
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    pending.resolve(result())
    expect((await started.completion).process).toMatchObject({
      status: 'exited',
      last_output_at: '2026-07-16T00:00:00.100Z',
      last_heartbeat_at: '2026-07-16T00:00:00.200Z',
    })
  })

  test('records verified cancelled and timed-out results as exited even without an exit code', async () => {
    for (const status of ['CANCELLED', 'TIMEOUT'] as const) {
      const processes = new MemoryProcesses()
      const pending = deferred<RawProcessResult>()
      const controller = new ProcessController({
        processes,
        now: () => timestamp,
        startProcess: async () => handle(pending.promise),
      })
      const started = await controller.start({
        processId: 'process-01',
        workflowRunId: 'run-01',
        attemptId: 'attempt-01',
        runnerConfig: runnerConfig(),
      })

      pending.resolve(result({ status, exitCode: null, signal: 'SIGTERM' }))
      expect((await started.completion).process).toMatchObject({
        status: 'exited',
        exit_code: null,
        signal: 'SIGTERM',
      })
    }
  })

  test('persists spawn failure as lost without PID evidence', async () => {
    const processes = new MemoryProcesses()
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => {
        processes.events.push('spawn')
        throw new Error('spawn denied')
      },
    })

    await expect(controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })).rejects.toThrow('spawn denied')
    expect(processes.record).toMatchObject({
      status: 'lost',
      pid: null,
      provider_handle: null,
      ended_at: timestamp,
    })
  })

  test('marks a rejected live-handle result lost and returns the error as evidence', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    pending.reject(new Error('process result unavailable'))
    const completion = await started.completion
    expect(completion.error?.message).toBe('process result unavailable')
    expect(completion.process).toMatchObject({
      status: 'lost',
      ended_at: timestamp,
      exit_code: null,
    })
  })

  test('retains a handle after ProcessControlError and closes it after stronger verified control', async () => {
    const processes = new MemoryProcesses()
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'tree remains alive',
      signal: 'SIGTERM',
    }
    const signals: string[] = []
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(
        Promise.reject(new ProcessControlError('tree remains alive', failedControl)),
        async signal => {
          signals.push(signal ?? 'SIGTERM')
          return { success: true, signal: signal ?? 'SIGTERM', escalated: true }
        },
      ),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    const failedCompletion = await started.completion
    expect(failedCompletion.error).toBeInstanceOf(ProcessControlError)
    expect(failedCompletion.process.status).toBe('running')
    expect(controller.hasLiveHandle('process-01')).toBe(true)

    expect(await controller.cancel('process-01', 'SIGKILL')).toEqual({
      success: true,
      signal: 'SIGKILL',
      escalated: true,
    })
    expect(signals).toEqual(['SIGKILL'])
    expect(processes.record).toMatchObject({
      status: 'exited',
      ended_at: timestamp,
      exit_code: null,
      signal: 'SIGKILL',
    })
    expect(controller.hasLiveHandle('process-01')).toBe(false)
    expect(await controller.cancel('process-01', 'SIGKILL')).toEqual({
      success: true,
      signal: 'SIGKILL',
      escalated: false,
    })
    expect(signals).toEqual(['SIGKILL'])
  })

  test('preserves exact terminal evidence when a post-exit callback fails', async () => {
    const processes = new MemoryProcesses()
    const terminalResult = result({ exitCode: 17, status: 'FAILED' })
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(
        Promise.reject(new ProcessCallbackError(
          'output persistence callback failed',
          terminalResult,
        )),
      ),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    const completion = await started.completion
    expect(completion.error).toBeInstanceOf(ProcessCallbackError)
    expect(completion.result).toEqual(terminalResult)
    expect(completion.process).toMatchObject({
      status: 'exited',
      ended_at: terminalResult.endTime.toISOString(),
      exit_code: 17,
      signal: null,
    })
    expect(controller.hasLiveHandle('process-01')).toBe(false)
  })

  test('coalesces concurrent cancellation and records termination intent once', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const cancellation = deferred<ProcessControlResult>()
    let cancelCalls = 0
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise, async () => {
        cancelCalls += 1
        return cancellation.promise
      }),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    const first = controller.cancel('process-01')
    const second = controller.cancel('process-01')
    cancellation.resolve({ success: true, signal: 'SIGTERM', escalated: false })

    expect(await Promise.all([first, second])).toEqual([
      { success: true, signal: 'SIGTERM', escalated: false },
      { success: true, signal: 'SIGTERM', escalated: false },
    ])
    expect(cancelCalls).toBe(1)
    expect(processes.writes.filter(write => write.status === 'terminating')).toHaveLength(1)

    pending.resolve(result({ status: 'CANCELLED', exitCode: null, signal: 'SIGTERM' }))
    await started.completion
  })

  test('cancel during start persists intent and waits for eventual verified control', async () => {
    const processes = new MemoryProcesses()
    const starter = deferred<RunningProcessHandle>()
    const pending = deferred<RawProcessResult>()
    const cancellation = deferred<ProcessControlResult>()
    let cancelCalls = 0
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => starter.promise,
    })
    const starting = controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })
    await waitFor(() => processes.record?.status === 'starting')

    let cancellationSettled = false
    const cancelling = controller.cancel('process-01').finally(() => {
      cancellationSettled = true
    })
    await waitFor(() => processes.record?.cancellation_requested_at === timestamp)
    expect(processes.record?.status).toBe('starting')
    expect(cancellationSettled).toBe(false)

    starter.resolve(handle(pending.promise, async () => {
      cancelCalls += 1
      return cancellation.promise
    }))
    const started = await starting
    await waitFor(() => cancelCalls === 1)
    expect(processes.record?.status).toBe('terminating')
    expect(cancellationSettled).toBe(false)

    cancellation.resolve({ success: true, signal: 'SIGTERM', escalated: false })
    expect(await cancelling).toEqual({
      success: true,
      signal: 'SIGTERM',
      escalated: false,
    })
    pending.resolve(result({ status: 'CANCELLED', exitCode: null, signal: 'SIGTERM' }))
    await started.completion
  })

  test('cancels and observes a spawned handle when running persistence fails', async () => {
    const processes = new MemoryProcesses()
    const originalUpdate = processes.update.bind(processes)
    let rejectRunning = true
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (rejectRunning && candidate.status === 'running') {
        rejectRunning = false
        throw new Error('running persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    let cancelCalls = 0
    let resultObserved = false
    const terminalResult = Promise.resolve(
      result({ status: 'CANCELLED', exitCode: null, signal: 'SIGTERM' }),
    ).then(value => {
      resultObserved = true
      return value
    })
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(terminalResult, async () => {
        cancelCalls += 1
        return { success: true, signal: 'SIGTERM', escalated: false }
      }),
    })

    await expect(controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })).rejects.toThrow('running persistence unavailable')
    expect(cancelCalls).toBe(1)
    expect(resultObserved).toBe(true)
    expect(controller.hasLiveHandle('process-01')).toBe(false)
    expect(processes.record).toMatchObject({
      status: 'lost',
      cancellation_requested_at: timestamp,
      signal: 'SIGTERM',
    })
  })

  test('rejects promptly and retains control when registration cleanup initially fails', async () => {
    const processes = new MemoryProcesses()
    const originalUpdate = processes.update.bind(processes)
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (candidate.status === 'running') {
        throw new Error('running persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    const pending = deferred<RawProcessResult>()
    const signals: string[] = []
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'tree remains alive',
      signal: 'SIGTERM',
    }
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise, async signal => {
        signals.push(signal ?? 'SIGTERM')
        if (signals.length === 1) return failedControl
        return { success: true, signal: 'SIGKILL', escalated: true }
      }),
    })

    const starting = controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })
    await expect(Promise.race([
      starting,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('start remained blocked on a live process result')),
        250,
      )),
    ])).rejects.toThrow('running persistence unavailable')
    expect(signals).toEqual(['SIGTERM'])
    expect(controller.hasLiveHandle('process-01')).toBe(true)
    expect(processes.record?.status).toBe('starting')

    const retry = controller.cancel('process-01', 'SIGKILL')
    await waitFor(() => signals.length === 2)
    pending.resolve(result({ status: 'CANCELLED', exitCode: null, signal: 'SIGKILL' }))
    expect(await retry).toEqual({
      success: true,
      signal: 'SIGKILL',
      escalated: true,
    })
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(controller.hasLiveHandle('process-01')).toBe(false)
    expect(processes.record?.status).toBe('lost')
  })

  test('observes natural exit after failed registration cleanup and releases the handle', async () => {
    const processes = new MemoryProcesses()
    const originalUpdate = processes.update.bind(processes)
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (candidate.status === 'running') {
        throw new Error('running persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    const pending = deferred<RawProcessResult>()
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'tree remains alive',
      signal: 'SIGTERM',
    }
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise, async () => failedControl),
    })

    await expect(controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })).rejects.toThrow('running persistence unavailable')
    expect(controller.hasLiveHandle('process-01')).toBe(true)

    const terminalResult = result({ exitCode: 17, status: 'FAILED' })
    pending.resolve(terminalResult)
    await waitFor(() => processes.record?.status === 'lost')

    expect(processes.record).toMatchObject({
      status: 'lost',
      ended_at: terminalResult.endTime.toISOString(),
      exit_code: 17,
      signal: null,
    })
    expect(controller.hasLiveHandle('process-01')).toBe(false)
  })

  test('failed control remains terminating and a later stronger retry reaches the handle', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'tree remains alive',
      signal: 'SIGTERM',
    }
    const signals: string[] = []
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise, async signal => {
        signals.push(signal ?? 'SIGTERM')
        if (signals.length === 1) return failedControl
        return { success: true, signal: 'SIGKILL', escalated: true }
      }),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    expect(await controller.cancel('process-01')).toEqual(failedControl)
    expect(await controller.cancel('process-01', 'SIGKILL')).toEqual({
      success: true,
      signal: 'SIGKILL',
      escalated: true,
    })
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(processes.record).toMatchObject({
      status: 'terminating',
      cancellation_requested_at: timestamp,
      ended_at: null,
    })

    pending.resolve(result({ exitCode: 17, status: 'FAILED' }))
    expect((await started.completion).process).toMatchObject({
      status: 'exited',
      exit_code: 17,
    })
  })

  test('a thrown control attempt is retryable', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    let cancelCalls = 0
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise, async signal => {
        cancelCalls += 1
        if (cancelCalls === 1) throw new Error('control adapter unavailable')
        return { success: true, signal: signal ?? 'SIGTERM', escalated: true }
      }),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    expect(await controller.cancel('process-01')).toEqual({
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'control adapter unavailable',
      signal: 'SIGTERM',
    })
    expect(await controller.cancel('process-01', 'SIGKILL')).toEqual({
      success: true,
      signal: 'SIGKILL',
      escalated: true,
    })
    expect(cancelCalls).toBe(2)
    pending.resolve(result({ status: 'CANCELLED', exitCode: null, signal: 'SIGKILL' }))
    await started.completion
  })

  test('recovers a transient terminal activity persistence failure without changing exit truth', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    let failRunningActivity = true
    const originalUpdate = processes.update.bind(processes)
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (
        failRunningActivity
        && candidate.status === 'running'
        && candidate.last_output_at !== processes.record?.last_output_at
      ) {
        failRunningActivity = false
        throw new Error('activity persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    let callbacks: Pick<RunnerConfig, 'onOutput'> = {}
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      activityPersistIntervalMs: 60_000,
      startProcess: async config => {
        callbacks = config
        return handle(pending.promise)
      },
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })
    await callbacks.onOutput?.({
      stream: 'stdout',
      at: new Date('2026-07-16T00:00:00.500Z'),
      bytes: 1,
    })
    pending.resolve(result())

    const completion = await started.completion
    expect(completion.error).toBeNull()
    expect(completion.process).toMatchObject({
      status: 'exited',
      last_output_at: '2026-07-16T00:00:00.500Z',
    })
  })

  test('reports persistent activity persistence failure without relabeling verified exit truth', async () => {
    const processes = new MemoryProcesses()
    const pending = deferred<RawProcessResult>()
    const originalUpdate = processes.update.bind(processes)
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (
        candidate.status === 'running'
        && candidate.last_output_at !== processes.record?.last_output_at
      ) {
        throw new Error('activity persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    let callbacks: Pick<RunnerConfig, 'onOutput'> = {}
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      activityPersistIntervalMs: 60_000,
      startProcess: async config => {
        callbacks = config
        return handle(pending.promise)
      },
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })
    await callbacks.onOutput?.({
      stream: 'stdout',
      at: new Date('2026-07-16T00:00:00.500Z'),
      bytes: 1,
    })
    pending.resolve(result())

    const completion = await started.completion
    expect(completion.error?.message).toBe('activity persistence unavailable')
    expect(completion.result?.status).toBe('SUCCESS')
    expect(completion.process.status).toBe('exited')
  })

  test('retries a transient terminal persistence failure before releasing evidence', async () => {
    const processes = new MemoryProcesses()
    const originalUpdate = processes.update.bind(processes)
    let rejectExit = true
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (rejectExit && candidate.status === 'exited') {
        rejectExit = false
        throw new Error('terminal persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    const pending = deferred<RawProcessResult>()
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })

    pending.resolve(result())
    const completion = await started.completion

    expect(completion.error).toBeNull()
    expect(completion.process.status).toBe('exited')
    expect(controller.hasLiveHandle('process-01')).toBe(false)
  })

  test('retains exact terminal evidence until a persistent finalization failure is retried', async () => {
    const processes = new MemoryProcesses()
    const originalUpdate = processes.update.bind(processes)
    let rejectExit = true
    processes.update = async (processId, revision, mutate) => {
      const candidate = mutate(structuredClone(processes.record!))
      if (rejectExit && candidate.status === 'exited') {
        throw new Error('terminal persistence unavailable')
      }
      return originalUpdate(processId, revision, () => candidate)
    }
    const pending = deferred<RawProcessResult>()
    const controller = new ProcessController({
      processes,
      now: () => timestamp,
      startProcess: async () => handle(pending.promise),
    })
    const started = await controller.start({
      processId: 'process-01',
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      runnerConfig: runnerConfig(),
    })
    const terminalResult = result({ exitCode: 17, status: 'FAILED' })

    pending.resolve(terminalResult)
    const completion = await started.completion

    expect(completion.error?.message).toBe('terminal persistence unavailable')
    expect(completion.result).toEqual(terminalResult)
    expect(processes.record?.status).toBe('running')
    expect(controller.hasLiveHandle('process-01')).toBe(true)

    rejectExit = false
    const finalized = await controller.retryFinalization('process-01')
    expect(finalized).toMatchObject({
      status: 'exited',
      ended_at: terminalResult.endTime.toISOString(),
      exit_code: 17,
    })
    expect(controller.hasLiveHandle('process-01')).toBe(false)
  })
})
