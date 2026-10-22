import { realpath } from 'fs/promises'
import { z } from 'zod'
import { ApprovalSchema, Sha256DigestSchema, type Approval, type GateDecision } from '../contracts/schemas'
import { foldApprovals } from '../approvals/repository'
import { isApprovalExpired } from '../approvals/binding'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { appendGateDecision, readGateDecisionsRecoveringTail } from '../gates/repository'
import { readLocalWorkspace } from '../local-first/workspace'
import { PolicyEngine } from '../policy/engine'
import { RunRepository } from '../runtime/run-repository'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { loadWorkspaceConfig } from '../workspaces/config'
import { hashCanonicalJson } from '../workspaces/hash'
import { createSnapshotManifest } from '../workspaces/manifest'
import { resolveRuntimeDataRoot } from '../workspaces/paths'
import { inspectCanonicalManifest } from '../workspaces/snapshot'
import { MergeRecordRepository } from './repository'
import { createMergePlanSubject, hashMergePlanSubject,
  MergeValidationReceiptSchema, verifyPersistedMergeEvidence,
  type MergeValidationReceipt } from './subject'

export class MergeApprovalError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'MergeApprovalError'
  }
}

export interface ExactMergeApprovalSubject {
  planId: string
  runId: string
  targetRef: string
  planDigest: string
  canonicalPreconditionHash: string
  policySnapshotHash: string
}

async function loadSubject(basePath: string, planId: string): Promise<ExactMergeApprovalSubject> {
  assertSafePathSegment(planId, 'merge plan id')
  const canonicalRoot = await realpath(basePath)
  const local = await readLocalWorkspace(canonicalRoot)
  const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
  const records = new MergeRecordRepository(runtimeDataRoot)
  const [plan, binding] = await Promise.all([records.getPlan(planId), records.getPlanBinding(planId)])
  if (!plan || !binding || plan.status !== 'validated' || !plan.validated_at
    || !plan.preview_workspace_id || plan.conflicts.length !== 0) {
    throw new MergeApprovalError('MERGE_PLAN_NOT_VALIDATED')
  }
  const preview = await records.getPreview(plan.preview_workspace_id)
  if (!preview || preview.status !== 'ready' || preview.merge_plan_id !== plan.id
    || preview.workflow_run_id !== plan.workflow_run_id
    || preview.canonical_precondition_hash !== plan.canonical_precondition_hash
    || preview.candidate_manifest_hash !== binding.candidate_manifest_hash
    || !preview.manifest_hash) {
    throw new MergeApprovalError('MERGE_PREVIEW_NOT_CURRENT')
  }
  const run = await new RunRepository(canonicalRoot).get(plan.workflow_run_id)
  if (!run || !Sha256DigestSchema.safeParse(run.policy_snapshot_hash).success) {
    throw new MergeApprovalError('MERGE_RUN_POLICY_UNAVAILABLE')
  }
  let receipt: MergeValidationReceipt
  try {
    const receiptPath = await resolveExistingPathWithinRoot(runtimeDataRoot,
      'merge-validations', plan.id, 'validation-receipt.json')
    receipt = MergeValidationReceiptSchema.parse(JSON.parse(await readTextFileNoFollow(receiptPath)))
  } catch {
    throw new MergeApprovalError('MERGE_VALIDATION_EVIDENCE_MISSING')
  }
  if (receipt.merge_plan_id !== plan.id || receipt.plan_revision !== plan.revision - 1) {
    throw new MergeApprovalError('MERGE_VALIDATION_EVIDENCE_STALE')
  }
  const config = await loadWorkspaceConfig(canonicalRoot)
  const currentPolicyHash = hashCanonicalJson((await PolicyEngine.load(canonicalRoot)).getConfig())
  if (receipt.validation_command_count !== config.validate.length
    || receipt.validation_commands_hash !== hashCanonicalJson(config.validate)
    || receipt.policy_snapshot_hash !== currentPolicyHash
    || receipt.policy_snapshot_hash !== run.policy_snapshot_hash) {
    throw new MergeApprovalError('MERGE_VALIDATION_CONFIG_CHANGED')
  }
  const current = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
    localWorkspaceId: local.id, workflowRunId: plan.workflow_run_id, config })
  const currentHash = createSnapshotManifest('canonical-current', current.entries).root_manifest_hash
  if (currentHash !== plan.canonical_precondition_hash) {
    throw new MergeApprovalError('MERGE_STALE_CANONICAL')
  }
  let planDigest: string
  try {
    const subject = createMergePlanSubject({
      plan, binding, preview, validation_receipt: receipt,
      canonical_precondition_hash: currentHash,
    })
    await verifyPersistedMergeEvidence({ canonicalRoot, runtimeDataRoot,
      localWorkspaceId: local.id, subject, validationCommands: config.validate,
      currentCanonicalManifestHash: currentHash,
      currentValidationCommandsHash: hashCanonicalJson(config.validate),
      currentPolicySnapshotHash: currentPolicyHash })
    planDigest = hashMergePlanSubject(subject)
  } catch (error) {
    if (error instanceof Error && /^MERGE_[A-Z_]+$/.test(error.message)) {
      throw new MergeApprovalError(error.message)
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new MergeApprovalError('MERGE_PREVIEW_EVIDENCE_MISSING')
    }
    throw new MergeApprovalError('MERGE_APPROVAL_SUBJECT_INVALID')
  }
  return {
    planId: plan.id,
    runId: plan.workflow_run_id,
    targetRef: `merge:${plan.id}`,
    planDigest,
    canonicalPreconditionHash: plan.canonical_precondition_hash,
    policySnapshotHash: run.policy_snapshot_hash,
  }
}

