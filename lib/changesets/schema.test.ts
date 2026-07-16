import { describe, expect, test } from 'bun:test'
import {
  ChangeSetEntrySchema,
  ChangeSetSchema,
  ChangeSetStatusSchema,
} from './schema'

const timestamp = '2026-07-16T00:00:00.000Z'

describe('forward ChangeSet contract', () => {
  test('validates a representative captured text change', () => {
    const entry = ChangeSetEntrySchema.parse({
      path: 'src/index.ts',
      operation: 'modify',
      before_sha256: 'sha256:before',
      after_sha256: 'sha256:after',
      content_kind: 'text',
      size_bytes_before: 40,
      size_bytes_after: 48,
      lines_added: 2,
      lines_deleted: 1,
      patch_ref: 'changes/patches/src-index.patch',
      content_ref: null,
    })

    const result = ChangeSetSchema.safeParse({
      schema_version: 1,
      id: 'change-set-01',
      workflow_run_id: 'run-01',
      attempt_id: 'attempt-01',
      step_id: 'step-01',
      surface_id: 'surface-01',
      agent_ref: 'agent-01',
      baseline_snapshot_id: 'snapshot-01',
      baseline_manifest_hash: 'sha256:baseline',
      created_at: timestamp,
      entries: [entry],
      total_bytes: 48,
      total_lines_added: 2,
      total_lines_deleted: 1,
      path_scope_violations: [],
      validation: { status: 'passed', evidence_refs: ['tests/result.json'] },
      output_contract_state: 'passed',
      approval_state: 'approved',
      status: 'validated',
    })
    expect(result.success).toBe(true)
  })

  test('accepts every canonical lifecycle status and rejects an invented one', () => {
    expect(ChangeSetStatusSchema.options).toEqual([
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
    expect(ChangeSetStatusSchema.safeParse('successful').success).toBe(false)
  })
})
