import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Sequence } from '../sequence/schema'
import { ensureRuntimePlan, planNextDecision, deriveRevisionId, derivePlanRevisionTargetRef, getPlannerBindingsPath, clearPlannerBindings, writePlannerBindings, applyPlannerDecision } from './planner'
import { readRuntimePlan } from './plan'
import { writeRuntimeContext } from './context'
import { writeSequence, readSequence } from '../sequence/parser'
import { appendApproval } from '../approvals/repository'

let basePath = ''

function makeSequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: 'seq-planner',
    version: '1.0',
    name: 'planner-seq',
    steps: [
      {
        id: 'apollo-discovery',
        name: 'Apollo Discovery',
        type: 'base',
        model: 'shell',
        prompt_file: '.threados/prompts/apollo-discovery.md',
        depends_on: [],
        status: 'DONE',
        phase: 'phase-1',
        surface_ref: 'thread-apollo-discovery',
        agent_ref: null,
        input_contract_ref: null,
        output_contract_ref: null,
        gate_set_ref: null,
        completion_contract: null,
        side_effect_class: 'execute',
        actions: [],
        prompt_ref: { id: 'apollo-discovery', version: 1, path: '.threados/prompts/apollo-discovery.md' },
      },
      {
        id: 'merge-dedup-comply',
        name: 'Merge',
        type: 'base',
        model: 'shell',
        prompt_file: '.threados/prompts/merge-dedup-comply.md',
        depends_on: ['apollo-discovery'],
        status: 'FAILED',
        phase: 'phase-2',
        surface_ref: 'thread-merge-dedup-comply',
        agent_ref: null,
        input_contract_ref: null,
        output_contract_ref: null,
        gate_set_ref: null,
        completion_contract: null,
        side_effect_class: 'execute',
        actions: [],
        prompt_ref: { id: 'merge-dedup-comply', version: 1, path: '.threados/prompts/merge-dedup-comply.md' },
      },
    ],
    deps: [{ step_id: 'merge-dedup-comply', dep_id: 'apollo-discovery' }],
    gates: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pack_id: 'apollo-segment-builder',
    pack_version: '1.0.0',
    default_policy_ref: 'SAFE',
    goal: 'Build a reviewable sponsor-prospect segment',
    success_criteria: ['qualified_segment.total_qualified > 0'],
    strategy_options: [
      { id: 'standard-discovery', label: 'Standard discovery', applies_to: ['apollo-discovery'], selects_steps: ['apollo-discovery'], suppresses_steps: [], requires_approval: false },
      { id: 'broaden-discovery', label: 'Broaden discovery', applies_to: ['apollo-discovery'], selects_steps: ['apollo-discovery'], suppresses_steps: [], requires_approval: true },
    ],
    replan_policy: { enabled: true, triggers: ['empty_artifact', 'sparse_results'] },
    ...overrides,
  }
}

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-planner-'))
  await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
  await writeRuntimeContext(basePath, { apollo_artifact_dir: join(basePath, 'apollo-artifacts') })
  await mkdir(join(basePath, 'apollo-artifacts'), { recursive: true })
})

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true })
})

