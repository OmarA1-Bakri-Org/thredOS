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

async function fixture(overrides: Partial<RuntimeServiceDependencies> = {}) {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-service-'))
  roots.push(basePath)
  const calls: string[] = []
  const result: RunResult = {
    stepId: 'build', runId: 'unused', exitCode: 0, status: 'SUCCESS', duration: 4,
    stdout: 'ok', stderr: '', startTime: new Date('2026-01-01T00:00:00.000Z'),
    endTime: new Date('2026-01-01T00:00:00.004Z'),
  }
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
    runStep: async config => {
      calls.push('run')
      const process = (await new ProcessRepository(basePath).list())[0]
      expect(process?.status).toBe('starting')
      expect(process).toMatchObject({ pid: null, provider_handle: null, started_at: null })
      const attempt = await new AttemptRepository(basePath).get(process!.attempt_id)
      const run = await new RunRepository(basePath).get(process!.workflow_run_id)
      expect(attempt?.status).toBe('running')
      expect(run?.status).toBe('running')
      return { ...result, stepId: config.stepId, runId: config.runId }
    },
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

describe('ThreadOSRuntimeService', () => {
  test('runs one attempt without an API or CLI and persists truthful canonical state before runner invocation', async () => {
    const { basePath, calls, service } = await fixture()
    const completed = await service.runAndWait(request, context)
    expect(completed.run.status).toBe('successful')
    expect(completed.attempts).toHaveLength(1)
    expect(completed.attempts[0]?.status).toBe('completed')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('exited')
    const process = (await new ProcessRepository(basePath).list())[0]!
    expect(process).toMatchObject({ command: 'sh', redacted_args: [], cwd: basePath, pid: null, provider_handle: null })
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
