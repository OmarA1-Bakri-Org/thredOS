import { z } from 'zod'

export function findPortablePathAlias(paths: readonly string[]): { existing: string; alias: string } | null {
  const seen = new Map<string, string>()
  for (const path of paths) {
    const segments = path.split('/')
    for (let length = 1; length <= segments.length; length += 1) {
      const prefix = segments.slice(0, length).join('/')
      const folded = prefix.toLocaleLowerCase('en-US')
      const existing = seen.get(folded)
      if (existing !== undefined && existing !== prefix) return { existing, alias: prefix }
      seen.set(folded, prefix)
    }
  }
  return null
}

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

export const FilesystemApplyStatusSchema = z.enum([
  'pending',
  'applied',
  'failed',
  'rolled_back',
  'rollback_failed',
])
export type FilesystemApplyStatus = z.infer<typeof FilesystemApplyStatusSchema>

export const MergeResultStatusSchema = FilesystemApplyStatusSchema
export type MergeResultStatus = z.infer<typeof MergeResultStatusSchema>

export const FilesystemApplyOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    rollback_ref: z.null(),
    error_code: z.null(),
    error_message: z.null(),
  }).strict(),
  z.object({
    status: z.literal('applied'),
    rollback_ref: z.string().min(1),
    error_code: z.null(),
    error_message: z.null(),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    rollback_ref: z.string().nullable(),
    error_code: z.string().min(1),
    error_message: z.string().nullable(),
  }).strict(),
  z.object({
    status: z.literal('rolled_back'),
    rollback_ref: z.string().min(1),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
  }).strict(),
  z.object({
    status: z.literal('rollback_failed'),
    rollback_ref: z.string().min(1),
    error_code: z.string().min(1),
    error_message: z.string().nullable(),
  }).strict(),
])
export type FilesystemApplyOutcome = z.infer<typeof FilesystemApplyOutcomeSchema>

export const GitCommitStatusSchema = z.enum([
  'disabled',
  'skipped',
  'pending',
  'success',
  'failed',
])
export type GitCommitStatus = z.infer<typeof GitCommitStatusSchema>

const GitCommitNotPerformedFields = {
  commit_sha: z.null(),
  error_code: z.null(),
  error_message: z.null(),
}

export const GitCommitOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled'), ...GitCommitNotPerformedFields }).strict(),
  z.object({ status: z.literal('skipped'), ...GitCommitNotPerformedFields }).strict(),
  z.object({ status: z.literal('pending'), ...GitCommitNotPerformedFields }).strict(),
  z.object({
    status: z.literal('success'),
    commit_sha: z.string().min(1),
    error_code: z.null(),
    error_message: z.null(),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    commit_sha: z.null(),
    error_code: z.string().min(1),
    error_message: z.string().nullable(),
  }).strict(),
])
export type GitCommitOutcome = z.infer<typeof GitCommitOutcomeSchema>

export const MergeResultSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  merge_plan_id: z.string().min(1),
  workflow_run_id: z.string().min(1),
  filesystem_apply: FilesystemApplyOutcomeSchema,
  applied_change_set_ids: z.array(z.string()),
  git_commit: GitCommitOutcomeSchema,
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
}).strict()
export type MergeResult = z.infer<typeof MergeResultSchema>
