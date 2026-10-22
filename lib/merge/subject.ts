import { lstat, realpath } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod'
import { Sha256DigestSchema } from '../contracts/schemas'
import { readMergeValidationProcess } from './process-evidence'
import { ChangeSetRepository } from '../changesets/repository'
import { resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { parseBootstrapCommand } from '../workspaces/bootstrap'
import { hashCanonicalJson, hashSha256Bytes } from '../workspaces/hash'
import { verifySnapshotManifest } from '../workspaces/manifest'
import { resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { verifyWorkspaceTree } from '../workspaces/providers/copy'
import { SnapshotManifestSchema, type SnapshotManifest } from '../workspaces/schema'
import { MergePlanBindingSchema, MergePreviewRecordSchema } from './repository'
import { MergePlanSchema, MergePreviewSchema, type MergePreview } from './schema'

/** The completed validation receipt written by MergeRuntimeOperations. */
export const MergeValidationReceiptSchema = z.object({
  schema_version: z.literal(1),
  merge_plan_id: z.string().min(1),
  plan_revision: z.number().int().nonnegative(),
  actor: z.string().min(1),
  idempotency_key: z.string().min(1),
  validation_command_count: z.number().int().nonnegative(),
  validation_commands_hash: Sha256DigestSchema,
  policy_snapshot_hash: Sha256DigestSchema,
  status: z.literal('completed'),
  error_code: z.null(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime(),
}).strict()
export type MergeValidationReceipt = z.infer<typeof MergeValidationReceiptSchema>

/** Version 1 is the only digest input for both merge approval and canonical apply. */
export const MergePlanSubjectSchema = z.object({
  schema_version: z.literal(1),
  plan: MergePlanSchema,
  binding: MergePlanBindingSchema,
  preview: MergePreviewRecordSchema,
  validation_receipt: MergeValidationReceiptSchema,
  canonical_precondition_hash: Sha256DigestSchema,
}).strict().superRefine((value, context) => {
  const { plan, binding, preview, validation_receipt: receipt } = value
  const selected = binding.selected_change_sets.map(item => item.id)
  if (plan.status !== 'validated' || !plan.validated_at || plan.conflicts.length !== 0
    || !plan.preview_workspace_id || preview.status !== 'ready'
    || preview.id !== plan.preview_workspace_id || preview.merge_plan_id !== plan.id
    || preview.workflow_run_id !== plan.workflow_run_id
    || preview.canonical_precondition_hash !== plan.canonical_precondition_hash
    || preview.candidate_manifest_hash !== binding.candidate_manifest_hash
    || !preview.manifest_hash || !preview.ready_at
    || value.canonical_precondition_hash !== plan.canonical_precondition_hash
    || receipt.merge_plan_id !== plan.id || receipt.plan_revision !== plan.revision - 1
    || selected.length !== plan.change_set_ids.length
    || selected.some((id, index) => id !== plan.change_set_ids[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom,
      message: 'Merge approval subject does not bind one validated plan and preview' })
  }
})
export type MergePlanSubject = z.infer<typeof MergePlanSubjectSchema>

export function createMergePlanSubject(input: Omit<MergePlanSubject, 'schema_version'>): MergePlanSubject {
  return MergePlanSubjectSchema.parse({ schema_version: 1, ...input })
}

export function hashMergePlanSubject(subject: MergePlanSubject): string {
  return hashCanonicalJson(MergePlanSubjectSchema.parse(subject))
}

export interface MergePlanApplyEvidence {
  decision: MergePreview
  previewManifest: SnapshotManifest
  currentCanonicalManifestHash: string
  currentValidationCommandCount: number
  currentValidationCommandsHash: string
  currentPolicySnapshotHash: string
}

const MergeValidationCommandEvidenceSchema = z.object({
  schema_version: z.literal(1),
  merge_plan_id: z.string().min(1),
  preview_id: z.string().min(1),
  index: z.number().int().nonnegative(),
  command_sha256: Sha256DigestSchema,
  args_sha256: Sha256DigestSchema,
  cwd: z.string().min(1),
  status: z.literal('passed'),
  pid: z.number().int().positive(),
  exit_code: z.literal(0),
  process_status: z.literal('exited'),
  stdout_sha256: Sha256DigestSchema,
  stderr_sha256: Sha256DigestSchema,
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
}).strict()

function sameAbsolute(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

export interface PersistedMergeEvidenceRequest {
  canonicalRoot: string
  runtimeDataRoot: string
  localWorkspaceId: string
  subject: MergePlanSubject
  validationCommands: readonly string[]
  currentCanonicalManifestHash: string
  currentValidationCommandsHash: string
  currentPolicySnapshotHash: string
}

/** Re-reads materialized evidence, including real process records, before approval or apply. */
export async function verifyPersistedMergeEvidence(request: PersistedMergeEvidenceRequest): Promise<{
  decision: MergePreview
  previewManifest: SnapshotManifest
  previewRoot: string
}> {
  const subject = MergePlanSubjectSchema.parse(request.subject)
  const namespace = resolveWorkspaceRuntimePaths(request.runtimeDataRoot,
    request.localWorkspaceId, request.canonicalRoot).workspaceNamespace
  const segments = ['merge-preview-workspaces', namespace, subject.preview.id, 'tree']
  const expectedRoot = join(request.runtimeDataRoot, ...segments)
  if (!sameAbsolute(subject.preview.root_path, expectedRoot)) {
    throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
  }
  for (let length = 0; length <= segments.length; length += 1) {
    const path = length === 0 ? request.runtimeDataRoot
      : await resolveExistingPathWithinRoot(request.runtimeDataRoot, ...segments.slice(0, length))
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameAbsolute(await realpath(path), path)) {
      throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
    }
  }
  const evidenceRoot = await resolveExistingPathWithinRoot(request.runtimeDataRoot,
    'merge-validations', subject.plan.id)
  const manifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(
    await resolveExistingPathWithinRoot(evidenceRoot, 'preview-manifest.json'))))
  const decision = MergePreviewSchema.parse(JSON.parse(await readTextFileNoFollow(
    await resolveExistingPathWithinRoot(evidenceRoot, 'decision.json'))))
  if (!verifyMergePlanSubjectForApply(subject, hashMergePlanSubject(subject), {
    decision, previewManifest: manifest,
    currentCanonicalManifestHash: request.currentCanonicalManifestHash,
    currentValidationCommandCount: request.validationCommands.length,
    currentValidationCommandsHash: request.currentValidationCommandsHash,
    currentPolicySnapshotHash: request.currentPolicySnapshotHash,
  })) throw new Error('MERGE_PREVIEW_EVIDENCE_CHANGED')
  await verifyWorkspaceTree(expectedRoot, manifest, { verifyMode: true })
  for (const entry of manifest.entries) {
    if (entry.kind !== 'file') continue
    const path = await resolveExistingPathWithinRoot(expectedRoot, ...entry.path.split('/'))
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error('MERGE_PREVIEW_EVIDENCE_CHANGED')
    }
  }
  const selectedIdentity = request.validationCommands.length ? await ChangeSetRepository.identity(request.canonicalRoot, subject.plan.change_set_ids[0]!) : null
  if (request.validationCommands.length && (!selectedIdentity || selectedIdentity.runId !== subject.plan.workflow_run_id)) throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING')
  for (const [index, source] of request.validationCommands.entries()) {
    const parsed = parseBootstrapCommand(source)
    const saved = MergeValidationCommandEvidenceSchema.parse(JSON.parse(await readTextFileNoFollow(
      await resolveExistingPathWithinRoot(evidenceRoot, `${index}.json`))))
    const processRecord = await readMergeValidationProcess(request.canonicalRoot, {
      id: `process-${subject.plan.id}-${index}`, runId: subject.plan.workflow_run_id,
      attemptId: selectedIdentity!.attemptId, workspaceId: subject.preview.id, ordinal: index })
    if (saved.merge_plan_id !== subject.plan.id || saved.preview_id !== subject.preview.id
      || saved.index !== index || saved.command_sha256 !== hashSha256Bytes(parsed.command)
      || saved.args_sha256 !== hashSha256Bytes(JSON.stringify(parsed.args))
      || !sameAbsolute(saved.cwd, expectedRoot)
      || !processRecord || processRecord.workflow_run_id !== subject.plan.workflow_run_id
      || processRecord.workspace_id !== subject.preview.id
      || processRecord.process_purpose !== 'validation' || processRecord.process_ordinal !== index
      || processRecord.provider !== 'local-process' || processRecord.status !== 'exited'
      || processRecord.exit_code !== 0 || processRecord.pid !== saved.pid
      || processRecord.command !== parsed.command || !sameAbsolute(processRecord.cwd, expectedRoot)) {
      throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING')
    }
  }
  return { decision, previewManifest: manifest, previewRoot: expectedRoot }
}

