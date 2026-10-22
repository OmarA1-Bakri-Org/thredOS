import { z } from 'zod'
import { normalizeSnapshotRelativePath } from '../workspaces/schema'

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const ChangeSetEntrySchema = z.object({
  path: z.string().min(1).refine(value => {
    try { return normalizeSnapshotRelativePath(value) === value } catch { return false }
  }, 'Change Set path must be a safe portable relative path'),
  operation: z.enum(['add', 'modify', 'delete', 'rename', 'chmod', 'symlink']),
  before_sha256: Digest.nullable(),
  after_sha256: Digest.nullable(),
  content_kind: z.enum(['text', 'binary']),
  size_bytes_before: z.number().int().nonnegative(),
  size_bytes_after: z.number().int().nonnegative(),
  lines_added: z.number().int().nonnegative().nullable(),
  lines_deleted: z.number().int().nonnegative().nullable(),
  patch_ref: z.string().nullable(),
  content_ref: z.string().nullable(),
  before_kind: z.enum(['file', 'directory', 'symlink']).nullable().optional(),
  after_kind: z.enum(['file', 'directory', 'symlink']).nullable().optional(),
  mode_before: z.number().int().nonnegative().nullable().optional(),
  mode_after: z.number().int().nonnegative().nullable().optional(),
  symlink_target_before: z.string().nullable().optional(),
  symlink_target_after: z.string().nullable().optional(),
}).strict()
export type ChangeSetEntry = z.infer<typeof ChangeSetEntrySchema>

export const ChangeSetValidationSummarySchema = z.object({
  status: z.enum(['pending', 'passed', 'failed']),
  evidence_refs: z.array(z.string()),
  required_commands: z.number().int().nonnegative().default(0),
})
export type ChangeSetValidationSummary = z.infer<typeof ChangeSetValidationSummarySchema>

export const ChangeSetStatusSchema = z.enum([
  'draft',
  'captured',
  'validated',
  'selected',
  'rejected',
  'superseded',
  'merge_ready',
  'conflicted',
  'applied',
  'apply_failed',
])
export type ChangeSetStatus = z.infer<typeof ChangeSetStatusSchema>

export const ChangeSetDecisionSchema = z.object({
  action: z.enum(['select', 'reject']),
  actor: z.string().min(1),
  idempotency_key: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
  decided_at: z.string().datetime(),
  reason: z.string().trim().min(1).nullable(),
}).strict().superRefine((decision, context) => {
  if (decision.action === 'reject' && decision.reason === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Rejection requires a reason' })
  }
})
export type ChangeSetDecision = z.infer<typeof ChangeSetDecisionSchema>

export const ChangeSetDecisionReceiptSchema = z.object({
  schema_version: z.literal(1),
  change_set_id: z.string().min(1),
  revision: z.number().int().positive(),
  change_set_root_hash: Digest,
  decision: ChangeSetDecisionSchema,
}).strict()
export type ChangeSetDecisionReceipt = z.infer<typeof ChangeSetDecisionReceiptSchema>

export const ChangeSetSchema = z.object({
  schema_version: z.literal(2),
  revision: z.number().int().nonnegative(),
  id: z.string().min(1),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  agent_ref: z.string().nullable(),
  workspace_id: z.string().min(1),
  baseline_snapshot_id: z.string().min(1),
  baseline_manifest_hash: Digest,
  final_workspace_manifest_ref: z.string().min(1),
  final_workspace_manifest_hash: Digest,
  change_set_root_hash: Digest,
  created_at: z.string().datetime(),
  entries: z.array(ChangeSetEntrySchema),
  total_bytes: z.number().int().nonnegative(),
  total_lines_added: z.number().int().nonnegative().nullable(),
  total_lines_deleted: z.number().int().nonnegative().nullable(),
  path_scopes: z.array(z.string().min(1)).nullable(),
  path_scope_violations: z.array(z.string()),
  validation: ChangeSetValidationSummarySchema,
  output_contract_state: z.enum(['pending', 'passed', 'failed']),
  approval_state: z.enum(['not_required', 'pending', 'approved', 'rejected']),
  status: ChangeSetStatusSchema,
  decision: ChangeSetDecisionSchema.nullable(),
}).strict().superRefine((record, context) => {
  if (record.status === 'selected' && record.decision?.action !== 'select') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'Selected Change Set requires a selection decision' })
  }
  if (record.status === 'rejected' && record.decision?.action !== 'reject') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'Rejected Change Set requires a rejection decision' })
  }
  if (['draft', 'captured', 'validated'].includes(record.status) && record.decision !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'Unselected Change Set must not have an operator decision' })
  }
})
export type ChangeSet = z.infer<typeof ChangeSetSchema>
