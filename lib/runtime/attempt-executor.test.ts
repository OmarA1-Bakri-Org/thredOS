import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { RunRepository } from './run-repository'
import { transitionRun } from './lifecycle'
import { RuntimeServiceError } from './errors'
import { ThreadOSRuntimeService } from './service'
import { SequentialScheduler } from './scheduler'
import { AttemptRepository } from './attempt-repository'
import { ProcessRepository } from './process-repository'
import { CommandRepository } from './command-repository'
import type { RuntimeServiceDependencies } from './service-types'
import { PolicyConfigSchema } from '../policy/schema'
import type { Sequence } from '../sequence/schema'
import { evaluateStepGates } from '../gates/engine'
import { ProcessTimeoutError } from '../errors'
import type { Approval } from '../contracts/schemas'
import { executableSubjectDigest } from '../policy/executable'
import type { RawProcessResult, RunningProcessHandle } from '../runner/process-handle'
import type { RunResult } from '../runner/wrapper'
import { createTestCompatibilityStartProcess } from './test-compatibility'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function seq(): Sequence {
  return { version: '1', id: 's', name: 's', gates: [], groups: [], fusion_rules: [], steps: [{
    id: 'x', name: 'x', type: 'base', model: 'shell', prompt_file: '.threados/prompts/x.md',
    prompt_ref: { id: 'x', version: 1, path: '.threados/prompts/x.md' }, status: 'READY', depends_on: [], side_effect_class: 'execute',
  }] } as Sequence
}

async function make(overrides: Partial<RuntimeServiceDependencies>) {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-attempt-')); roots.push(basePath)
  let id = 0
  const defaultRunStep: NonNullable<RuntimeServiceDependencies['runStep']> = async c => ({
    stepId: c.stepId, runId: c.runId, exitCode: 0, status: 'SUCCESS', duration: 1,
    stdout: '', stderr: '', startTime: new Date(), endTime: new Date(),
  })
  const selectedRunStep = overrides.runStep ?? defaultRunStep
  const deps: RuntimeServiceDependencies = {
    now: () => '2026-01-01T00:00:00.000Z', newId: p => `${p}-${++id}`,
    loadSequence: async () => seq(), loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
    validateSequence: () => undefined, validatePrompt: async () => true, compilePrompt: async () => 'prompt',
    prepareArtifacts: async () => undefined,
    resolveGateSurface: async () => ({ surfaceClass: 'shared', revealState: null }),
    allowModelExecution: () => ({ allowed: true }),
    dispatch: async (_m, o) => ({ stepId: o.stepId, runId: o.runId, command: 'sh', args: [], cwd: basePath }),
    runStep: selectedRunStep,
    saveArtifacts: async () => 'artifact', readRuntimeEvents: async () => [], readApprovals: async () => [],
    evaluatePreGates: () => [], evaluateCompletionGates: () => [], persistGateDecisions: async () => undefined,
    enforceBatchPolicy: () => ({ allowed: true, confirmation_required: false }), enforceExecutablePolicy: () => ({ allowed: true, confirmation_required: false }),
    recordApproval: async () => undefined, appendTrace: async () => undefined,
    projections: { beginRun: async () => undefined, beginAttempt: async () => undefined, finalizeAttempt: async () => undefined, finalizeRun: async () => undefined },
    ...overrides,
    startProcess: overrides.startProcess
      ?? createTestCompatibilityStartProcess(selectedRunStep),
  }
  return { basePath, service: new ThreadOSRuntimeService({ basePath, scheduler: new SequentialScheduler(), repositories: {
    runs: new RunRepository(basePath), attempts: new AttemptRepository(basePath), processes: new ProcessRepository(basePath), commands: new CommandRepository(basePath),
  }, dependencies: deps }) }
}