describe('runtime planner', () => {
  test('returns continue when planning is disabled', async () => {
    const sequence = makeSequence({ strategy_options: [], replan_policy: undefined })
    const decision = await planNextDecision({ sequence, runtimeContext: {}, runtimePlan: null })
    expect(decision).toEqual({ decision: 'continue', reason: 'planning disabled', evidence: [] })
  })

  test('initializes runtime plan and planner bindings for planning-enabled sequences', async () => {
    const sequence = makeSequence()
    const plan = await ensureRuntimePlan(basePath, sequence)
    expect(plan?.selected_strategy).toBe('standard-discovery')
    expect(await readRuntimePlan(basePath)).not.toBeNull()
    expect(await Bun.file(getPlannerBindingsPath(basePath)).json()).toEqual({ selected_strategy: 'standard-discovery' })
  })

  test('revises discovery strategy when prospects are sparse', async () => {
    const sequence = makeSequence()
    const plan = await ensureRuntimePlan(basePath, sequence)
    await writeFile(join(basePath, 'apollo-artifacts', 'discovered-prospects.json'), JSON.stringify({ prospects: [{ id: '1' }, { id: '2' }] }), 'utf-8')
    const decision = await planNextDecision({ sequence, runtimeContext: { apollo_artifact_dir: join(basePath, 'apollo-artifacts') }, runtimePlan: plan })
    expect(decision).toMatchObject({
      decision: 'revise_discovery_strategy',
      strategy_id: 'broaden-discovery',
      approval_required: true,
      trigger_kind: 'sparse_results',
      trigger_payload_signature: 'prospects=2',
    })
  })

  test('escalates when discovery artifact is malformed', async () => {
    const sequence = makeSequence()
    const plan = await ensureRuntimePlan(basePath, sequence)
    await writeFile(join(basePath, 'apollo-artifacts', 'discovered-prospects.json'), JSON.stringify({ nope: true }), 'utf-8')
    const decision = await planNextDecision({ sequence, runtimeContext: { apollo_artifact_dir: join(basePath, 'apollo-artifacts') }, runtimePlan: plan })
    expect(decision).toEqual({ decision: 'escalate', reason: 'discovery artifact malformed: prospects must be an array', approval_required: true })
  })

  test('uses deterministic revision ids and target refs', () => {
    const revisionId = deriveRevisionId({
      sequenceId: 'seq-1',
      fromStrategy: 'standard-discovery',
      toStrategy: 'broaden-discovery',
      triggerKind: 'sparse_results',
      triggerPayloadSignature: 'prospects=2',
    })
    expect(revisionId).toBe(deriveRevisionId({
      sequenceId: 'seq-1',
      fromStrategy: 'standard-discovery',
      toStrategy: 'broaden-discovery',
      triggerKind: 'sparse_results',
      triggerPayloadSignature: 'prospects=2',
    }))
    expect(derivePlanRevisionTargetRef({ sequenceId: 'seq-1', fromStrategy: 'standard-discovery', toStrategy: 'broaden-discovery', revisionId })).toBe(`plan_revision:seq-1:standard-discovery:broaden-discovery:${revisionId}`)
  })

  test('applyPlannerDecision blocks pending approval and approves replay once approval exists', async () => {
    const sequence = makeSequence()
    await writeSequence(basePath, sequence)
    await ensureRuntimePlan(basePath, sequence)
    await writeFile(join(basePath, 'apollo-artifacts', 'discovered-prospects.json'), JSON.stringify({ prospects: [] }), 'utf-8')

    const blocked = await applyPlannerDecision(basePath, sequence, {
      runId: 'run-1',
      actor: 'api:run',
      requestedBy: 'local@thredos',
    })
    expect(blocked.blockedResult?.status).toBe('BLOCKED')

    const planAfterBlock = await readRuntimePlan(basePath)
    const revision = planAfterBlock?.revisions[0]
    expect(revision?.approved).toBe(false)

    const targetRef = derivePlanRevisionTargetRef({
      sequenceId: 'seq-planner',
      fromStrategy: 'standard-discovery',
      toStrategy: 'broaden-discovery',
      revisionId: revision!.revision_id,
    })
    await appendApproval(basePath, 'run-approval', {
      id: revision!.revision_id,
      action_type: 'plan_revision',
      target_ref: targetRef,
      requested_by: 'local@thredos',
      status: 'approved',
      approved_by: 'local@thredos',
      approved_at: '2026-04-22T00:00:00.000Z',
      notes: null,
    })

    const latestSequence = await readSequence(basePath)
    const applied = await applyPlannerDecision(basePath, latestSequence, {
      runId: 'run-2',
      actor: 'api:run',
      requestedBy: 'local@thredos',
    })
    expect(applied.blockedResult).toBeNull()
    const updatedPlan = await readRuntimePlan(basePath)
    expect(updatedPlan?.selected_strategy).toBe('broaden-discovery')
    expect(updatedPlan?.revisions[0].approved).toBe(true)
    expect(applied.sequence.steps.find(step => step.id === 'apollo-discovery')?.status).toBe('READY')
    expect(applied.sequence.steps.find(step => step.id === 'merge-dedup-comply')?.status).toBe('READY')
  })

  test('clears planner bindings when planning is disabled', async () => {
    const sequence = makeSequence()
    const plan = await ensureRuntimePlan(basePath, sequence)
    await writePlannerBindings(basePath, plan!)
    expect(await Bun.file(getPlannerBindingsPath(basePath)).exists()).toBe(true)
    await clearPlannerBindings(basePath)
    expect(await Bun.file(getPlannerBindingsPath(basePath)).exists()).toBe(false)
  })
})
