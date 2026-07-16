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
  const deps: RuntimeServiceDependencies = {
    now: () => '2026-01-01T00:00:00.000Z', newId: p => `${p}-${++id}`,
    loadSequence: async () => seq(), loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
    validateSequence: () => undefined, validatePrompt: async () => true, compilePrompt: async () => 'prompt',
    dispatch: async (_m, o) => ({ stepId: o.stepId, runId: o.runId, command: 'sh', args: [], cwd: basePath }),
    runStep: async c => ({ stepId: c.stepId, runId: c.runId, exitCode: 0, status: 'SUCCESS', duration: 1, stdout: '', stderr: '', startTime: new Date(), endTime: new Date() }),
    saveArtifacts: async () => 'artifact', readRuntimeEvents: async () => [], readApprovals: async () => [],
    evaluatePreGates: () => [], evaluateCompletionGates: () => [], persistGateDecisions: async () => undefined,
    enforceBatchPolicy: () => ({ allowed: true, confirmation_required: false }), enforceExecutablePolicy: () => ({ allowed: true, confirmation_required: false }),
    recordApproval: async () => undefined, appendTrace: async () => undefined,
    projections: { beginRun: async () => undefined, beginAttempt: async () => undefined, finalizeAttempt: async () => undefined, finalizeRun: async () => undefined },
    ...overrides,
  }
  return { basePath, service: new ThreadOSRuntimeService({ basePath, scheduler: new SequentialScheduler(), repositories: {
    runs: new RunRepository(basePath), attempts: new AttemptRepository(basePath), processes: new ProcessRepository(basePath), commands: new CommandRepository(basePath),
  }, dependencies: deps }) }
}

const context = { actor: 't', interface: 'system' as const, idempotencyKey: 'k', policyConfirmed: true }
const cmd = { sequence_id: 's', target: { kind: 'step' as const, step_id: 'x' }, strategy: 'sequential' as const, max_concurrency: 1 }

describe('AttemptExecutor and lifecycle', () => {
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
    expect(out.run.status).toBe('failed')
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
})