/** This digest is for an operator request; consumption recomputes it from persisted records. */
export async function inspectExactMergeApprovalSubject(basePath: string,
  planId: string): Promise<ExactMergeApprovalSubject> {
  return loadSubject(basePath, planId)
}

export interface ConsumeExactMergeApprovalInput {
  planId: string
  approvalId: string
  /** Must come from the server's authenticated human-operator context, never an API body or agent claim. */
  operatorActor: string
  planDigest: string
  consumedBy: string
}

export interface ConsumedExactMergeApproval {
  subject: ExactMergeApprovalSubject
  approval: Approval
  decision: GateDecision
  repairedDecision: boolean
}

function isObviousAgentIdentity(actor: string): boolean {
  return /^(?:agent|ai-agent|model)(?:$|[:/\-@])/i.test(actor.trim())
}

function approvalDecision(subject: ExactMergeApprovalSubject, approval: Approval): GateDecision {
  if (!approval.consumed_at) throw new MergeApprovalError('MERGE_APPROVAL_NOT_CONSUMED')
  return {
    id: approvalDecisionId(subject, approval.id),
    subject_type: 'gate', subject_ref: subject.targetRef,
    gate_type: 'approval_present', status: 'PASS', reason_codes: [],
    evidence_refs: [approval.id, subject.planDigest, subject.canonicalPreconditionHash,
      subject.policySnapshotHash], decided_by: 'threados', decided_at: approval.consumed_at,
  }
}

function approvalDecisionId(subject: ExactMergeApprovalSubject, approvalId: string): string {
  return `gd-merge-${hashCanonicalJson({ runId: subject.runId,
    approvalId, planDigest: subject.planDigest }).slice(7)}`
}

interface MergeApprovalDependencies {
  appendDecision?: typeof appendGateDecision
  /** Server-owned clock injection for deterministic tests; never sourced from the request. */
  clock?: () => Date
  /** Internal transaction recovery only, never request-configurable. */
  allowConsumedReceipt?: boolean
  /** Rollback supplies a freshly recomputed subject under the same repository locks. */
  resolveSubject?: (canonicalRoot: string, planId: string) => Promise<ExactMergeApprovalSubject>
}

/**
 * Service-only M2 gate. The service must derive operatorActor from an authenticated
 * human session, enforce merge authorization, and never pass an agent assertion.
 * String checks here reject obvious agent actors but cannot establish identity.
 * The apply service must reverify preview bytes, this digest and W at its write boundary.
 */
