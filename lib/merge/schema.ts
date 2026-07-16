import { z } from 'zod'

export const MergeConflictStatusSchema = z.enum(['unresolved', 'resolved'])
export type MergeConflictStatus = z.infer<typeof MergeConflictStatusSchema>

export const MergeConflictSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['text', 'binary', 'delete_modify', 'rename', 'permission']),
  baseline_sha256: z.string().nullable(),
  canonical_sha256: z.string().nullable(),
  candidate_sha256: z.string().nullable(),
  change_set_ids: z.array(z.string().min(1)).min(1),
  status: MergeConflictStatusSchema,
  resolution: z.string().nullable(),
})
export type MergeConflict = z.infer<typeof MergeConflictSchema>

export const MergePlanStatusSchema = z.enum([
  'draft',
  'ready',
  'conflicted',
  'validated',
  'applied',
  'failed',
])
export type MergePlanStatus = z.infer<typeof MergePlanStatusSchema>

export const MergePlanSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  baseline_snapshot_id: z.string().min(1),
  change_set_ids: z.array(z.string().min(1)).min(1),
  canonical_precondition_hash: z.string().min(1),
  preview_workspace_id: z.string().nullable(),
  conflicts: z.array(MergeConflictSchema),
  status: MergePlanStatusSchema,
  created_at: z.string().datetime(),
  validated_at: z.string().datetime().nullable(),
})
export type MergePlan = z.infer<typeof MergePlanSchema>

export const MergeResultStatusSchema = z.enum([
  'applied',
  'failed',
  'rolled_back',
  'rollback_failed',
])
export type MergeResultStatus = z.infer<typeof MergeResultStatusSchema>

export const MergeResultSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  merge_plan_id: z.string().min(1),
  workflow_run_id: z.string().min(1),
  status: MergeResultStatusSchema,
  applied_change_set_ids: z.array(z.string()),
  rollback_ref: z.string().nullable(),
  git_commit: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
export type MergeResult = z.infer<typeof MergeResultSchema>
