import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceInspection } from '@/lib/workspaces/inspection'
import {
  WorkspaceInspectionDetails,
  workspaceExplorerAvailable,
  workspaceCleanBlocked,
  workspaceRetainBlocked,
} from './WorkspaceInspector'

const NOW = '2026-09-28T00:00:00.000Z'

function inspection(overrides: Partial<WorkspaceInspection> = {}): WorkspaceInspection {
  return {
    schema_version: 1,
    workspace: {
      schema_version: 1,
      id: 'workspace-1',
      revision: 2,
      workflow_run_id: 'run-1',
      attempt_id: 'attempt-1',
      surface_id: 'surface-1',
      snapshot_id: 'snapshot-1',
      provider: 'copy',
      isolation_label: 'THREADOS_SCOPED',
      root_path: 'C:\\threados-runtime\\workspace-1',
      status: 'ready',
      retention_policy: 'retain_until_applied',
      manifest_hash: 'a'.repeat(64),
      file_count: 12,
      total_bytes: 2048,
      reserved_bytes: 2048,
      created_at: NOW,
      ready_at: NOW,
      cleaned_at: null,
      error_code: null,
    },
    snapshot: {
      id: 'snapshot-1',
      status: 'ready',
      root_manifest_hash: 'b'.repeat(64),
      file_count: 12,
      total_bytes: 2048,
      created_at: NOW,
      verified_at: NOW,
    },
    manifest_hash: 'a'.repeat(64),
    attempt: {
      id: 'attempt-1',
      status: 'completed',
      step_id: 'step-1',
      workflow_run_id: 'run-1',
    },
    processes: [{
      id: 'process-1',
      attempt_id: 'attempt-1',
      status: 'exited',
      pid: 4242,
      exit_code: 0,
      started_at: NOW,
      ended_at: NOW,
    }],
    verification: { exists: true, manifestMatches: false, hasUsefulOutput: true },
    bootstrap: [{ index: 0, status: 'success', duration_ms: 25, exit_code: 0 }],
    diagnostics: [{ code: 'WORKSPACE_CHANGED', message: 'Workspace differs from its baseline.' }],
    ...overrides,
  }
}

describe('WorkspaceInspector', () => {
  test('renders durable workspace, snapshot, isolation, process, bootstrap, and verification truth', () => {
    const markup = renderToStaticMarkup(<WorkspaceInspectionDetails inspection={inspection()} />)

    expect(markup).toContain('workspace-1')
    expect(markup).toContain('snapshot-1')
    expect(markup).toContain('copy')
    expect(markup).toContain('THREADOS_SCOPED')
    expect(markup).toContain('Directory-scoped isolation; the host does not enforce this boundary.')
    expect(markup).toContain('C:\\threados-runtime\\workspace-1')
    expect(markup).toContain('2.0 KB')
    expect(markup).toContain('Matches baseline')
    expect(markup).toContain('No')
    expect(markup).toContain('process-1 · exited · PID 4242 · exit 0')
    expect(markup).toContain('Command 1 · success · 25 ms · exit 0')
    expect(markup).toContain('WORKSPACE_CHANGED: Workspace differs from its baseline.')
  })

  test('permits terminal workspace actions and blocks them while execution is unresolved', () => {
    expect(workspaceCleanBlocked(inspection())).toBe(false)
    expect(workspaceRetainBlocked(inspection())).toBe(false)

    const active = inspection({
      attempt: { id: 'attempt-1', status: 'running', step_id: 'step-1', workflow_run_id: 'run-1' },
      processes: [{
        id: 'process-1',
        attempt_id: 'attempt-1',
        status: 'running',
        pid: 4242,
        exit_code: null,
        started_at: NOW,
        ended_at: null,
      }],
    })
    expect(workspaceCleanBlocked(active)).toBe(true)
    expect(workspaceRetainBlocked(active)).toBe(true)
  })

  test('does not offer redundant retain or cleanup actions for terminal record-only states', () => {
    const retained = inspection({
      workspace: { ...inspection().workspace, status: 'retained' },
    })
    expect(workspaceCleanBlocked(retained)).toBe(false)
    expect(workspaceRetainBlocked(retained)).toBe(true)

    const cleaned = inspection({
      workspace: {
        ...inspection().workspace,
        status: 'cleaned',
        reserved_bytes: 0,
        cleaned_at: NOW,
      },
      verification: { exists: false, manifestMatches: null, hasUsefulOutput: null },
    })
    expect(workspaceCleanBlocked(cleaned)).toBe(true)
    expect(workspaceRetainBlocked(cleaned)).toBe(true)
  })

  test.each(['lost', 'exited'] as const)('blocks actions for %s process evidence without a PID', status => {
    const unresolved = inspection({ processes: [{ ...inspection().processes[0]!, status, pid: null }] })
    expect(workspaceCleanBlocked(unresolved)).toBe(true)
    expect(workspaceRetainBlocked(unresolved)).toBe(true)
  })

  test('offers Explorer only for an existing verified copy workspace with the desktop bridge', () => {
    expect(workspaceExplorerAvailable(inspection(), true)).toBe(true)
    expect(workspaceExplorerAvailable(inspection(), false)).toBe(false)
    expect(workspaceExplorerAvailable(inspection({ verification: { exists: false, manifestMatches: null, hasUsefulOutput: null } }), true)).toBe(false)
    expect(workspaceExplorerAvailable(inspection({ diagnostics: [{ code: 'WORKSPACE_STORAGE_UNSAFE', message: 'Unsafe root' }] }), true)).toBe(false)
    expect(workspaceExplorerAvailable(inspection({ workspace: { ...inspection().workspace, status: 'cleaned' } }), true)).toBe(false)
  })
})
