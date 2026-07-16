import { z } from 'zod'

export const ChangeSetEntrySchema = z.object({
  path: z.string().min(1),
  operation: z.enum(['add', 'modify', 'delete', 'rename', 'chmod', 'symlink']),
  before_sha256: z.string().nullable(),
  after_sha256: z.string().nullable(),
  content_kind: z.enum(['text', 'binary']),
  size_bytes_before: z.number().int().nonnegative(),
  size_bytes_after: z.number().int().nonnegative(),
  lines_added: z.number().int().nonnegative().nullable(),
  lines_deleted: z.number().int().nonnegative().nullable(),
  patch_ref: z.string().nullable(),
  content_ref: z.string().nullable(),
})
export type ChangeSetEntry = z.infer<typeof ChangeSetEntrySchema>

export const ChangeSetValidationSummarySchema = z.object({
  status: z.enum(['pending', 'passed', 'failed']),
  evidence_refs: z.array(z.string()),
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

export const ChangeSetSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  agent_ref: z.string().nullable(),
  baseline_snapshot_id: z.string().min(1),
  baseline_manifest_hash: z.string().min(1),
  final_workspace_manifest_ref: z.string().min(1),
  final_workspace_manifest_hash: z.string().min(1),
  change_set_root_hash: z.string().min(1),
  created_at: z.string().datetime(),
  entries: z.array(ChangeSetEntrySchema),
  total_bytes: z.number().int().nonnegative(),
  total_lines_added: z.number().int().nonnegative().nullable(),
  total_lines_deleted: z.number().int().nonnegative().nullable(),
  path_scope_violations: z.array(z.string()),
  validation: ChangeSetValidationSummarySchema,
  output_contract_state: z.enum(['pending', 'passed', 'failed']),
  approval_state: z.enum(['not_required', 'pending', 'approved', 'rejected']),
  status: ChangeSetStatusSchema,
})
export type ChangeSet = z.infer<typeof ChangeSetSchema>
