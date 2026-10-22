import { randomUUID } from 'crypto'
import type { Step, Gate } from '@/lib/sequence/schema'
import type { GateDecision } from '@/lib/contracts/schemas'
import type { PolicyConfig } from '@/lib/policy/schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'
import {
  checkApprovalPresent,
  checkArtifactManifestPass,
  checkCompletionContractPass,
  checkDepsSatisfied,
  checkOutputSchemaPass,
  checkPolicyPass,
  checkRequiredInputsPresent,
  checkRevealAllowed,
  checkSnapshotPresent,
  checkSnapshotVerified,
  checkSurfaceAccessPass,
  checkWorkspaceManifestVerified,
  checkWorkspacePresent,
  checkWorkspaceReady,
} from './rules'

export interface GateContext {
  policyMode: PolicyConfig['mode']
  sideEffectMode: PolicyConfig['side_effect_mode']
  crossSurfaceReads: PolicyConfig['cross_surface_reads'] | 'allow'
  surfaceClass: ThreadSurface['surfaceClass']
  revealState: ThreadSurface['revealState']
  isDependency: boolean
  inputManifestPresent?: boolean
  approvalPresent?: boolean
}

export interface CompletionGateContext {
  artifactManifestPresent: boolean
  outputSchemaValid: boolean
  completionContractSatisfied: boolean
}

export interface WorkspaceGateContext {
  snapshotPresent: boolean
  snapshotVerified: boolean
  workspacePresent: boolean
  workspaceReady: boolean
  workspaceManifestVerified: boolean
  snapshotManifestRef: string | null
  workspaceManifestRef: string | null
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
  decisions.push(toDecision(step.id, 'required_inputs_present', checkRequiredInputsPresent(step, ctx.inputManifestPresent ?? false)))
  decisions.push(toDecision(step.id, 'policy_pass', checkPolicyPass(step.side_effect_class, ctx.policyMode, ctx.sideEffectMode)))
  decisions.push(toDecision(step.id, 'approval_present', checkApprovalPresent(step, ctx.sideEffectMode, ctx.approvalPresent ?? false)))
  decisions.push(toDecision(step.id, 'surface_access_pass', checkSurfaceAccessPass(ctx.surfaceClass, ctx.crossSurfaceReads, ctx.isDependency)))
  if (ctx.surfaceClass === 'sealed') {
    decisions.push(toDecision(step.id, 'reveal_allowed', checkRevealAllowed(ctx.surfaceClass, ctx.revealState)))
  }
  return decisions
}

export function evaluateStepCompletionGates(step: Step, ctx: CompletionGateContext): GateDecision[] {
  return [
    toDecision(step.id, 'artifact_manifest_pass', checkArtifactManifestPass(step, ctx.artifactManifestPresent)),
    toDecision(step.id, 'output_schema_pass', checkOutputSchemaPass(step, ctx.outputSchemaValid)),
    toDecision(step.id, 'completion_contract_pass', checkCompletionContractPass(step, ctx.completionContractSatisfied)),
  ]
}

export function evaluateWorkspaceGates(
  subjectRef: string,
  ctx: WorkspaceGateContext,
): GateDecision[] {
  return [
    toDecision(subjectRef, 'snapshot_present', checkSnapshotPresent(
      ctx.snapshotPresent,
      ctx.snapshotManifestRef,
    )),
    toDecision(subjectRef, 'snapshot_verified', checkSnapshotVerified(
      ctx.snapshotVerified,
      ctx.snapshotManifestRef,
    )),
    toDecision(subjectRef, 'workspace_present', checkWorkspacePresent(
      ctx.workspacePresent,
      ctx.workspaceManifestRef,
    )),
    toDecision(subjectRef, 'workspace_ready', checkWorkspaceReady(
      ctx.workspaceReady,
      ctx.workspaceManifestRef,
    )),
    toDecision(subjectRef, 'workspace_manifest_verified', checkWorkspaceManifestVerified(
      ctx.workspaceManifestVerified,
      ctx.workspaceManifestRef,
    )),
  ]
}

export function isStepRunnable(decisions: GateDecision[]): boolean {
  return decisions.every(d => d.status === 'PASS')
}

export function getBlockReasons(decisions: GateDecision[]): string[] {
  return decisions.filter(d => d.status !== 'PASS').flatMap(d => d.reason_codes)
}
