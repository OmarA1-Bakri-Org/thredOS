import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PolicyConfigSchema } from '../policy/schema'
import type { Sequence } from '../sequence/schema'
import type { RunnerConfig, RunResult } from '../runner/wrapper'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
import { SequentialScheduler } from './scheduler'
import { ThreadOSRuntimeService } from './service'
import type { RuntimeServiceDependencies } from './service-types'
import { stableRuntimeHash } from './attempt-executor'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from './factory'
import type {
  ProcessControlResult,
  RawProcessResult,
  RunningProcessHandle,
} from '../runner/process-handle'
import { ProcessControlError } from '../runner/process-handle'
import { createTestCompatibilityStartProcess } from './test-compatibility'

const roots: string[] = []
afterEach(async () => {
  clearRuntimeServiceFactoryForTests()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function sequence(stepId = 'build'): Sequence {
  return {
    version: '1',
    id: 'sequence-1',
    name: 'Sequence 1',
    steps: [{
      id: stepId,
      name: stepId,
      type: 'base',
      model: 'shell',
      prompt_file: `.threados/prompts/${stepId}.md`,
      prompt_ref: { id: stepId, version: 1, path: `.threados/prompts/${stepId}.md` },
      status: 'READY',
      depends_on: [],
      side_effect_class: 'execute',
    }],
    gates: [],
    groups: [],
    fusion_rules: [],
  } as Sequence
}

function multiStepSequence(): Sequence {
  const first = sequence('build').steps[0]!
  return {
    ...sequence('build'),
    steps: [
      first,
      {
        ...first,
        id: 'verify',
        name: 'verify',
        prompt_file: '.threados/prompts/verify.md',
        prompt_ref: { id: 'verify', version: 1, path: '.threados/prompts/verify.md' },
      },
    ],
  } as Sequence
}

async function fixture(overrides: Partial<RuntimeServiceDependencies> = {}) {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-service-'))
  roots.push(basePath)
  const calls: string[] = []
  const result: RunResult = {
    stepId: 'build', runId: 'unused', exitCode: 0, status: 'SUCCESS', duration: 4,
    stdout: 'ok', stderr: '', startTime: new Date('2026-01-01T00:00:00.000Z'),
    endTime: new Date('2026-01-01T00:00:00.004Z'),
  }
  const defaultRunStep: NonNullable<RuntimeServiceDependencies['runStep']> = async config => {
    calls.push('run')
    const process = (await new ProcessRepository(basePath).list())[0]
    expect(process?.status).toBe('starting')
    expect(process).toMatchObject({ pid: null, provider_handle: null, started_at: null })
    const attempt = await new AttemptRepository(basePath).get(process!.attempt_id)
    const run = await new RunRepository(basePath).get(process!.workflow_run_id)
    expect(attempt?.status).toBe('running')
    expect(run?.status).toBe('running')
    return { ...result, stepId: config.stepId, runId: config.runId }
  }
  const selectedRunStep = overrides.runStep ?? defaultRunStep
  const dependencies: RuntimeServiceDependencies = {
    now: () => '2026-01-01T00:00:00.000Z',
    newId: (() => { let n = 0; return prefix => `${prefix}-${++n}` })(),
    loadSequence: async () => sequence(),
    loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
    validateSequence: () => undefined,
    validatePrompt: async () => true,
    compilePrompt: async () => 'compiled prompt',
    prepareArtifacts: async () => undefined,
    resolveGateSurface: async () => ({ surfaceClass: 'shared', revealState: null }),
    allowModelExecution: () => ({ allowed: true }),
    dispatch: async (_model, options) => {
      calls.push('dispatch')
      return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: basePath } satisfies RunnerConfig
    },
    runStep: selectedRunStep,
    saveArtifacts: async () => '.threados/runs/artifact',
    readRuntimeEvents: async () => [],
    readApprovals: async () => [],
    evaluatePreGates: () => [],
    evaluateCompletionGates: () => [],
    persistGateDecisions: async () => undefined,
    enforceBatchPolicy: () => ({ allowed: true, confirmation_required: false }),
    enforceExecutablePolicy: () => ({ allowed: true, confirmation_required: false }),
    recordApproval: async () => undefined,
    appendTrace: async () => undefined,
    projections: {
      beginRun: async () => { calls.push('project-begin-run') },
      beginAttempt: async () => { calls.push('project-begin-attempt') },
      finalizeAttempt: async () => { calls.push('project-finalize-attempt') },
      finalizeRun: async () => { calls.push('project-finalize-run') },
    },
    ...overrides,
    startProcess: overrides.startProcess
      ?? createTestCompatibilityStartProcess(selectedRunStep),
  }
  const repositories = {
    runs: new RunRepository(basePath), attempts: new AttemptRepository(basePath),
    processes: new ProcessRepository(basePath), commands: new CommandRepository(basePath),
  }
  const wrap = <T extends { create(value: never): Promise<void> }>(name: string, repository: T): T => {
    const create = repository.create.bind(repository)
    repository.create = (async (value: never) => { calls.push(`${name}:create`); await create(value) }) as T['create']
    return repository
  }
  wrap('run', repositories.runs); wrap('attempt', repositories.attempts); wrap('process', repositories.processes)
  const service = new ThreadOSRuntimeService({
    basePath,
    scheduler: new SequentialScheduler(),
    repositories,
    dependencies,
  })
  return { basePath, calls, dependencies, repositories, service }
}

const context = { actor: 'tester', interface: 'system' as const, idempotencyKey: 'same-key', policyConfirmed: true }
const request = {
  sequence_id: 'sequence-1',
  target: { kind: 'step' as const, step_id: 'build' },
  strategy: 'sequential' as const,
  max_concurrency: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function rawResult(
  runId: string,
  overrides: Partial<RawProcessResult> = {},
): RawProcessResult {
  return {
    stepId: 'build',
    runId,
    exitCode: 0,
    signal: null,
    status: 'SUCCESS',
    duration: 4,
    stdout: 'ok',
    stderr: '',
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    endTime: new Date('2026-01-01T00:00:00.004Z'),
    ...overrides,
  }
}

async function waitForRunningAttempt(
  repositories: Awaited<ReturnType<typeof fixture>>['repositories'],
  runId: string,
) {
  for (let poll = 0; poll < 500; poll++) {
    const attempt = (await repositories.attempts.listForRun(runId))[0]
    const process = attempt?.process_id
      ? await repositories.processes.get(attempt.process_id)
      : null
    if (attempt?.status === 'running' && process?.status === 'running') {
      return { attempt, process }
    }
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`run ${runId} did not reach a controllable attempt`)
}

async function waitForAttemptStatus(
  repositories: Awaited<ReturnType<typeof fixture>>['repositories'],
  runId: string,
  status: 'pending' | 'provisioning' | 'running',
) {
  for (let poll = 0; poll < 500; poll++) {
    const attempt = (await repositories.attempts.listForRun(runId))[0]
    if (attempt?.status === status) return attempt
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`run ${runId} did not reach attempt status ${status}`)
}

describe('ThreadOSRuntimeService', () => {
  test('registration persistence failure with failed cleanup control stays active until stronger cancellation', async () => {
    const terminal = deferred<RawProcessResult>()
    let controls = 0
    let completionSettled = false
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'registration cleanup could not stop the process tree',
      signal: 'SIGTERM',
    }
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 399,
        result: terminal.promise,
        cancel: async signal => {
          controls++
          if (controls === 1) return failedControl
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: true }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const updateProcess = repositories.processes.update.bind(repositories.processes)
    let rejectedRegistration = false
    repositories.processes.update = async (processId, revision, mutate) => {
      const current = await repositories.processes.get(processId)
      const candidate = current ? mutate(structuredClone(current)) : null
      if (!rejectedRegistration && current?.status === 'starting' && candidate?.status === 'running') {
        rejectedRegistration = true
        throw new Error('running process registration unavailable')
      }
      return await updateProcess(processId, revision, mutate)
    }

    const startContext = { ...context, idempotencyKey: 'registration-failure-start' }
    const completion = service.runAndWait(request, startContext)
      .finally(() => { completionSettled = true })
    for (let poll = 0; controls === 0 && poll < 500; poll++) {
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    expect(controls).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 50))

    const attempt = (await repositories.attempts.listForRun('run-1'))[0]!
    expect(completionSettled).toBe(false)
    expect(attempt.status).toBe('running')
    expect(await repositories.runs.get('run-1')).toMatchObject({ status: 'running', ended_at: null })
    expect(await repositories.processes.get(attempt.process_id!)).toMatchObject({
      status: 'starting',
      cancellation_requested_at: expect.any(String),
      ended_at: null,
    })

    const cancelled = await service.cancelAttempt(attempt.id, {
      ...context,
      idempotencyKey: 'registration-failure-cancel',
    })
    expect(cancelled.status).toBe('cancelled')
    expect(controls).toBe(2)
    expect(await repositories.processes.get(attempt.process_id!)).toMatchObject({
      status: 'exited',
      signal: 'SIGTERM',
    })
    expect((await completion).run.status).toBe('cancelled')
  }, 30_000)

  test('failed registration cleanup followed by natural exit remains lost instead of becoming cancelled', async () => {
    const terminal = deferred<RawProcessResult>()
    let controls = 0
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 398,
        result: terminal.promise,
        cancel: async () => {
          controls++
          return {
            success: false,
            code: 'PROCESS_CONTROL_FAILED',
            message: 'registration cleanup could not stop the process tree',
            signal: 'SIGTERM',
          }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const updateProcess = repositories.processes.update.bind(repositories.processes)
    let rejectedRegistration = false
    repositories.processes.update = async (processId, revision, mutate) => {
      const current = await repositories.processes.get(processId)
      const candidate = current ? mutate(structuredClone(current)) : null
      if (!rejectedRegistration && current?.status === 'starting' && candidate?.status === 'running') {
        rejectedRegistration = true
        throw new Error('running process registration unavailable')
      }
      return await updateProcess(processId, revision, mutate)
    }

    const completion = service.runAndWait(request, {
      ...context,
      idempotencyKey: 'registration-natural-start',
    })
    for (let poll = 0; controls === 0 && poll < 500; poll++) {
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    expect(controls).toBe(1)
    terminal.resolve(rawResult('run-1', {
      exitCode: null,
      signal: 'SIGTERM',
      status: 'FAILED',
    }))

    const result = await completion
    expect(result.attempts[0]).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
    })
    expect(result.run.status).toBe('failed')
  }, 30_000)

  test('automatic timeout control failure keeps the run active until stronger control persists death evidence', async () => {
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'timeout could not stop the process tree',
      signal: 'SIGTERM',
    }
    const failedResult = deferred<RawProcessResult>()
    void failedResult.promise.catch(() => undefined)
    let completionSettled = false
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 400,
        result: failedResult.promise,
        cancel: async signal => ({
          success: true,
          signal: signal ?? 'SIGTERM',
          escalated: true,
        }),
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'timeout-control-start' }
    const completion = service.runAndWait(request, startContext)
      .finally(() => { completionSettled = true })
    const active = await waitForRunningAttempt(repositories, 'run-1')
    failedResult.reject(new ProcessControlError(failedControl.message, failedControl))
    await new Promise(resolve => setTimeout(resolve, 1_100))

    expect(completionSettled).toBe(false)
    expect(await repositories.attempts.get(active.attempt.id)).toMatchObject({
      status: 'running',
      ended_at: null,
    })
    expect(await repositories.runs.get(active.attempt.workflow_run_id)).toMatchObject({
      status: 'running',
      ended_at: null,
    })

    const cancelled = await service.cancelAttempt(active.attempt.id, {
      ...context,
      idempotencyKey: 'timeout-control-retry',
    })
    expect(cancelled.status).toBe('cancelled')
    expect((await completion).run.status).toBe('cancelled')
  }, 30_000)

  test('queued run cancellation persists intent, completes without a process, and prevents later spawn', async () => {
    const firstTerminal = deferred<RawProcessResult>()
    let starts = 0
    const { repositories, service } = await fixture({
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 410 + starts,
          result: starts === 1
            ? firstTerminal.promise
            : Promise.resolve(rawResult(config.runId)),
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const firstContext = { ...context, idempotencyKey: 'queued-first' }
    const secondContext = { ...context, idempotencyKey: 'queued-second' }
    const firstCompletion = service.runAndWait(request, firstContext)
    await waitForRunningAttempt(repositories, 'run-1')
    const queued = await service.startRun(request, secondContext)

    const cancelled = await service.cancelRun(queued.id, {
      ...context,
      idempotencyKey: 'queued-cancel',
    })

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellation_requested_at: expect.any(String),
    })
    expect(await repositories.attempts.listForRun(queued.id)).toEqual([])
    firstTerminal.resolve(rawResult('run-1'))
    await firstCompletion
    const queuedCompletion = await service.runAndWait(request, secondContext)
    expect(queuedCompletion.run.status).toBe('cancelled')
    expect(starts).toBe(1)
    expect((await repositories.processes.list()).filter(process => process.workflow_run_id === queued.id)).toEqual([])
  }, 30_000)

  test('provisioning run cancellation terminalizes without a process and blocks the pending spawn race', async () => {
    const releaseCompilation = deferred<void>()
    let starts = 0
    const { repositories, service } = await fixture({
      compilePrompt: async () => {
        await releaseCompilation.promise
        return 'compiled prompt'
      },
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 420,
          result: Promise.resolve(rawResult(config.runId)),
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'provisioning-start' }
    const completion = service.runAndWait(request, startContext)
    await waitForAttemptStatus(repositories, 'run-1', 'provisioning')

    const cancelled = await service.cancelRun('run-1', {
      ...context,
      idempotencyKey: 'provisioning-cancel',
    })
    releaseCompilation.resolve()

    expect(cancelled.status).toBe('cancelled')
    expect((await completion).run.status).toBe('cancelled')
    expect((await repositories.attempts.listForRun('run-1'))[0]).toMatchObject({
      status: 'cancelled',
      process_id: null,
    })
    expect(starts).toBe(0)
    expect(await repositories.processes.list()).toEqual([])
  }, 30_000)

  test('cancellation persisted during the launch trace prevents process spawn', async () => {
    const traceEntered = deferred<void>()
    const releaseTrace = deferred<void>()
    let starts = 0
    const { repositories, service } = await fixture({
      appendTrace: async (_basePath, _runId, event) => {
        if (event.event_type !== 'step-started') return
        traceEntered.resolve()
        await releaseTrace.promise
      },
      startProcess: async config => {
        starts++
        const terminal = deferred<RawProcessResult>()
        return {
          processId: config.processId!,
          pid: 421,
          result: terminal.promise,
          cancel: async signal => {
            terminal.resolve(rawResult(config.runId, {
              exitCode: null,
              signal: signal ?? 'SIGTERM',
              status: 'CANCELLED',
            }))
            return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
          },
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'trace-race-start' }
    const completion = service.runAndWait(request, startContext)
    await traceEntered.promise
    const cancellation = service.cancelRun('run-1', {
      ...context,
      idempotencyKey: 'trace-race-cancel',
    })
    for (let poll = 0; poll < 500; poll++) {
      if ((await repositories.runs.get('run-1'))?.cancellation_requested_at) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    releaseTrace.resolve()

    expect((await cancellation).status).toBe('cancelled')
    expect((await completion).run.status).toBe('cancelled')
    expect(starts).toBe(0)
    expect(await repositories.processes.list()).toEqual([])
  }, 30_000)

  test('the final launch observation runs after refreshed run and attempt reads', async () => {
    const launchReadEntered = deferred<void>()
    const releaseLaunchRead = deferred<void>()
    let starts = 0
    let readsAfterTrace = 0
    let traceWritten = false
    const { repositories, service } = await fixture({
      appendTrace: async (_basePath, _runId, event) => {
        if (event.event_type === 'step-started') traceWritten = true
      },
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 421,
          result: Promise.resolve(rawResult(config.runId)),
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const getRun = repositories.runs.get.bind(repositories.runs)
    repositories.runs.get = async runId => {
      if (traceWritten && ++readsAfterTrace === 2) {
        launchReadEntered.resolve()
        await releaseLaunchRead.promise
      }
      return await getRun(runId)
    }

    const completion = service.runAndWait(request, {
      ...context,
      idempotencyKey: 'final-launch-check-start',
    })
    await launchReadEntered.promise
    const cancellation = service.cancelRun('run-1', {
      ...context,
      idempotencyKey: 'final-launch-check-cancel',
    })
    for (let poll = 0; poll < 500; poll++) {
      if ((await getRun('run-1'))?.cancellation_requested_at) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    releaseLaunchRead.resolve()

    expect((await cancellation).status).toBe('cancelled')
    expect((await completion).run.status).toBe('cancelled')
    expect(starts).toBe(0)
    expect(await repositories.processes.list()).toEqual([])
  }, 30_000)

  test('cancellation waits through delayed process registration and controls the published handle', async () => {
    const processPersisted = deferred<void>()
    const releaseProcessCreate = deferred<void>()
    const terminal = deferred<RawProcessResult>()
    let starts = 0
    let controls = 0
    const { repositories, service } = await fixture({
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 422,
          result: terminal.promise,
          cancel: async signal => {
            controls++
            terminal.resolve(rawResult(config.runId, {
              exitCode: null,
              signal: signal ?? 'SIGTERM',
              status: 'CANCELLED',
            }))
            return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
          },
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const createProcess = repositories.processes.create.bind(repositories.processes)
    repositories.processes.create = async value => {
      await createProcess(value)
      processPersisted.resolve()
      await releaseProcessCreate.promise
    }

    const startContext = { ...context, idempotencyKey: 'registration-race-start' }
    const completion = service.runAndWait(request, startContext)
    await processPersisted.promise
    const attempt = (await repositories.attempts.listForRun('run-1'))[0]!
    expect(await repositories.processes.get(attempt.process_id!)).toMatchObject({ status: 'planned' })

    const cancellation = service.cancelAttempt(attempt.id, {
      ...context,
      idempotencyKey: 'registration-race-cancel',
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    releaseProcessCreate.resolve()

    expect((await cancellation).status).toBe('cancelled')
    expect((await completion).run.status).toBe('cancelled')
    expect(starts).toBe(1)
    expect(controls).toBe(1)
  }, 30_000)

  test('immediate duplicate cancel-attempt calls publish one owner before the durable claim returns', async () => {
    const terminal = deferred<RawProcessResult>()
    let controls = 0
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 423,
        result: terminal.promise,
        cancel: async signal => {
          controls++
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const run = await service.startRun(request, { ...context, idempotencyKey: 'immediate-attempt-start' })
    const active = await waitForRunningAttempt(repositories, run.id)
    const createOrReplay = repositories.commands.createOrReplay.bind(repositories.commands)
    let claims = 0
    repositories.commands.createOrReplay = async value => {
      const claim = ++claims
      const receipt = await createOrReplay(value)
      if (claim === 1) await new Promise(resolve => setTimeout(resolve, 50))
      return receipt
    }
    const cancelContext = { ...context, idempotencyKey: 'immediate-attempt-cancel' }

    const [first, replay] = await Promise.all([
      service.cancelAttempt(active.attempt.id, cancelContext),
      service.cancelAttempt(active.attempt.id, cancelContext),
    ])

    expect(first.status).toBe('cancelled')
    expect(replay.id).toBe(first.id)
    expect(controls).toBe(1)
    expect(claims).toBe(1)
  }, 30_000)

  test('immediate duplicate cancel-run calls publish one owner before the durable claim returns', async () => {
    const terminal = deferred<RawProcessResult>()
    let controls = 0
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 424,
        result: terminal.promise,
        cancel: async signal => {
          controls++
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const run = await service.startRun(request, { ...context, idempotencyKey: 'immediate-run-start' })
    await waitForRunningAttempt(repositories, run.id)
    const createOrReplay = repositories.commands.createOrReplay.bind(repositories.commands)
    let claims = 0
    repositories.commands.createOrReplay = async value => {
      const claim = ++claims
      const receipt = await createOrReplay(value)
      if (claim === 1) await new Promise(resolve => setTimeout(resolve, 50))
      return receipt
    }
    const cancelContext = { ...context, idempotencyKey: 'immediate-run-cancel' }

    const [first, replay] = await Promise.all([
      service.cancelRun(run.id, cancelContext),
      service.cancelRun(run.id, cancelContext),
    ])

    expect(first.status).toBe('cancelled')
    expect(replay.id).toBe(first.id)
    expect(controls).toBe(1)
    expect(claims).toBe(1)
  }, 30_000)

  test('concurrent cancel-attempt replay rejoins the in-flight controller operation without receipt polling', async () => {
    const terminal = deferred<RawProcessResult>()
    const controlStarted = deferred<void>()
    const releaseControl = deferred<void>()
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 430,
        result: terminal.promise,
        cancel: async signal => {
          controlStarted.resolve()
          await releaseControl.promise
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const run = await service.startRun(request, { ...context, idempotencyKey: 'slow-attempt-start' })
    const active = await waitForRunningAttempt(repositories, run.id)
    const cancelContext = { ...context, idempotencyKey: 'slow-attempt-cancel' }
    const first = service.cancelAttempt(active.attempt.id, cancelContext)
    await controlStarted.promise
    repositories.commands.get = async () => {
      throw new Error('in-flight cancellation replay must not poll its receipt')
    }
    const replay = service.cancelAttempt(active.attempt.id, cancelContext)
    await new Promise(resolve => setTimeout(resolve, 30))
    releaseControl.resolve()

    const [firstResult, replayResult] = await Promise.all([first, replay])

    expect(firstResult.status).toBe('cancelled')
    expect(replayResult.status).toBe('cancelled')
    expect(firstResult.id).toBe(replayResult.id)
  }, 30_000)

  test('concurrent cancel-run replay rejoins the in-flight controller operation without receipt polling', async () => {
    const terminal = deferred<RawProcessResult>()
    const controlStarted = deferred<void>()
    const releaseControl = deferred<void>()
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 440,
        result: terminal.promise,
        cancel: async signal => {
          controlStarted.resolve()
          await releaseControl.promise
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const run = await service.startRun(request, { ...context, idempotencyKey: 'slow-run-start' })
    await waitForRunningAttempt(repositories, run.id)
    const cancelContext = { ...context, idempotencyKey: 'slow-run-cancel' }
    const first = service.cancelRun(run.id, cancelContext)
    await controlStarted.promise
    repositories.commands.get = async () => {
      throw new Error('in-flight cancellation replay must not poll its receipt')
    }
    const replay = service.cancelRun(run.id, cancelContext)
    await new Promise(resolve => setTimeout(resolve, 30))
    releaseControl.resolve()

    const [firstResult, replayResult] = await Promise.all([first, replay])

    expect(firstResult.status).toBe('cancelled')
    expect(replayResult.status).toBe('cancelled')
    expect(firstResult.id).toBe(replayResult.id)
  }, 30_000)

  test('accepted cancellation replay without an owning controller fails safely when terminal evidence is absent', async () => {
    const terminal = deferred<RawProcessResult>()
    const { basePath, dependencies, repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 445,
        result: terminal.promise,
        cancel: async signal => ({
          success: true,
          signal: signal ?? 'SIGTERM',
          escalated: false,
        }),
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'orphaned-cancel-start' }
    const run = await service.startRun(request, startContext)
    const active = await waitForRunningAttempt(repositories, run.id)
    const cancelContext = { ...context, idempotencyKey: 'orphaned-cancel-command' }
    await repositories.commands.createOrReplay({
      schema_version: 1,
      id: 'orphaned-command',
      idempotency_key: cancelContext.idempotencyKey,
      command_type: 'cancel-attempt',
      request_hash: stableRuntimeHash({
        commandType: 'cancel-attempt',
        targetId: active.attempt.id,
        actor: cancelContext.actor,
        interface: cancelContext.interface,
        policyConfirmed: cancelContext.policyConfirmed,
      }),
      status: 'accepted',
      result_ref: active.attempt.id,
      error_code: null,
      error_message: null,
      created_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
    })
    const freshService = new ThreadOSRuntimeService({
      basePath,
      scheduler: new SequentialScheduler(),
      repositories,
      dependencies,
    })

    await expect(freshService.cancelAttempt(active.attempt.id, cancelContext))
      .rejects.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })
    expect(await repositories.attempts.get(active.attempt.id)).toMatchObject({
      status: 'running',
      ended_at: null,
    })
    expect(await repositories.commands.get('orphaned-command')).toMatchObject({
      status: 'accepted',
      result_ref: active.attempt.id,
    })

    terminal.resolve(rawResult(run.id))
    await service.runAndWait(request, startContext)
  }, 30_000)

  test('canonical service construction rejects a missing process starter', async () => {
    const { basePath, dependencies, repositories } = await fixture()
    const { startProcess: _startProcess, ...missingStarter } = dependencies
    expect(() => new ThreadOSRuntimeService({
      basePath,
      scheduler: new SequentialScheduler(),
      repositories,
      dependencies: missingStarter as RuntimeServiceDependencies,
    })).toThrow('startProcess')
  })

  test('successful attempt cancellation reaches the controller and waits for truthful terminal state', async () => {
    const terminal = deferred<RawProcessResult>()
    const signals: string[] = []
    const saved: RunResult[] = []
    let launchedRunId = ''
    const { repositories, service } = await fixture({
      startProcess: async config => {
        launchedRunId = config.runId
        return {
          processId: config.processId!,
          pid: 401,
          result: terminal.promise,
          cancel: async signal => {
            signals.push(signal ?? 'SIGTERM')
            terminal.resolve(rawResult(config.runId, {
              exitCode: null,
              signal: signal ?? 'SIGTERM',
              status: 'CANCELLED',
            }))
            return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
          },
        } satisfies RunningProcessHandle
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
      saveArtifacts: async (_basePath, result) => {
        saved.push(result)
        return '.threados/runs/artifact'
      },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'cancel-attempt-start' }
    const run = await service.startRun(request, startContext)
    const active = await waitForRunningAttempt(repositories, run.id)

    const cancelled = await service.cancelAttempt(active.attempt.id, {
      ...context,
      idempotencyKey: 'cancel-attempt-control',
    })

    expect(launchedRunId).toBe(run.id)
    expect(signals).toEqual(['SIGTERM'])
    expect(cancelled).toMatchObject({
      id: active.attempt.id,
      status: 'cancelled',
      signal: 'SIGTERM',
      artifact_manifest_ref: `.threados/runs/${run.id}/surfaces/thread-build/artifact.manifest.json`,
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ status: 'ERROR', exitCode: null })
    expect(await repositories.processes.get(active.process.id)).toMatchObject({
      status: 'exited',
      cancellation_requested_at: expect.any(String),
      signal: 'SIGTERM',
    })
    expect((await repositories.commands.findByIdempotencyKey('cancel-attempt-control'))).toMatchObject({
      status: 'completed',
      result_ref: active.attempt.id,
    })
    expect((await service.runAndWait(request, startContext)).run.status).toBe('cancelled')
  }, 30_000)

  test('failed process control leaves the attempt running and fails the command receipt', async () => {
    const terminal = deferred<RawProcessResult>()
    const failedControl: ProcessControlResult = {
      success: false,
      code: 'PROCESS_CONTROL_FAILED',
      message: 'tree remains alive',
      signal: 'SIGTERM',
    }
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 402,
        result: terminal.promise,
        cancel: async () => failedControl,
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'failed-control-start' }
    const run = await service.startRun(request, startContext)
    const active = await waitForRunningAttempt(repositories, run.id)

    await expect(service.cancelAttempt(active.attempt.id, {
      ...context,
      idempotencyKey: 'failed-control-command',
    })).rejects.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })

    expect(await repositories.attempts.get(active.attempt.id)).toMatchObject({ status: 'running' })
    expect(await repositories.processes.get(active.process.id)).toMatchObject({
      status: 'terminating',
      ended_at: null,
    })
    expect(await repositories.commands.findByIdempotencyKey('failed-control-command')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_CONTROL_FAILED',
    })
    await expect(service.cancelRun(run.id, {
      ...context,
      idempotencyKey: 'failed-run-control-command',
    })).rejects.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })
    expect(await repositories.runs.get(run.id)).toMatchObject({
      status: 'running',
      cancellation_requested_at: expect.any(String),
    })

    terminal.resolve(rawResult(run.id, { exitCode: 17, status: 'FAILED', stderr: 'failed' }))
    expect((await service.runAndWait(request, startContext)).run.status).toBe('failed')
  }, 30_000)

  test('run cancellation persists intent and controls its active attempt through the same controller', async () => {
    const terminal = deferred<RawProcessResult>()
    const controlled: string[] = []
    const { repositories, service } = await fixture({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 403,
        result: terminal.promise,
        cancel: async signal => {
          controlled.push(config.processId!)
          terminal.resolve(rawResult(config.runId, {
            exitCode: null,
            signal: signal ?? 'SIGTERM',
            status: 'CANCELLED',
          }))
          return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
        },
      }),
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const startContext = { ...context, idempotencyKey: 'cancel-run-start' }
    const run = await service.startRun(request, startContext)
    const active = await waitForRunningAttempt(repositories, run.id)

    const cancelled = await service.cancelRun(run.id, {
      ...context,
      idempotencyKey: 'cancel-run-control',
    })

    expect(controlled).toEqual([active.process.id])
    expect(cancelled).toMatchObject({
      id: run.id,
      status: 'cancelled',
      cancellation_requested_at: expect.any(String),
    })
    expect(await repositories.attempts.get(active.attempt.id)).toMatchObject({ status: 'cancelled' })
    expect(await repositories.commands.findByIdempotencyKey('cancel-run-control')).toMatchObject({
      status: 'completed',
      result_ref: run.id,
    })
  }, 30_000)

  test('cancelling the active attempt in a sequential multi-step run prevents later attempts', async () => {
    const firstTerminal = deferred<RawProcessResult>()
    let starts = 0
    const { repositories, service } = await fixture({
      loadSequence: async () => multiStepSequence(),
      startProcess: async config => {
        starts++
        const terminal = starts === 1
          ? firstTerminal
          : { promise: Promise.resolve(rawResult(config.runId, { stepId: config.stepId })) }
        return {
          processId: config.processId!,
          pid: 450 + starts,
          result: terminal.promise,
          cancel: async signal => {
            firstTerminal.resolve(rawResult(config.runId, {
              stepId: config.stepId,
              exitCode: null,
              signal: signal ?? 'SIGTERM',
              status: 'CANCELLED',
            }))
            return { success: true, signal: signal ?? 'SIGTERM', escalated: false }
          },
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const multiRequest = { ...request, target: { kind: 'runnable' as const } }
    const startContext = { ...context, idempotencyKey: 'multi-active-start' }
    const completion = service.runAndWait(multiRequest, startContext)
    const active = await waitForRunningAttempt(repositories, 'run-1')

    expect((await service.cancelAttempt(active.attempt.id, {
      ...context,
      idempotencyKey: 'multi-active-cancel',
    })).status).toBe('cancelled')
    const result = await completion

    expect(result.run.status).toBe('cancelled')
    expect(await repositories.attempts.listForRun(result.run.id)).toHaveLength(1)
    expect(starts).toBe(1)
  }, 30_000)

  test('run cancellation between sequential attempts completes truthfully without appending another attempt', async () => {
    const firstFinalized = deferred<void>()
    const releaseFirst = deferred<void>()
    let starts = 0
    const { repositories, service } = await fixture({
      loadSequence: async () => multiStepSequence(),
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 460 + starts,
          result: Promise.resolve(rawResult(config.runId, { stepId: config.stepId })),
          cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
      projections: {
        beginRun: async () => undefined,
        beginAttempt: async () => undefined,
        finalizeAttempt: async ({ attempt }) => {
          if (attempt.step_id !== 'build') return
          firstFinalized.resolve()
          await releaseFirst.promise
        },
        finalizeRun: async () => undefined,
      },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const multiRequest = { ...request, target: { kind: 'runnable' as const } }
    const startContext = { ...context, idempotencyKey: 'multi-between-start' }
    const completion = service.runAndWait(multiRequest, startContext)
    await firstFinalized.promise
    expect((await repositories.attempts.listForRun('run-1'))[0]?.status).toBe('completed')

    const cancellation = service.cancelRun('run-1', {
      ...context,
      idempotencyKey: 'multi-between-cancel',
    })
    for (let poll = 0; poll < 500; poll++) {
      if ((await repositories.runs.get('run-1'))?.cancellation_requested_at) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    releaseFirst.resolve()

    expect((await cancellation).status).toBe('cancelled')
    const result = await completion
    expect(result.run.status).toBe('cancelled')
    expect(await repositories.attempts.listForRun(result.run.id)).toHaveLength(1)
    expect(starts).toBe(1)
  }, 30_000)

  test('cancellation after reserving a second attempt waits for its attached record and prevents spawn', async () => {
    const secondCreateEntered = deferred<void>()
    const releaseSecondCreate = deferred<void>()
    let starts = 0
    const { repositories, service } = await fixture({
      loadSequence: async () => multiStepSequence(),
      startProcess: async config => {
        starts++
        return {
          processId: config.processId!,
          pid: 470 + starts,
          result: Promise.resolve(rawResult(config.runId, { stepId: config.stepId })),
          cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
        }
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const createAttempt = repositories.attempts.create.bind(repositories.attempts)
    repositories.attempts.create = async attempt => {
      if (attempt.step_id === 'verify') {
        secondCreateEntered.resolve()
        await releaseSecondCreate.promise
      }
      await createAttempt(attempt)
    }

    const multiRequest = { ...request, target: { kind: 'runnable' as const } }
    const startContext = { ...context, idempotencyKey: 'reserved-attempt-start' }
    const completion = service.runAndWait(multiRequest, startContext)
    await secondCreateEntered.promise
    expect(await repositories.runs.get('run-1')).toMatchObject({
      attempt_ids: ['attempt-3', 'attempt-5'],
    })

    const cancellation = service.cancelRun('run-1', {
      ...context,
      idempotencyKey: 'reserved-attempt-cancel',
    })
    for (let poll = 0; poll < 500; poll++) {
      if ((await repositories.runs.get('run-1'))?.cancellation_requested_at) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    releaseSecondCreate.resolve()

    expect((await cancellation).status).toBe('cancelled')
    const result = await completion
    const run = await repositories.runs.get(result.run.id)
    const attempts = await repositories.attempts.listForRun(result.run.id)
    expect(run?.status).toBe('cancelled')
    expect(attempts.map(attempt => attempt.id)).toEqual(run!.attempt_ids)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({ step_id: 'verify', status: 'cancelled' })
    expect(starts).toBe(1)
    expect(await repositories.commands.findByIdempotencyKey('reserved-attempt-cancel'))
      .toMatchObject({ status: 'completed', result_ref: result.run.id })
  }, 30_000)

  test('runs one attempt without an API or CLI and persists truthful canonical state before runner invocation', async () => {
    const { basePath, calls, service } = await fixture()
    const completed = await service.runAndWait(request, context)
    expect(completed.run.status).toBe('successful')
    expect(completed.attempts).toHaveLength(1)
    expect(completed.attempts[0]?.status).toBe('completed')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('exited')
    const process = (await new ProcessRepository(basePath).list())[0]!
    expect(process).toMatchObject({
      command: 'sh',
      redacted_args: [],
      cwd: basePath,
      pid: expect.any(Number),
      provider_handle: expect.stringMatching(/^pid:/),
    })
    expect(completed.run).toMatchObject({ baseline_snapshot_id: null, max_concurrency: 1, strategy: 'sequential' })
    expect(completed.attempts[0]).toMatchObject({ baseline_snapshot_id: null, workspace_id: null })
    expect(calls.indexOf('run:create')).toBeLessThan(calls.indexOf('attempt:create'))
    expect(calls.indexOf('attempt:create')).toBeLessThan(calls.indexOf('process:create'))
    expect(calls.indexOf('process:create')).toBeLessThan(calls.indexOf('run'))
    expect(calls.filter(call => call === 'project-begin-run')).toHaveLength(1)
    expect(calls.filter(call => call === 'project-finalize-run')).toHaveLength(1)
  }, 30_000)

  test('replays the same idempotency request without a second process and conflicts on changed payload', async () => {
    const { basePath, service } = await fixture()
    const [first, concurrent] = await Promise.all([service.runAndWait(request, context), service.runAndWait(request, context)])
    const replay = await service.runAndWait(request, context)
    expect(replay.run.id).toBe(first.run.id)
    expect(concurrent.run.id).toBe(first.run.id)
    expect(await new ProcessRepository(basePath).list()).toHaveLength(1)
    const receipt = (await new CommandRepository(basePath).list())[0]
    expect(receipt).toMatchObject({ status: 'completed', result_ref: first.run.id })
    await expect(service.startRun({ ...request, target: { kind: 'runnable' } }, context)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  }, 30_000)

  test('scheduler is FIFO and never observes more than one active job', async () => {
    const scheduler = new SequentialScheduler()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const work = (id: string) => scheduler.enqueue(id, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start:${id}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push(`end:${id}`)
      active--
      return id
    })
    await Promise.all([work('a'), work('b'), work('c')])
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
    expect(maxActive).toBe(1)
    expect(scheduler.maxConcurrency).toBe(1)
  })

  test('rejects unavailable parallel strategies truthfully', async () => {
    const { service } = await fixture()
    await expect(service.startRun({ ...request, strategy: 'race', max_concurrency: 2 }, context)).rejects.toMatchObject({ code: 'PARALLEL_RUNTIME_UNAVAILABLE' })
  })

  test('status projection prefers retry lineage when timestamps and execution indexes tie', async () => {
    const { repositories, service } = await fixture({
      runStep: async config => ({
        stepId: config.stepId, runId: config.runId, exitCode: 0, status: 'SUCCESS', duration: 1,
        stdout: 'ok', stderr: '', startTime: new Date('2026-01-01T00:00:00.000Z'),
        endTime: new Date('2026-01-01T00:00:00.001Z'),
      }),
    })
    const first = await service.runAndWait(request, context)
    const original = first.attempts[0]!
    const retried = await service.retryAttempt(original.id, {
      ...context, idempotencyKey: 'retry-status-key',
    })
    let latest = await service.inspectAttempt(retried.id)
    for (let poll = 0; latest.attempt.status !== 'completed' && poll < 200; poll++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      latest = await service.inspectAttempt(retried.id)
    }
    const originalProjection = await service.inspectAttempt(original.id)
    expect(originalProjection.process?.id).toBeTruthy()
    expect(latest.process?.id).toBeTruthy()
    expect(latest.process?.id).not.toBe(originalProjection.process?.id)
    expect(await repositories.processes.list()).toHaveLength(2)
    await repositories.attempts.update(original.id, original.revision, current => ({
      ...current, status: 'failed', error_code: 'PROCESS_EXIT_FAILED', error_message: 'older attempt',
    }))

    const status = await service.getStatus()
    expect(status.steps[0]).toMatchObject({ id: 'build', status: 'DONE' })
  }, 30_000)

  test('status projection lets canonical attempts override the sequence fallback', async () => {
    const { service } = await fixture()
    await service.runAndWait(request, context)

    const status = await service.getStatus()
    expect(status.steps[0]).toMatchObject({ id: 'build', status: 'DONE' })
    expect(status.summary).toMatchObject({ running: 0, done: 1, failed: 0 })
  }, 30_000)

  test('canonical hashes ignore object insertion order without dropping nested fields', () => {
    expect(stableRuntimeHash({ a: { x: 1, y: 2 }, b: 3 })).toBe(stableRuntimeHash({ b: 3, a: { y: 2, x: 1 } }))
    expect(stableRuntimeHash({ a: { x: 1 } })).not.toBe(stableRuntimeHash({ a: { x: 2 } }))
  })

  test('factory keys singleton identity by canonical base path and reconciles once', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-factory-'))
    roots.push(basePath)
    let reconciliations = 0
    const first = getThreadOSRuntimeService(basePath, { reconcile: async () => { reconciliations++ } })
    const second = getThreadOSRuntimeService(join(basePath, '.'), { reconcile: async () => { reconciliations++ } })
    const [left, right] = await Promise.all([first, second])
    expect(left).toBe(right)
    expect(reconciliations).toBe(1)
  })

  test('concurrent replay waits for the accepted run to finish instead of returning pending', async () => {
    const { basePath, repositories, service } = await fixture()
    const originalCreate = repositories.runs.create.bind(repositories.runs)
    let releaseCreate!: () => void
    let persisted!: () => void
    const release = new Promise<void>(resolve => { releaseCreate = resolve })
    const persistedRun = new Promise<void>(resolve => { persisted = resolve })
    let first = true
    repositories.runs.create = async value => {
      await originalCreate(value)
      if (!first) return
      first = false
      persisted()
      await release
    }

    const firstRun = service.runAndWait(request, context)
    await persistedRun
    let replayResolved = false
    const replay = service.runAndWait(request, context).then(result => { replayResolved = true; return result })
    await new Promise(resolve => setTimeout(resolve, 1_500))
    expect(replayResolved).toBe(false)
    releaseCreate()
    const [left, right] = await Promise.all([firstRun, replay])
    expect(left.run.status).toBe('successful')
    expect(right.run.status).toBe('successful')
    expect(right.run.id).toBe(left.run.id)
    expect(await new ProcessRepository(basePath).list()).toHaveLength(1)
  }, 30_000)

  test('finalizeRun projection failure cannot downgrade a successful receipt or replay the runner', async () => {
    let runners = 0
    const projectionError = async () => { throw new Error('projection failed') }
    const { basePath, service } = await fixture({
      runStep: async config => {
        runners++
        const now = new Date()
        return { stepId: config.stepId, runId: config.runId, exitCode: 0, status: 'SUCCESS', duration: 1, stdout: '', stderr: '', startTime: now, endTime: now }
      },
      projections: {
        beginRun: async () => undefined,
        beginAttempt: async () => undefined,
        finalizeAttempt: async () => undefined,
        finalizeRun: projectionError,
      },
    })
    const first = await service.runAndWait(request, context)
    const replay = await service.runAndWait(request, context)
    expect(first.run.status).toBe('successful')
    expect(replay.run.status).toBe('successful')
    expect((await new CommandRepository(basePath).list())[0]?.status).toBe('completed')
    expect(runners).toBe(1)
  }, 30_000)

  test('fresh replay repairs an accepted receipt from terminal run truth without spawning again', async () => {
    let runners = 0
    const { basePath, dependencies, repositories, service } = await fixture({
      runStep: async config => {
        runners++
        const now = new Date()
        return { stepId: config.stepId, runId: config.runId, exitCode: 0, status: 'SUCCESS', duration: 1, stdout: '', stderr: '', startTime: now, endTime: now }
      },
    })
    const complete = repositories.commands.complete.bind(repositories.commands)
    let failures = 2
    repositories.commands.complete = async (...args) => {
      if (failures-- > 0) throw new Error('receipt storage unavailable')
      return await complete(...args)
    }

    const first = await service.runAndWait(request, context)
    expect(first.run.status).toBe('successful')
    expect((await repositories.commands.list())[0]?.status).toBe('accepted')
    repositories.commands.complete = complete

    const fresh = new ThreadOSRuntimeService({
      basePath,
      scheduler: new SequentialScheduler(),
      repositories,
      dependencies,
    })
    const replay = await Promise.race([
      fresh.runAndWait(request, context),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('replay did not settle')), 5_000)),
    ])
    expect(replay.run.id).toBe(first.run.id)
    expect(replay.run.status).toBe('successful')
    expect(replay.replayed).toBe(true)
    expect(runners).toBe(1)
    expect((await repositories.commands.list())[0]).toMatchObject({ status: 'completed', result_ref: first.run.id })
  }, 30_000)
})
