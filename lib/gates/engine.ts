import { randomUUID } from 'crypto'
import type { Step, Gate } from '@/lib/sequence/schema'
import type { GateDecision } from '@/lib/contracts/schemas'
import type { PolicyConfig } from '@/lib/policy/schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'
import { checkDepsSatisfied, checkPolicyPass, checkSurfaceAccessPass, checkRevealAllowed } from './rules'

export interface GateContext {
  policyMode: PolicyConfig['mode']
  sideEffectMode: PolicyConfig['side_effect_mode']
  crossSurfaceReads: PolicyConfig['cross_surface_reads'] | 'allow'
  surfaceClass: ThreadSurface['surfaceClass']
  revealState: ThreadSurface['revealState']
  isDependency: boolean
}

function toDecision(
  subjectRef: string,
  gateType: GateDecision['gate_type'],
  result: { status: string; reason_codes: string[]; evidence_refs: string[] },
): GateDecision {
  return {
    id: `gd-${randomUUID()}`,
    subject_type: 'step',
    subject_ref: subjectRef,
    gate_type: gateType,
    status: result.status as GateDecision['status'],
    reason_codes: result.reason_codes,
    evidence_refs: result.evidence_refs,
    decided_by: 'threados',
    decided_at: new Date().toISOString(),
  }
}

export function evaluateStepGates(step: Step, allSteps: Step[], allGates: Gate[], ctx: GateContext): GateDecision[] {
  const decisions: GateDecision[] = []
  decisions.push(toDecision(step.id, 'deps_satisfied', checkDepsSatisfied(step, allSteps, allGates)))
  decisions.push(toDecision(step.id, 'policy_pass', checkPolicyPass(step.side_effect_class, ctx.policyMode, ctx.sideEffectMode)))
  decisions.push(toDecision(step.id, 'surface_access_pass', checkSurfaceAccessPass(ctx.surfaceClass, ctx.crossSurfaceReads, ctx.isDependency)))
  if (ctx.surfaceClass === 'sealed') {
    decisions.push(toDecision(step.id, 'reveal_allowed', checkRevealAllowed(ctx.surfaceClass, ctx.revealState)))
  }
  return decisions
}

export function isStepRunnable(decisions: GateDecision[]): boolean {
  return decisions.every(d => d.status === 'PASS')
}

export function getBlockReasons(decisions: GateDecision[]): string[] {
  return decisions.filter(d => d.status !== 'PASS').flatMap(d => d.reason_codes)
}
