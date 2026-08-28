import { describe, expect, test } from 'bun:test'
import type { WorkspaceLimits } from './config-schema'
import { createSnapshotManifest } from './manifest'
import type { SurfaceWorkspace } from './schema'
import {
  WorkspaceQuotaError,
  WorkspaceQuotaTracker,
  assertProvisionQuota,
  calculateWorkspaceUsage,
} from './quotas'

const limits: WorkspaceLimits = {
  max_active: 2,
  max_bytes_each: 20,
  max_total_retained_bytes: 30,
  max_files: 3,
}

function workspace(
  id: string,
  status: SurfaceWorkspace['status'],
  totalBytes = 0,
): SurfaceWorkspace {
  const ready = ['ready', 'active', 'frozen', 'retained', 'cleaning', 'cleaned'].includes(status)
  return {
    schema_version: 1,
    id,
    revision: 0,
    workflow_run_id: 'run-01',
    attempt_id: `attempt-${id}`,
    surface_id: `surface-${id}`,
    snapshot_id: 'snapshot-01',
    provider: 'copy',
    isolation_label: 'THREADOS_SCOPED',
    root_path: `C:\\runtime\\${id}\\tree`,
    status,
    retention_policy: 'retain_until_applied',
    manifest_hash: ready ? `sha256:${'a'.repeat(64)}` : null,
    file_count: ready ? 1 : 0,
    total_bytes: ready ? totalBytes : 0,
    created_at: '2026-08-28T00:00:00.000Z',
    ready_at: ready ? '2026-08-28T00:01:00.000Z' : null,
    cleaned_at: status === 'cleaned' ? '2026-08-28T00:02:00.000Z' : null,
    error_code: status === 'failed' ? 'COPY_FAILED' : null,
  }
}

const manifest = createSnapshotManifest('snapshot-01', [
  { path: 'src', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null },
  { path: 'src/a.ts', kind: 'file', sha256: `sha256:${'1'.repeat(64)}`, size_bytes: 8, mode: 0o644, symlink_target: null },
])

describe('workspace quotas', () => {
  test('accounts active workspaces and retained bytes from canonical records', () => {
    expect(calculateWorkspaceUsage([
      { ...workspace('a', 'active', 8), reserved_bytes: 8 },
      workspace('b', 'retained', 12),
      workspace('c', 'cleaned', 15),
    ])).toEqual({ activeWorkspaces: 1, retainedBytes: 20 })
    expect(calculateWorkspaceUsage([
      workspace('cleaning', 'cleaning', 7),
      {
        ...workspace('recovery', 'failed'),
        manifest_hash: `sha256:${'a'.repeat(64)}`,
        file_count: 1,
        total_bytes: 9,
        ready_at: '2026-08-28T00:01:00.000Z',
        error_code: 'WORKSPACE_RECOVERY_REQUIRED',
      },
      workspace('cleaned', 'cleaned', 11),
    ])).toEqual({ activeWorkspaces: 0, retainedBytes: 16 })
  })

  test('rejects active, retained, file, and byte quotas before provisioning', () => {
    expect(() => assertProvisionQuota([
      workspace('a', 'ready', 8),
      workspace('b', 'active', 8),
    ], manifest, limits)).toThrow(WorkspaceQuotaError)

    const tooManyFiles = createSnapshotManifest('snapshot-many', [
      ...manifest.entries,
      { path: 'b', kind: 'file', sha256: `sha256:${'2'.repeat(64)}`, size_bytes: 1, mode: 0o644, symlink_target: null },
      { path: 'c', kind: 'file', sha256: `sha256:${'3'.repeat(64)}`, size_bytes: 1, mode: 0o644, symlink_target: null },
      { path: 'd', kind: 'file', sha256: `sha256:${'5'.repeat(64)}`, size_bytes: 1, mode: 0o644, symlink_target: null },
    ])
    expect(() => assertProvisionQuota([], tooManyFiles, limits))
      .toThrow('file count')

    const tooLarge = createSnapshotManifest('snapshot-large', [
      { path: 'large.bin', kind: 'file', sha256: `sha256:${'4'.repeat(64)}`, size_bytes: 21, mode: 0o644, symlink_target: null },
    ])
    expect(() => assertProvisionQuota([], tooLarge, limits))
      .toThrow(/[Ww]orkspace bytes/)

    expect(() => assertProvisionQuota([
      workspace('retained', 'retained', 25),
    ], manifest, limits)).toThrow('retained bytes')
  })

  test('enforces entry and byte quotas during materialization', () => {
    const tracker = new WorkspaceQuotaTracker(limits)
    tracker.recordEntry(8)
    tracker.recordEntry(0, false)
    expect(tracker.usage()).toEqual({ entries: 1, bytes: 8 })
    tracker.recordEntry(1)
    tracker.recordEntry(1)
    expect(() => tracker.recordEntry(1)).toThrow('file count')

    const byteTracker = new WorkspaceQuotaTracker(limits)
    expect(() => byteTracker.recordEntry(21)).toThrow(/[Ww]orkspace bytes/)
  })
})
