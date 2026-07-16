import { describe, expect, test } from 'bun:test'
import {
  SnapshotEntrySchema,
  SnapshotManifestSchema,
  SurfaceWorkspaceSchema,
  SurfaceWorkspaceStatusSchema,
  WorkspaceSnapshotSchema,
  WorkspaceSnapshotStatusSchema,
} from './schema'

const timestamp = '2026-07-16T00:00:00.000Z'

describe('workspace snapshot schemas', () => {
  test('validates representative entries and manifests', () => {
    const entry = SnapshotEntrySchema.parse({
      path: 'src/index.ts',
      kind: 'file',
      sha256: 'sha256:file',
      size_bytes: 42,
      mode: 0o644,
      symlink_target: null,
    })
    expect(SnapshotManifestSchema.safeParse({
      schema_version: 1,
      snapshot_id: 'snapshot-01',
      root_manifest_hash: 'sha256:root',
      entries: [entry],
    }).success).toBe(true)
  })

  test('validates a legacy-compatible snapshot with nullable content refs', () => {
    const snapshot = WorkspaceSnapshotSchema.parse({
      schema_version: 1,
      id: 'snapshot-01',
      local_workspace_id: 'local-01',
      source_root: 'C:\\project',
      content_root: null,
      manifest_ref: null,
      status: 'creating',
      root_manifest_hash: null,
      exclusion_policy_hash: 'sha256:exclude',
      file_count: 0,
      total_bytes: 0,
      git_head: null,
      git_dirty: null,
      created_at: timestamp,
      verified_at: null,
      error_code: null,
    })
    expect(snapshot.content_root).toBeNull()
    expect(WorkspaceSnapshotStatusSchema.safeParse('active').success).toBe(false)
  })
})

describe('surface workspace schema', () => {
  const workspace = {
    schema_version: 1 as const,
    id: 'workspace-01',
    revision: 0,
    workflow_run_id: 'run-01',
    attempt_id: 'attempt-01',
    surface_id: 'surface-01',
    snapshot_id: 'snapshot-01',
    provider: 'copy' as const,
    isolation_label: 'THREADOS_SCOPED' as const,
    root_path: 'C:\\threados\\workspaces\\workspace-01',
    status: 'ready' as const,
    retention_policy: 'retain_on_failure' as const,
    manifest_hash: 'sha256:manifest',
    file_count: 10,
    total_bytes: 1000,
    created_at: timestamp,
    ready_at: timestamp,
    cleaned_at: null,
    error_code: null,
  }

  test('accepts HOST_ENFORCED as contract data', () => {
    expect(SurfaceWorkspaceSchema.safeParse({
      ...workspace,
      provider: 'container',
      isolation_label: 'HOST_ENFORCED',
    }).success).toBe(true)
  })

  test('requires distinct run and attempt references', () => {
    const parsed = SurfaceWorkspaceSchema.parse(workspace)
    expect(parsed.workflow_run_id).toBe('run-01')
    expect(parsed.attempt_id).toBe('attempt-01')
    expect(parsed.workflow_run_id).not.toBe(parsed.attempt_id)
  })

  test('accepts only canonical workspace statuses', () => {
    expect(SurfaceWorkspaceStatusSchema.options).toEqual([
      'planned',
      'materializing',
      'ready',
      'active',
      'frozen',
      'retained',
      'cleaning',
      'cleaned',
      'failed',
    ])
    expect(SurfaceWorkspaceStatusSchema.safeParse('deleted').success).toBe(false)
  })
})
