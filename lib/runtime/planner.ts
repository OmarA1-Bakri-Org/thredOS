import { createHash } from 'crypto'
import { mkdir, readFile, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { z } from 'zod'
import type { Sequence } from '../sequence/schema'
import type { RuntimeContext } from './context'
import { readRuntimeContext } from './context'
import {
  appendPlanRevision,
  readRuntimePlan,
  type RuntimePlan,
  initRuntimePlan,
  writeRuntimePlan,
} from './plan'
import { writeFileAtomic } from '../fs/atomic'
import { appendApproval, hasApprovedApproval } from '../approvals/repository'

export const PlannerDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('continue'),
    reason: z.string().min(1),
    evidence: z.array(z.string()).default([]),
  }),
  z.object({
    decision: z.literal('revise_discovery_strategy'),
    reason: z.string().min(1),
    strategy_id: z.string().min(1),
    evidence: z.array(z.string()).default([]),
    approval_required: z.boolean().default(false),
    trigger_kind: z.enum(['empty_artifact', 'sparse_results']),
    trigger_payload_signature: z.string().min(1),
  }),
  z.object({
    decision: z.literal('escalate'),
    reason: z.string().min(1),
    approval_required: z.literal(true),
  }),
  z.object({
    decision: z.literal('stop'),
    reason: z.string().min(1),
    outcome: z.enum(['insufficient_evidence', 'budget_exhausted', 'goal_satisfied']),
  }),
])
export type PlannerDecision = z.infer<typeof PlannerDecisionSchema>

export interface PlannerInput {
  sequence: Sequence
  runtimeContext: RuntimeContext
  runtimePlan: RuntimePlan | null
}

const DISCOVERY_STEP_ID = 'apollo-discovery'
const BROAD_STRATEGY_ID = 'broaden-discovery'

function planningEnabled(sequence: Sequence): boolean {
  return Boolean(sequence.strategy_options?.length && sequence.replan_policy?.enabled)
}

function getStrategyThreshold(sequence: Sequence): number {
  return sequence.replan_policy?.triggers.includes('sparse_results') ? 5 : 0
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    if (errno?.code === 'ENOENT') return null
    throw error
  }
}

function deriveArtifactDir(runtimeContext: RuntimeContext): string | null {
  const artifactDir = runtimeContext.apollo_artifact_dir
  return typeof artifactDir === 'string' && artifactDir.trim().length > 0 ? artifactDir : null
}

export function getPlannerBindingsPath(basePath: string): string {
  return join(basePath, '.threados', 'state', 'planner-bindings.json')
}

export async function clearPlannerBindings(basePath: string): Promise<void> {
  await rm(getPlannerBindingsPath(basePath), { force: true }).catch(() => {})
}

export async function writePlannerBindings(basePath: string, plan: RuntimePlan): Promise<void> {
  const path = getPlannerBindingsPath(basePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, `${JSON.stringify({ selected_strategy: plan.selected_strategy }, null, 2)}\n`)
}

export function deriveRevisionId(input: {
  sequenceId: string
  fromStrategy: string | null
  toStrategy: string
  triggerKind: 'empty_artifact' | 'sparse_results'
  triggerPayloadSignature: string
}): string {
  return createHash('sha1')
    .update([
      input.sequenceId,
      input.fromStrategy ?? 'none',
      input.toStrategy,
      input.triggerKind,
      input.triggerPayloadSignature,
    ].join(':'))
    .digest('hex')
    .slice(0, 12)
}

export function derivePlanRevisionTargetRef(input: {
  sequenceId: string
  fromStrategy: string | null
  toStrategy: string
  revisionId: string
}): string {
  return `plan_revision:${input.sequenceId}:${input.fromStrategy ?? 'none'}:${input.toStrategy}:${input.revisionId}`
}

export async function ensureRuntimePlan(basePath: string, sequence: Sequence): Promise<RuntimePlan | null> {
  if (!planningEnabled(sequence)) {
    await clearPlannerBindings(basePath)
    return null
  }

  const existing = await readRuntimePlan(basePath)
  if (existing) {
    await writePlannerBindings(basePath, existing)
    return existing
  }

  const firstStrategy = sequence.strategy_options?.[0]?.id ?? null
  const plan = await initRuntimePlan(basePath, {
    mission_id: sequence.id ?? sequence.name,
    goal: sequence.goal ?? sequence.name,
    candidate_strategies: (sequence.strategy_options ?? []).map(strategy => strategy.id),
    selected_strategy: firstStrategy,
  })
  await writePlannerBindings(basePath, plan)
  return plan
}