const context = { actor: 't', interface: 'system' as const, idempotencyKey: 'k', policyConfirmed: true }
const cmd = { sequence_id: 's', target: { kind: 'step' as const, step_id: 'x' }, strategy: 'sequential' as const, max_concurrency: 1 }

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
  overrides: Partial<RawProcessResult> = {},
): RawProcessResult {
  return {
    stepId: 'x',
    runId: 'run-1',
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

describe('AttemptExecutor and lifecycle', () => {
  test('controller owns launch persistence and maps verified success after completion gates', async () => {
    const terminal = deferred<RawProcessResult>()
    const starts: string[] = []
    const { basePath, service } = await make({
      startProcess: async config => {
        starts.push(config.processId ?? '')
        const process = (await new ProcessRepository(basePath).list())[0]
        const attempt = await new AttemptRepository(basePath).get(process!.attempt_id)
        const run = await new RunRepository(basePath).get(process!.workflow_run_id)
        expect(process).toMatchObject({
          id: config.processId,
          status: 'starting',
          pid: null,
          provider_handle: null,
        })
        expect(attempt).toMatchObject({ status: 'running', process_id: config.processId })
        expect(run?.status).toBe('running')
        return {
          processId: config.processId!,
          pid: 321,
          result: terminal.promise,
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        } satisfies RunningProcessHandle
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })

    const completion = service.runAndWait(cmd, context)
    while (starts.length === 0) await new Promise(resolve => setTimeout(resolve, 1))
    terminal.resolve(rawResult())
    const out = await completion

    expect(out.run.status).toBe('successful')
    expect(out.attempts[0]).toMatchObject({ status: 'completed', exit_code: 0 })
    expect(starts).toEqual([out.attempts[0]!.process_id!])
    expect((await new ProcessRepository(basePath).list())[0]).toMatchObject({
      status: 'exited',
      pid: 321,
      provider_handle: 'pid:321',
      exit_code: 0,
    })
  }, 30_000)

  test('blocked pre-run gate durably fails and never dispatches or spawns', async () => {
    let dispatches = 0; let spawns = 0
    const { service } = await make({
      evaluatePreGates: () => [{ id: 'g', subject_type: 'step', subject_ref: 'x', gate_type: 'policy_pass', status: 'BLOCK', reason_codes: ['blocked'], evidence_refs: [], decided_by: 'threados', decided_at: '2026-01-01T00:00:00.000Z' }],
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
      runStep: async () => { spawns++; throw new Error('must not spawn') },
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]?.status).toBe('failed')
    expect(dispatches).toBe(0); expect(spawns).toBe(0)
    expect(out.attempts[0]?.gate_decision_refs).toEqual(['g'])
    expect(out.attempts[0]?.error_code).toBe('PRE_RUN_GATE_BLOCKED')
  }, 30_000)

  test('completion gate failure yields needs_review', async () => {
    const { service } = await make({ evaluateCompletionGates: () => [{ id: 'g', subject_type: 'step', subject_ref: 'x', gate_type: 'completion_contract_pass', status: 'BLOCK', reason_codes: ['contract'], evidence_refs: [], decided_by: 'threados', decided_at: '2026-01-01T00:00:00.000Z' }] })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]?.status).toBe('needs_review')
    expect(out.run.status).toBe('awaiting_review')
  }, 30_000)

  test('failure after run creation and before spawn remains as recoverable canonical state', async () => {
    const { basePath, service } = await make({ compilePrompt: async () => { throw new Error('compile failed') } })
    const out = await service.runAndWait(cmd, context)
    expect(out.run.status).toBe('failed')
    expect((await new AttemptRepository(basePath).listForRun(out.run.id))[0]?.error_message).toContain('compile failed')
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect((await new CommandRepository(basePath).list())[0]?.status).toBe('failed')
  }, 30_000)

  test('invalid transitions throw before repository update', async () => {
    let updates = 0
    const repo = { update: async () => { updates++; throw new Error('unexpected') } } as unknown as RunRepository
    const current = { status: 'pending', revision: 0, id: 'r' } as never
    await expect(transitionRun(repo, current, 'successful')).rejects.toBeInstanceOf(RuntimeServiceError)
    expect(updates).toBe(0)
  })

  test('exact executable policy runs after dispatch and before any process or spawn', async () => {
    const order: string[] = []
    let spawns = 0
    const { basePath, service } = await make({
      dispatch: async (_model, options) => {
        order.push('dispatch')
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: ['secret'], cwd: basePath }
      },
      enforceExecutablePolicy: input => {
        order.push(`policy:${input.payload.command}:${input.payload.args.length}`)
        return { allowed: false, confirmation_required: false, reason: 'denied exact payload' }
      },
      runStep: async () => { spawns++; throw new Error('must not spawn') },
    })
    const out = await service.runAndWait(cmd, context)
    expect(order).toEqual(['dispatch', 'policy:sh:1'])
    expect(out.attempts[0]?.error_code).toBe('POLICY_DENIED')
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect(spawns).toBe(0)
  }, 30_000)

  test('projection failures never rewrite or replay canonical terminal truth', async () => {
    let spawns = 0
    const throwing = async () => { throw new Error('projection unavailable') }
    const { basePath, service } = await make({
      runStep: async c => {
        spawns++
        return { stepId: c.stepId, runId: c.runId, exitCode: 0, status: 'SUCCESS', duration: 1, stdout: '', stderr: '', startTime: new Date(), endTime: new Date() }
      },
      projections: { beginRun: throwing, beginAttempt: throwing, finalizeAttempt: throwing, finalizeRun: throwing },
    })
    const first = await service.runAndWait(cmd, context)
    const replay = await service.runAndWait(cmd, context)
    expect(first.run.status).toBe('successful')
    expect(first.attempts[0]?.status).toBe('completed')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('exited')
    expect(replay.run.id).toBe(first.run.id)
    expect(spawns).toBe(1)
  }, 30_000)

  test('missing exit evidence marks the process lost and never succeeds', async () => {
    const { basePath, service } = await make({
      runStep: async c => ({
        stepId: c.stepId, runId: c.runId, exitCode: null, status: 'ERROR', duration: 1,
        stdout: '', stderr: 'spawn failed', startTime: new Date(), endTime: new Date(),
      }),
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.run.status).toBe('failed')
    expect(out.attempts[0]?.error_code).toBe('PROCESS_LOST')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('lost')
  }, 30_000)

  test('sealed unrevealed surface authority blocks before dispatch while revealed surfaces run', async () => {
    let dispatches = 0
    const gateEvaluator: RuntimeServiceDependencies['evaluatePreGates'] = input => evaluateStepGates(
      input.step, input.sequence.steps, input.sequence.gates, {
        policyMode: input.policy.mode, sideEffectMode: input.policy.side_effect_mode,
        crossSurfaceReads: input.policy.cross_surface_reads, surfaceClass: input.surfaceClass,
        revealState: input.revealState, isDependency: true, inputManifestPresent: true,
        approvalPresent: input.approvalPresent,
      },
    )
    const blocked = await make({
      resolveGateSurface: async () => ({ surfaceClass: 'sealed', revealState: 'sealed' }),
      evaluatePreGates: gateEvaluator,
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
    })
    const denied = await blocked.service.runAndWait(cmd, context)
    expect(denied.attempts[0]?.gate_decision_refs.length).toBeGreaterThan(0)
    expect(denied.attempts[0]?.error_code).toBe('PRE_RUN_GATE_BLOCKED')
    expect(dispatches).toBe(0)
    expect(await new ProcessRepository(blocked.basePath).list()).toEqual([])

    const revealed = await make({
      resolveGateSurface: async () => ({ surfaceClass: 'sealed', revealState: 'revealed' }),
      evaluatePreGates: gateEvaluator,
      dispatch: async (_model, options) => {
        dispatches++
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: revealed.basePath }
      },
    })
    const allowed = await revealed.service.runAndWait(cmd, context)
    expect(allowed.run.status).toBe('successful')
    expect(dispatches).toBe(1)
  }, 30_000)

  test('input manifest reference stays null when preparation is unavailable or fails', async () => {
    for (const prepareArtifacts of [undefined, async () => { throw new Error('prepare failed') }]) {
      let spawns = 0
      const { service } = await make({
        prepareArtifacts,
        runStep: async () => { spawns++; throw new Error('must not spawn') },
      })
      const out = await service.runAndWait(cmd, context)
      expect(out.attempts[0]?.input_manifest_ref).toBeNull()
      expect(out.attempts[0]?.status).toBe('failed')
      expect(spawns).toBe(0)
    }
  }, 30_000)

  test('exact approval recording receives the run policy snapshot and is not duplicated on replay', async () => {
    const recorded: string[] = []
    const { service } = await make({
      loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' }),
      recordApproval: async input => { recorded.push(input.policySnapshotHash) },
    })
    const first = await service.runAndWait(cmd, context)
    await service.runAndWait(cmd, context)
    expect(recorded).toEqual([first.run.policy_snapshot_hash])
  }, 30_000)

  test('confirmed SAFE execution records only when payload and policy lack an exact approval', async () => {
    const existingPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' })
    const approval = (subjectDigest: string): Approval => ({
      id: 'approval-1', action_type: 'run', target_ref: 'step:x', requested_by: 't', status: 'approved',
      approved_by: 't', approved_at: '2026-01-01T00:00:00.000Z', notes: null, subject_digest: subjectDigest,
      payload_ref: subjectDigest,
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    })

    let exactApprovals: Approval[] = []
    const exactRecorded: string[] = []
    const exact = await make({
      loadPolicy: async () => existingPolicy,
      readApprovals: async () => exactApprovals,
      recordApproval: async input => { exactRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    const originalPayload = { command: 'sh', args: [], cwd: exact.basePath }
    exactApprovals = [approval(executableSubjectDigest(originalPayload, exact.basePath, existingPolicy))]
    await exact.service.runAndWait(cmd, context)
    expect(exactRecorded).toEqual([])

    let changedPayloadApprovals: Approval[] = []
    const changedPayloadRecorded: string[] = []
    const changedPayload = await make({
      loadPolicy: async () => existingPolicy,
      readApprovals: async () => changedPayloadApprovals,
      dispatch: async (_model, options) => ({ stepId: options.stepId, runId: options.runId, command: 'sh', args: ['changed'], cwd: changedPayload.basePath }),
      recordApproval: async input => { changedPayloadRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    changedPayloadApprovals = [approval(executableSubjectDigest({ command: 'sh', args: [], cwd: changedPayload.basePath }, changedPayload.basePath, existingPolicy))]
    await changedPayload.service.runAndWait(cmd, context)
    expect(changedPayloadRecorded).toEqual([
      executableSubjectDigest({ command: 'sh', args: ['changed'], cwd: changedPayload.basePath }, changedPayload.basePath, existingPolicy),
    ])

    const changedPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'approved_only' })
    let changedPolicyApprovals: Approval[] = []
    const changedPolicyRecorded: string[] = []
    const policyChanged = await make({
      loadPolicy: async () => changedPolicy,
      readApprovals: async () => changedPolicyApprovals,
      recordApproval: async input => { changedPolicyRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    changedPolicyApprovals = [approval(executableSubjectDigest({ command: 'sh', args: [], cwd: policyChanged.basePath }, policyChanged.basePath, existingPolicy))]
    await policyChanged.service.runAndWait(cmd, context)
    expect(changedPolicyRecorded).toEqual([
      executableSubjectDigest({ command: 'sh', args: [], cwd: policyChanged.basePath }, policyChanged.basePath, changedPolicy),
    ])
  }, 30_000)

  test('verified controller timeout produces a timed_out attempt and exited process evidence', async () => {
    const saved: RunResult[] = []
    const { basePath, service } = await make({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 322,
        result: Promise.resolve(rawResult({
          exitCode: null,
          signal: 'SIGKILL',
          status: 'TIMEOUT',
          stderr: 'timed out',
        })),
        cancel: async signal => ({
          success: true,
          signal: signal ?? 'SIGTERM',
          escalated: true,
        }),
      }),
      runStep: async () => { throw new ProcessTimeoutError('compatibility runner used', 5) },
      saveArtifacts: async (_basePath, result) => {
        saved.push(result)
        return 'artifact'
      },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]).toMatchObject({
      status: 'timed_out',
      artifact_manifest_ref: `.threados/runs/${out.run.id}/surfaces/thread-x/artifact.manifest.json`,
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ status: 'TIMEOUT', exitCode: null, stderr: 'timed out' })
    expect(out.run.status).toBe('failed')
    expect((await new ProcessRepository(basePath).list())[0]).toMatchObject({
      status: 'exited',
      pid: 322,
      exit_code: null,
      signal: 'SIGKILL',
    })
    expect((await new CommandRepository(basePath).list())[0]?.status).toBe('failed')
  }, 30_000)

  test('hosted shell guard fails before dispatch/process while an allowed local shell runs', async () => {
    let dispatches = 0
    const blocked = await make({
      allowModelExecution: () => ({ allowed: false, errorCode: 'SHELL_MODEL_DISABLED', reason: 'Shell execution is disabled in hosted mode' }),
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
    })
    const denied = await blocked.service.runAndWait(cmd, context)
    expect(denied.attempts[0]?.error_code).toBe('SHELL_MODEL_DISABLED')
    expect(dispatches).toBe(0)
    expect(await new ProcessRepository(blocked.basePath).list()).toEqual([])

    const local = await make({
      allowModelExecution: () => ({ allowed: true }),
      dispatch: async (_model, options) => {
        dispatches++
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: local.basePath }
      },
    })
    expect((await local.service.runAndWait(cmd, context)).run.status).toBe('successful')
    expect(dispatches).toBe(1)
  }, 30_000)
})