export async function consumeExactMergeApproval(basePath: string,
  input: ConsumeExactMergeApprovalInput,
  dependencies: MergeApprovalDependencies = {}): Promise<ConsumedExactMergeApproval> {
  const planId = assertSafePathSegment(input.planId, 'merge plan id')
  assertSafePathSegment(input.approvalId, 'approval id')
  if (!input.operatorActor.trim() || !input.consumedBy.trim()
    || isObviousAgentIdentity(input.operatorActor)
    || !Sha256DigestSchema.safeParse(input.planDigest).success) {
    throw new MergeApprovalError('MERGE_APPROVAL_INPUT_INVALID')
  }
  const now = dependencies.clock?.() ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new MergeApprovalError('MERGE_APPROVAL_INPUT_INVALID')
  const canonicalRoot = await realpath(basePath)
  const local = await readLocalWorkspace(canonicalRoot)
  const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
  const planLock = await resolvePathWithinRoot(runtimeDataRoot, 'merge-plans', `${planId}.json.lock`)

  return withExclusiveFileLock(planLock, async () => {
    const lockedPlan = await new MergeRecordRepository(runtimeDataRoot).getPlan(planId)
    if (!lockedPlan?.preview_workspace_id) throw new MergeApprovalError('MERGE_PLAN_NOT_VALIDATED')
    const previewId = assertSafePathSegment(lockedPlan.preview_workspace_id, 'merge preview id')
    const previewLock = await resolvePathWithinRoot(runtimeDataRoot, 'merge-previews', `${previewId}.json.lock`)
    return withExclusiveFileLock(previewLock, async () => {
    const subject = await (dependencies.resolveSubject ?? loadSubject)(canonicalRoot, planId)
    if (subject.planDigest !== input.planDigest) throw new MergeApprovalError('MERGE_APPROVAL_PLAN_CHANGED')
    const runDir = await resolveExistingPathWithinRoot(canonicalRoot, '.threados', 'runs', subject.runId)
    const filePath = await resolvePathWithinRoot(runDir, 'approvals.ndjson')
    const lockPath = await resolvePathWithinRoot(runDir, 'approvals.ndjson.lock')
    return withExclusiveFileLock(lockPath, async () => {
      let approvals: Approval[]
      try {
        const content = await readTextFileNoFollow(filePath)
        approvals = content.trim().split('\n').filter(Boolean)
          .map(line => ApprovalSchema.parse(JSON.parse(line)))
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new MergeApprovalError('MERGE_APPROVAL_NOT_FOUND')
        }
        throw error
      }
      const current = foldApprovals(approvals).find(item => item.id === input.approvalId)
      if (!current) throw new MergeApprovalError('MERGE_APPROVAL_NOT_FOUND')
      if (current.status !== 'approved' || current.action_type !== 'side_effect'
        || current.target_ref !== subject.targetRef || current.payload_ref !== subject.targetRef
        || current.subject_digest !== subject.planDigest
        || current.policy_ref !== subject.policySnapshotHash
        || current.precondition_hash !== subject.canonicalPreconditionHash
        || current.approved_by !== input.operatorActor
        || isObviousAgentIdentity(current.approved_by ?? '') || !current.approved_at
        || !z.string().datetime().safeParse(current.approved_at).success
        || !current.expires_at
        || Date.parse(current.approved_at) > now.getTime()) {
        throw new MergeApprovalError('MERGE_APPROVAL_BINDING_MISMATCH')
      }
      const priorDecisions = (await readGateDecisionsRecoveringTail(canonicalRoot, subject.runId))
        .filter(item => item.id === approvalDecisionId(subject, current.id))
      if (priorDecisions.length > 1) throw new MergeApprovalError('MERGE_APPROVAL_EVIDENCE_CONFLICT')
      const priorDecision = priorDecisions[0]
      if (current.consumed_at != null) {
        if (current.consumed_by !== input.consumedBy) {
          throw new MergeApprovalError('MERGE_APPROVAL_ALREADY_CONSUMED')
        }
        if (!current.expires_at
          || Date.parse(current.consumed_at) >= Date.parse(current.expires_at)) {
          throw new MergeApprovalError('MERGE_APPROVAL_EVIDENCE_CONFLICT')
        }
        const repair = approvalDecision(subject, current)
        if (priorDecision) {
          if (hashCanonicalJson(priorDecision) !== hashCanonicalJson(repair)) {
            throw new MergeApprovalError('MERGE_APPROVAL_EVIDENCE_CONFLICT')
          }
          if (dependencies.allowConsumedReceipt) return { subject, approval: current, decision: priorDecision, repairedDecision: false }
          throw new MergeApprovalError('MERGE_APPROVAL_ALREADY_CONSUMED')
        }
        await (dependencies.appendDecision ?? appendGateDecision)(canonicalRoot, subject.runId, repair)
        return { subject, approval: current, decision: repair, repairedDecision: true }
      }
      if (priorDecision) throw new MergeApprovalError('MERGE_APPROVAL_EVIDENCE_CONFLICT')
      if (isApprovalExpired(current, now)) throw new MergeApprovalError('MERGE_APPROVAL_EXPIRED')
      const consumedAt = now.toISOString()
      const consumed = ApprovalSchema.parse({ ...current, consumed_at: consumedAt,
        consumed_by: input.consumedBy })
      await writeFileAtomic(filePath,
        [...approvals, consumed].map(item => JSON.stringify(ApprovalSchema.parse(item))).join('\n') + '\n',
        { allowedRoot: canonicalRoot })
      const decision = approvalDecision(subject, consumed)
      await (dependencies.appendDecision ?? appendGateDecision)(canonicalRoot, subject.runId, decision)
      return { subject, approval: consumed, decision, repairedDecision: false }
    }, { allowedRoot: canonicalRoot })
    }, { allowedRoot: runtimeDataRoot })
  }, { allowedRoot: runtimeDataRoot })
}
