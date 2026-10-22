import { createHash } from 'crypto'
import { z } from 'zod'
import { normalizeSnapshotRelativePath, SnapshotEntrySchema, SnapshotManifestSchema } from '../workspaces/schema'

const SafePathSchema = z.string().min(1).refine(value => {
  try { return normalizeSnapshotRelativePath(value) === value } catch { return false }
}, 'Merge path must be a safe portable relative path')

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
  path: SafePathSchema,
  kind: z.enum(['text', 'binary', 'delete_modify', 'rename', 'permission', 'unsupported']),
  baseline_sha256: z.string().nullable(),
  canonical_sha256: z.string().nullable(),
  candidate_sha256: z.string().nullable(),
  change_set_ids: z.array(z.string().min(1)).min(1),
  status: MergeConflictStatusSchema,
  resolution: z.string().nullable(),
})
export type MergeConflict = z.infer<typeof MergeConflictSchema>

/** A pure preview decision. Only candidate-changed paths appear here; all other W paths survive. */
export const MergePreviewEntrySchema = z.object({
  path: SafePathSchema,
  decision: z.enum(['candidate', 'already_present', 'merged']),
  result: SnapshotEntrySchema.nullable(),
  merged_text: z.string().nullable(),
}).strict().superRefine((entry, context) => {
  if (entry.result !== null && entry.result.path !== entry.path) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'path'], message: 'Result path must equal preview path' })
  }
  if ((entry.decision === 'merged') !== (entry.merged_text !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['merged_text'], message: 'Only merged entries include merged text' })
  }
  if (entry.decision === 'merged') {
    if (entry.result?.kind !== 'file' || entry.merged_text === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['result'], message: 'Merged text requires a file result' })
    } else {
      const sha256 = `sha256:${createHash('sha256').update(entry.merged_text, 'utf8').digest('hex')}`
      if (entry.result.sha256 !== sha256 || entry.result.size_bytes !== Buffer.byteLength(entry.merged_text)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['result'], message: 'Merged result must match merged text bytes' })
      }
    }
  }
})
export type MergePreviewEntry = z.infer<typeof MergePreviewEntrySchema>

export const MergePreviewSchema = z.object({
  schema_version: z.literal(1),
  baseline_snapshot_id: z.string().min(1),
  baseline_manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidate_snapshot_id: z.string().min(1),
  candidate_manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  canonical_precondition_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  change_set_ids: z.array(z.string().min(1)).min(1),
  entries: z.array(MergePreviewEntrySchema),
  conflicts: z.array(MergeConflictSchema),
}).strict().superRefine((preview, context) => {
  const seen = new Set<string>()
  preview.entries.forEach((entry, index) => {
    if (seen.has(entry.path)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'path'], message: 'Duplicate merge preview path' })
    seen.add(entry.path)
  })
  preview.conflicts.forEach((conflict, index) => {
    if (seen.has(conflict.path)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['conflicts', index, 'path'], message: 'Duplicate merge preview path' })
    seen.add(conflict.path)
  })
  const alias = findPortablePathAlias([...preview.entries.map(entry => entry.path), ...preview.conflicts.map(conflict => conflict.path)])
  if (alias) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries'], message: `Portable path alias: ${alias.existing} and ${alias.alias}` })
  }
})
export type MergePreview = z.infer<typeof MergePreviewSchema>

export const ThreeInputMergeRequestSchema = z.object({
  baseline: SnapshotManifestSchema,
  canonical: SnapshotManifestSchema,
  candidate: SnapshotManifestSchema,
  changeSetIds: z.array(z.string().min(1)).min(1),
  text: z.object({
    baseline: z.record(z.string(), z.string()).optional(),
    canonical: z.record(z.string(), z.string()).optional(),
    candidate: z.record(z.string(), z.string()).optional(),
  }).strict().optional(),
  candidateOperations: z.array(z.object({
    path: SafePathSchema,
    operation: z.enum(['add', 'modify', 'delete', 'rename', 'chmod', 'symlink']),
    content_kind: z.enum(['text', 'binary']).optional(),
  }).strict()).optional(),
}).strict()
export type ThreeInputMergeRequest = z.infer<typeof ThreeInputMergeRequestSchema>

export const MergePlanStatusSchema = z.enum([
  'draft',
  'ready',
  'conflicted',
  'validated',
  'applied',
  'rolled_back',
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
  'rolled_back',
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
