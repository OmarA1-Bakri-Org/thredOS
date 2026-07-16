import { describe, expect, test } from 'bun:test'
import {
  MergeConflictSchema,
  MergeConflictStatusSchema,
  FilesystemApplyStatusSchema,
  GitCommitStatusSchema,
  MergePlanSchema,
  MergePlanStatusSchema,
  MergeResultSchema,
  MergeResultStatusSchema,
} from './schema'

const timestamp = '2026-07-16T00:00:00.000Z'

describe('forward merge contracts', () => {
  const conflict = {
    id: 'conflict-01',
    path: 'src/index.ts',
    kind: 'text' as const,
    baseline_sha256: 'sha256:baseline',
    canonical_sha256: 'sha256:canonical',
    candidate_sha256: 'sha256:candidate',
    change_set_ids: ['change-set-01'],
    status: 'unresolved' as const,
    resolution: null,
  }

  test('validates an explicit unresolved conflict', () => {
    expect(MergeConflictSchema.parse(conflict).status).toBe('unresolved')
    expect(MergeConflictStatusSchema.safeParse('ignored').success).toBe(false)
  })

  test('validates a precondition-bound merge plan', () => {
    expect(MergePlanSchema.safeParse({
      schema_version: 1,
      id: 'merge-plan-01',
      revision: 0,
      workflow_run_id: 'run-01',
      baseline_snapshot_id: 'snapshot-01',
      change_set_ids: ['change-set-01'],
      canonical_precondition_hash: 'sha256:canonical',
      preview_workspace_id: null,
      conflicts: [conflict],
      status: 'conflicted',
      created_at: timestamp,
      validated_at: null,
    }).success).toBe(true)
    expect(MergePlanStatusSchema.safeParse('successful').success).toBe(false)
  })

  test('validates a merge result with separate apply and Git outcomes', () => {
    expect(MergeResultSchema.safeParse({
      schema_version: 1,
      id: 'merge-result-01',
      merge_plan_id: 'merge-plan-01',
      workflow_run_id: 'run-01',
      filesystem_apply: {
        status: 'applied',
        rollback_ref: 'rollback/merge-result-01.json',
        error_code: null,
        error_message: null,
      },
      applied_change_set_ids: ['change-set-01'],
      git_commit: {
        status: 'disabled',
        commit_sha: null,
        error_code: null,
        error_message: null,
      },
      created_at: timestamp,
      completed_at: timestamp,
    }).success).toBe(true)
    expect(FilesystemApplyStatusSchema.safeParse('success').success).toBe(false)
    expect(MergeResultStatusSchema.safeParse('successful').success).toBe(false)
  })

  test.each([
    ['disabled', null, null],
    ['skipped', null, null],
    ['pending', null, null],
    ['success', 'abc123', null],
    ['failed', null, 'GIT_COMMIT_FAILED'],
  ])('records Git commit outcome %s separately from filesystem apply', (status, commitSha, errorCode) => {
    const result = MergeResultSchema.safeParse({
      schema_version: 1,
      id: `merge-result-${status}`,
      merge_plan_id: 'merge-plan-01',
      workflow_run_id: 'run-01',
      filesystem_apply: {
        status: 'applied',
        rollback_ref: 'rollback/merge-result.json',
        error_code: null,
        error_message: null,
      },
      applied_change_set_ids: ['change-set-01'],
      git_commit: {
        status,
        commit_sha: commitSha,
        error_code: errorCode,
        error_message: errorCode == null ? null : 'Commit failed',
      },
      created_at: timestamp,
      completed_at: timestamp,
    })
    expect(result.success).toBe(true)
    expect(GitCommitStatusSchema.safeParse(status).success).toBe(true)
  })

  test('rejects the old conflated merge-result shape', () => {
    expect(MergeResultSchema.safeParse({
      schema_version: 1,
      id: 'merge-result-old',
      merge_plan_id: 'merge-plan-01',
      workflow_run_id: 'run-01',
      status: 'applied',
      applied_change_set_ids: ['change-set-01'],
      rollback_ref: 'rollback/merge-result-old.json',
      git_commit: null,
      created_at: timestamp,
      completed_at: timestamp,
      error_code: null,
      error_message: null,
    }).success).toBe(false)
  })
})
