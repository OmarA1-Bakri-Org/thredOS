import type { Step, Gate } from '@/lib/sequence/schema'
import { GateReasonCode } from '@/lib/contracts/reason-codes'

export interface RuleResult {
  status: 'PASS' | 'BLOCK' | 'NEEDS_APPROVAL'
  reason_codes: string[]
  evidence_refs: string[]
}

const PASS: RuleResult = { status: 'PASS', reason_codes: [], evidence_refs: [] }

/**
 * Checks whether all dependencies of a step are satisfied.
 * A dep can refer to either another step or a gate.
 */
export function checkDepsSatisfied(
  step: Step,
  allSteps: Step[],
  allGates: Gate[],
): RuleResult {
  const reason_codes: string[] = []
  const evidence_refs: string[] = []

  for (const depId of step.depends_on) {
    const depStep = allSteps.find(s => s.id === depId)
    if (depStep) {
      if (depStep.status === 'FAILED') {
        reason_codes.push(GateReasonCode.DEP_FAILED)
        evidence_refs.push(`step:${depId}:status=${depStep.status}`)
      } else if (depStep.status !== 'DONE') {
        reason_codes.push(GateReasonCode.DEP_MISSING)
        evidence_refs.push(`step:${depId}:status=${depStep.status}`)
      }
      continue
    }

    const depGate = allGates.find(g => g.id === depId)
    if (depGate) {
      if (depGate.status === 'BLOCKED') {
        reason_codes.push(GateReasonCode.DEP_FAILED)
        evidence_refs.push(`gate:${depId}:status=${depGate.status}`)
      } else if (depGate.status !== 'APPROVED') {
        reason_codes.push(GateReasonCode.DEP_MISSING)
        evidence_refs.push(`gate:${depId}:status=${depGate.status}`)
      }
      continue
    }

    // Not found in either steps or gates
    reason_codes.push(GateReasonCode.DEP_MISSING)
    evidence_refs.push(`step:${depId}:status=NOT_FOUND`)
  }

  if (reason_codes.length === 0) {
    return PASS
  }

  return { status: 'BLOCK', reason_codes, evidence_refs }
}

/**
 * Checks whether the step's side-effect class is permitted under the current policy.
 */
export function checkPolicyPass(
  sideEffectClass: string | undefined,
  policyMode: 'SAFE' | 'POWER',
  sideEffectMode: 'free' | 'manual_only' | 'approved_only',
): RuleResult {
  if (!sideEffectClass || sideEffectClass === 'none') {
    return PASS
  }

  if (policyMode === 'POWER' && sideEffectMode === 'free') {
    return PASS
  }

  if (
    (sideEffectClass === 'write' || sideEffectClass === 'execute') &&
    (sideEffectMode === 'manual_only' || sideEffectMode === 'approved_only')
  ) {
    return {
      status: 'NEEDS_APPROVAL',
      reason_codes: [GateReasonCode.POLICY_BLOCKED],
      evidence_refs: [
        `policy:mode=${policyMode}`,
        `policy:side_effect_mode=${sideEffectMode}`,
        `step:side_effect_class=${sideEffectClass}`,
      ],
    }
  }

  return PASS
}

/**
 * Checks whether a surface's access rules permit the current operation.
 */
export function checkSurfaceAccessPass(
  surfaceClass: string | undefined,
  crossSurfaceReads: 'allow' | 'deny',
  isDependency: boolean,
): RuleResult {
  if (surfaceClass === 'sealed' && !isDependency) {
    return {
      status: 'BLOCK',
      reason_codes: [GateReasonCode.ACCESS_DENIED],
      evidence_refs: [`surface:class=${surfaceClass}`, `surface:is_dependency=${isDependency}`],
    }
  }

  if (crossSurfaceReads === 'deny' && !isDependency) {
    return {
      status: 'BLOCK',
      reason_codes: [GateReasonCode.ACCESS_DENIED],
      evidence_refs: [
        `surface:cross_surface_reads=${crossSurfaceReads}`,
        `surface:is_dependency=${isDependency}`,
      ],
    }
  }

  return PASS
}

/**
 * Checks whether a sealed surface has been revealed before allowing access.
 */
export function checkRevealAllowed(
  surfaceClass: string | undefined,
  revealState: 'sealed' | 'revealed' | undefined,
): RuleResult {
  if (surfaceClass !== 'sealed') {
    return PASS
  }

  if (revealState === 'revealed') {
    return PASS
  }

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.REVEAL_LOCKED],
    evidence_refs: [
      `surface:class=${surfaceClass}`,
      `surface:reveal_state=${revealState ?? 'sealed'}`,
    ],
  }
}
