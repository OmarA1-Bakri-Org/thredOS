import type { Step, Gate } from '@/lib/sequence/schema'
import type { PolicyConfig } from '@/lib/policy/schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'
import { GateReasonCode } from '@/lib/contracts/reason-codes'

export interface RuleResult {
  status: 'PASS' | 'BLOCK' | 'NEEDS_APPROVAL'
  reason_codes: string[]
  evidence_refs: string[]
}

const PASS: RuleResult = { status: 'PASS', reason_codes: [], evidence_refs: [] }

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
      } else if (depStep.status !== 'DONE' && depStep.status !== 'SKIPPED') {
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

    reason_codes.push(GateReasonCode.DEP_MISSING)
    evidence_refs.push(`step:${depId}:status=NOT_FOUND`)
  }

  return reason_codes.length === 0 ? PASS : { status: 'BLOCK', reason_codes, evidence_refs }
}

export function checkRequiredInputsPresent(
  step: Step,
  inputManifestPresent: boolean,
): RuleResult {
  if (!step.input_contract_ref) return PASS
  if (inputManifestPresent) {
    return {
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [`input_contract:${step.input_contract_ref}`],
    }
  }

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.INPUT_MISSING],
    evidence_refs: [`input_contract:${step.input_contract_ref}`],
  }
}

export function checkPolicyPass(
  sideEffectClass: Step['side_effect_class'],
  policyMode: PolicyConfig['mode'],
  sideEffectMode: PolicyConfig['side_effect_mode'],
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

export function checkApprovalPresent(
  step: Step,
  sideEffectMode: PolicyConfig['side_effect_mode'],
  approvalPresent: boolean,
): RuleResult {
  if (!step.side_effect_class || step.side_effect_class === 'none') {
    return PASS
  }

  if (sideEffectMode === 'free') {
    return PASS
  }

  if (step.side_effect_class !== 'write' && step.side_effect_class !== 'execute') {
    return PASS
  }

  if (approvalPresent) {
    return {
      status: 'PASS',
      reason_codes: [],
      evidence_refs: ['approval:present'],
    }
  }

  return {
    status: 'NEEDS_APPROVAL',
    reason_codes: [GateReasonCode.APPROVAL_MISSING],
    evidence_refs: ['approval:missing'],
  }
}

export function checkSurfaceAccessPass(
  surfaceClass: ThreadSurface['surfaceClass'],
  crossSurfaceReads: PolicyConfig['cross_surface_reads'] | 'allow',
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

export function checkRevealAllowed(
  surfaceClass: ThreadSurface['surfaceClass'],
  revealState: ThreadSurface['revealState'],
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

export function checkArtifactManifestPass(
  step: Step,
  artifactManifestPresent: boolean,
): RuleResult {
  const manifestRequired = Boolean(step.output_contract_ref || step.completion_contract || (step.side_effect_class && step.side_effect_class !== 'none'))
  if (!manifestRequired) return PASS
  if (artifactManifestPresent) {
    return {
      status: 'PASS',
      reason_codes: [],
      evidence_refs: ['artifact_manifest:present'],
    }
  }

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.ARTIFACT_MISSING],
    evidence_refs: ['artifact_manifest:missing'],
  }
}

export function checkOutputSchemaPass(
  step: Step,
  outputSchemaValid: boolean,
): RuleResult {
  if (!step.output_contract_ref) return PASS
  if (outputSchemaValid) {
    return {
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [`output_contract:${step.output_contract_ref}`],
    }
  }

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.SCHEMA_INVALID],
    evidence_refs: [`output_contract:${step.output_contract_ref}`],
  }
}

export function checkCompletionContractPass(
  step: Step,
  completionContractSatisfied: boolean,
): RuleResult {
  if (!step.completion_contract) return PASS
  if (completionContractSatisfied) {
    return {
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [`completion_contract:${step.completion_contract}`],
    }
  }

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.CONTRACT_INCOMPLETE],
    evidence_refs: [`completion_contract:${step.completion_contract}`],
  }
}