/** Pure final-boundary check. The caller must obtain fresh bytes and hashes at apply time. */
export function verifyMergePlanSubjectForApply(
  subject: MergePlanSubject,
  expectedDigest: string,
  evidence: MergePlanApplyEvidence,
): boolean {
  const parsed = MergePlanSubjectSchema.safeParse(subject)
  if (!parsed.success || !Sha256DigestSchema.safeParse(expectedDigest).success) return false
  const decision = MergePreviewSchema.safeParse(evidence.decision)
  const manifest = SnapshotManifestSchema.safeParse(evidence.previewManifest)
  if (!decision.success || !manifest.success) return false
  const { plan, binding, preview, validation_receipt: receipt } = parsed.data
  if (hashMergePlanSubject(parsed.data) !== expectedDigest
    || evidence.currentCanonicalManifestHash !== parsed.data.canonical_precondition_hash
    || evidence.currentValidationCommandCount !== receipt.validation_command_count
    || evidence.currentValidationCommandsHash !== receipt.validation_commands_hash
    || evidence.currentPolicySnapshotHash !== receipt.policy_snapshot_hash
    || hashCanonicalJson(decision.data) !== preview.decision_hash
    || manifest.data.root_manifest_hash !== preview.manifest_hash
    || manifest.data.snapshot_id !== preview.id
    || decision.data.canonical_precondition_hash !== plan.canonical_precondition_hash
    || decision.data.baseline_snapshot_id !== plan.baseline_snapshot_id
    || decision.data.candidate_manifest_hash !== binding.candidate_manifest_hash
    || JSON.stringify(decision.data.change_set_ids) !== JSON.stringify(plan.change_set_ids)) return false
  try { verifySnapshotManifest(manifest.data) } catch { return false }
  return true
}
