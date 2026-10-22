import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChangeSetReview } from '@/lib/changesets/diff'
import { ChangeSetReviewDetails, canDecideChangeSet } from './ChangeSetInspector'

const review: ChangeSetReview = {
  schema_version: 1,
  summary: {
    schema_version: 1, id: 'change-1', revision: 2, workflow_run_id: 'run-1',
    attempt_id: 'attempt-1', step_id: 'step-1', surface_id: 'surface-1',
    agent_ref: 'agent-1', workspace_id: 'workspace-1', baseline_snapshot_id: 'snapshot-1',
    change_set_root_hash: 'sha256:abc', created_at: '2026-09-29T00:00:00.000Z',
    status: 'captured', entry_count: 2, total_bytes: 120,
    path_scope_violations: ['src/escape.ts'],
    validation: { status: 'failed', evidence_refs: ['test-results/suite.txt'], required_commands: 0 },
    output_contract_state: 'failed', approval_state: 'pending', decision: null,
  },
  entries: [
    { path: 'src/hello.ts', operation: 'modify', before_sha256: 'sha256:before', after_sha256: 'sha256:after',
      content_kind: 'text', size_bytes_before: 5, size_bytes_after: 6, lines_added: 1, lines_deleted: 1,
      patch_ref: null, content_ref: null, before_text: 'before', after_text: 'after',
      unified_diff: '--- a/src/hello.ts\n+++ b/src/hello.ts\n-before\n+after', preview_truncated: false },
    { path: 'assets/logo.png', operation: 'add', before_sha256: null, after_sha256: 'sha256:binary',
      content_kind: 'binary', size_bytes_before: 0, size_bytes_after: 114, lines_added: null, lines_deleted: null,
      patch_ref: null, content_ref: null, before_text: null, after_text: null,
      unified_diff: null, preview_truncated: false },
  ],
  file_tree_truncated: false,
  test_evidence_refs: ['test-results/suite.txt'],
}

describe('ChangeSetInspector', () => {
  test('shows bounded file evidence, text and binary changes, scope and test failures, and provenance', () => {
    const html = renderToStaticMarkup(<ChangeSetReviewDetails review={review} selectedPath="src/hello.ts" />)
    expect(html).toContain('src/hello.ts')
    expect(html).toContain('assets/logo.png')
    expect(html).toContain('before')
    expect(html).toContain('after')
    expect(html).toContain('Unified diff')
    expect(renderToStaticMarkup(<ChangeSetReviewDetails review={review} selectedPath="assets/logo.png" />)).toContain('Binary content')
    expect(html).toContain('src/escape.ts')
    expect(html).toContain('test-results/suite.txt')
    expect(html).toContain('snapshot-1')
    expect(html).toContain('agent-1')
    expect(html).toContain('Selection records a preference')
  })

  test('selection is a preference even with failed gates, but terminal decisions are read only', () => {
    expect(canDecideChangeSet(review.summary)).toBe(true)
    expect(canDecideChangeSet({ ...review.summary, path_scope_violations: [],
      validation: { status: 'passed', evidence_refs: [], required_commands: 0 }, output_contract_state: 'passed',
      approval_state: 'not_required' })).toBe(true)
    expect(canDecideChangeSet({ ...review.summary, status: 'applied', path_scope_violations: [],
      validation: { status: 'passed', evidence_refs: [], required_commands: 0 }, output_contract_state: 'passed',
      approval_state: 'not_required' })).toBe(false)
  })
})