export async function planNextDecision(input: PlannerInput): Promise<PlannerDecision> {
  const { sequence, runtimePlan } = input
  if (!planningEnabled(sequence)) {
    return { decision: 'continue', reason: 'planning disabled', evidence: [] }
  }

  if (!runtimePlan || !runtimePlan.selected_strategy) {
    return { decision: 'continue', reason: 'runtime plan not initialized', evidence: [] }
  }

  const artifactDir = deriveArtifactDir(input.runtimeContext)
  if (!artifactDir) {
    return { decision: 'continue', reason: 'apollo artifact dir unavailable', evidence: [] }
  }

  const discoveryStep = sequence.steps.find(step => step.id === DISCOVERY_STEP_ID)
  if (!discoveryStep || discoveryStep.status === 'READY' || discoveryStep.status === 'RUNNING') {
    return { decision: 'continue', reason: 'discovery not yet complete', evidence: [] }
  }

  const artifact = await readJsonObject(join(artifactDir, 'discovered-prospects.json'))
  if (!artifact) {
    return { decision: 'continue', reason: 'discovery artifact missing', evidence: [] }
  }

  const prospects = artifact.prospects
  if (!Array.isArray(prospects)) {
    return { decision: 'escalate', reason: 'discovery artifact malformed: prospects must be an array', approval_required: true }
  }

  if (runtimePlan.selected_strategy === BROAD_STRATEGY_ID) {
    if (prospects.length < getStrategyThreshold(sequence)) {
      return { decision: 'stop', reason: 'broadened discovery remained sparse after replay', outcome: 'insufficient_evidence' }
    }
    return { decision: 'continue', reason: 'broadened strategy already selected', evidence: [`prospects=${prospects.length}`] }
  }

  const broadenStrategy = sequence.strategy_options?.find(strategy => strategy.id === BROAD_STRATEGY_ID)
  if (!broadenStrategy) {
    return { decision: 'continue', reason: 'no broader strategy available', evidence: [] }
  }

  if (prospects.length === 0 && sequence.replan_policy?.triggers.includes('empty_artifact')) {
    return {
      decision: 'revise_discovery_strategy',
      reason: 'discovery artifact was empty',
      strategy_id: BROAD_STRATEGY_ID,
      evidence: ['prospects=0'],
      approval_required: broadenStrategy.requires_approval,
      trigger_kind: 'empty_artifact',
      trigger_payload_signature: 'prospects=0',
    }
  }

  if (prospects.length < getStrategyThreshold(sequence) && sequence.replan_policy?.triggers.includes('sparse_results')) {
    return {
      decision: 'revise_discovery_strategy',
      reason: 'discovery artifact was sparse',
      strategy_id: BROAD_STRATEGY_ID,
      evidence: [`prospects=${prospects.length}`],
      approval_required: broadenStrategy.requires_approval,
      trigger_kind: 'sparse_results',
      trigger_payload_signature: `prospects=${prospects.length}`,
    }
  }

  return { decision: 'continue', reason: 'current strategy remains sufficient', evidence: [`prospects=${prospects.length}`] }
}

function collectDownstreamStepIds(sequence: Sequence, startStepId: string): string[] {
  const discovered: string[] = []
  const visited = new Set<string>()
  const queue = [startStepId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const step of sequence.steps) {
      if (!step.depends_on.includes(current) || visited.has(step.id)) continue
      visited.add(step.id)
      discovered.push(step.id)
      queue.push(step.id)
    }
  }
  return discovered
}

export async function applyPlannerDecision(basePath: string, sequence: Sequence, options: {
  runId: string
  actor: string
  requestedBy: string
}): Promise<{ sequence: Sequence; blockedResult: { status: 'BLOCKED'; error: string } | null; decision: PlannerDecision | null }> {
  const plan = await ensureRuntimePlan(basePath, sequence)
  if (!plan) {
    return { sequence, blockedResult: null, decision: null }
  }

  const runtimeContext = await readRuntimeContext(basePath)
  const decision = await planNextDecision({ sequence, runtimeContext, runtimePlan: plan })
  if (decision.decision !== 'revise_discovery_strategy') {
    return { sequence, blockedResult: null, decision }
  }

  const revisionId = deriveRevisionId({
    sequenceId: sequence.id ?? sequence.name,
    fromStrategy: plan.selected_strategy,
    toStrategy: decision.strategy_id,
    triggerKind: decision.trigger_kind,
    triggerPayloadSignature: decision.trigger_payload_signature,
  })
  const targetRef = derivePlanRevisionTargetRef({
    sequenceId: sequence.id ?? sequence.name,
    fromStrategy: plan.selected_strategy,
    toStrategy: decision.strategy_id,
    revisionId,
  })
  const existingPlan = await readRuntimePlan(basePath) ?? plan
  const hasRevision = existingPlan.revisions.some(revision => revision.revision_id === revisionId)
  if (!hasRevision) {
    await appendPlanRevision(basePath, {
      revision_id: revisionId,
      ts: new Date().toISOString(),
      from_strategy: plan.selected_strategy,
      to_strategy: decision.strategy_id,
      reason: decision.reason,
      approval_required: decision.approval_required,
      approved: false,
    })
  }

  if (decision.approval_required && !await hasApprovedApproval(basePath, targetRef, 'plan_revision')) {
    await appendApproval(basePath, options.runId, {
      id: revisionId,
      action_type: 'plan_revision',
      target_ref: targetRef,
      requested_by: options.requestedBy,
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: `Revise strategy from ${plan.selected_strategy ?? 'none'} to ${decision.strategy_id}: ${decision.reason}`,
    })
    const blockedPlan = await readRuntimePlan(basePath) ?? existingPlan
    await writeRuntimePlan(basePath, { ...blockedPlan, status: 'blocked', updated_at: new Date().toISOString() })
    return {
      sequence,
      blockedResult: { status: 'BLOCKED', error: `Awaiting approval for plan revision '${targetRef}'` },
      decision,
    }
  }

  const latestPlan = await readRuntimePlan(basePath) ?? existingPlan
  const nextPlan: RuntimePlan = {
    ...latestPlan,
    status: 'active',
    selected_strategy: decision.strategy_id,
    revisions: latestPlan.revisions.map(revision =>
      revision.revision_id === revisionId ? { ...revision, approved: true } : revision
    ),
    updated_at: new Date().toISOString(),
  }
  await writeRuntimePlan(basePath, nextPlan)
  await writePlannerBindings(basePath, nextPlan)

  const discoveryStep = sequence.steps.find(step => step.id === DISCOVERY_STEP_ID)
  if (discoveryStep) {
    discoveryStep.status = 'READY'
    for (const stepId of collectDownstreamStepIds(sequence, DISCOVERY_STEP_ID)) {
      const step = sequence.steps.find(candidate => candidate.id === stepId)
      if (!step || step.status === 'DONE') continue
      step.status = 'READY'
    }
  }

  return { sequence, blockedResult: null, decision }
}
