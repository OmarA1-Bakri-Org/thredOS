import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import type { RuntimeCommandContext } from '@/lib/runtime/service-types'
import type { WorkspaceInspection } from '@/lib/workspaces/inspection'
import type { SurfaceWorkspace } from '@/lib/workspaces/schema'

const NOW = '2026-09-28T00:00:00.000Z'

function workspace(status: SurfaceWorkspace['status'] = 'retained'): SurfaceWorkspace {
  return {
    schema_version: 1,
    id: 'workspace-1',
    revision: 1,
    workflow_run_id: 'run-1',
    attempt_id: 'attempt-1',
    surface_id: 'surface-1',
    snapshot_id: 'snapshot-1',
    provider: 'copy',
    isolation_label: 'THREADOS_SCOPED',
    root_path: 'C:\\threados-runtime\\workspace-1',
    status,
    retention_policy: 'retain_until_applied',
    manifest_hash: `sha256:${'a'.repeat(64)}`,
    file_count: 2,
    total_bytes: 10,
    reserved_bytes: status === 'cleaned' ? 0 : 10,
    created_at: NOW,
    ready_at: NOW,
    cleaned_at: status === 'cleaned' ? NOW : null,
    error_code: null,
  }
}

function inspection(status: SurfaceWorkspace['status'] = 'retained'): WorkspaceInspection {
  return {
    schema_version: 1,
    workspace: workspace(status),
    snapshot: null,
    manifest_hash: `sha256:${'a'.repeat(64)}`,
    attempt: null,
    processes: [],
    verification: {
      exists: status !== 'cleaned',
      manifestMatches: status === 'cleaned' ? null : true,
      hasUsefulOutput: status === 'cleaned' ? null : false,
    },
    bootstrap: [],
    diagnostics: [],
  }
}

describe.serial('workspace API routes', () => {
  let calls: Array<{ method: string; args: unknown[] }>

  beforeEach(() => {
    calls = []
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      listWorkspaces: async (...args: unknown[]) => {
        calls.push({ method: 'listWorkspaces', args })
        return [workspace()]
      },
      inspectWorkspace: async (...args: unknown[]) => {
        calls.push({ method: 'inspectWorkspace', args })
        return inspection()
      },
      retainWorkspace: async (...args: unknown[]) => {
        calls.push({ method: 'retainWorkspace', args })
        return inspection()
      },
      cleanWorkspace: async (...args: unknown[]) => {
        calls.push({ method: 'cleanWorkspace', args })
        return inspection('cleaned')
      },
      doctorWorkspaces: async (...args: unknown[]) => {
        calls.push({ method: 'doctorWorkspaces', args })
        return { healthy: true, checkedRecords: 1, checkedDirectories: 1, issues: [] }
      },
    } as unknown as RuntimeServicePort
  })

  afterEach(() => {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
  })

  test('list and detail routes delegate to the shared service', async () => {
    const { GET: list } = await import('@/app/api/workspaces/route')
    const listResponse = await list(new Request('http://localhost/api/workspaces?run_id=run-1'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual({
      schema_version: 1,
      workspaces: [workspace()],
    })
    expect(calls[0]).toEqual({ method: 'listWorkspaces', args: [{ runId: 'run-1' }] })

    const { GET: detail } = await import('@/app/api/workspaces/[workspaceId]/route')
    const detailResponse = await detail(new Request('http://localhost/api/workspaces/workspace-1'), {
      params: Promise.resolve({ workspaceId: 'workspace-1' }),
    })
    expect(detailResponse.status).toBe(200)
    await expect(detailResponse.json()).resolves.toMatchObject({
      schema_version: 1,
      workspace: { id: 'workspace-1' },
    })
  })

  test('retain and clean bind actor, interface, idempotency, and confirmation', async () => {
    const { POST: retain } = await import('@/app/api/workspaces/[workspaceId]/retain/route')
    const retained = await retain(new Request('http://localhost/api/workspaces/workspace-1/retain', {
      method: 'POST',
      headers: { 'idempotency-key': 'retain-1' },
    }), { params: Promise.resolve({ workspaceId: 'workspace-1' }) })
    expect(retained.status).toBe(200)

    const { POST: clean } = await import('@/app/api/workspaces/[workspaceId]/clean/route')
    const cleaned = await clean(new Request('http://localhost/api/workspaces/workspace-1/clean', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'clean-1' },
      body: JSON.stringify({ policy_confirmed: true }),
    }), { params: Promise.resolve({ workspaceId: 'workspace-1' }) })
    expect(cleaned.status).toBe(200)
    await expect(cleaned.json()).resolves.toMatchObject({ workspace: { status: 'cleaned' } })

    const retainContext = calls.find(call => call.method === 'retainWorkspace')?.args[1] as RuntimeCommandContext
    expect(retainContext).toMatchObject({
      actor: 'local@thredos',
      interface: 'api',
      idempotencyKey: 'retain-1',
      policyConfirmed: false,
    })
    const cleanContext = calls.find(call => call.method === 'cleanWorkspace')?.args[1] as RuntimeCommandContext
    expect(cleanContext).toMatchObject({
      actor: 'local@thredos',
      interface: 'api',
      idempotencyKey: 'clean-1',
      policyConfirmed: true,
    })
  })

  test('doctor delegates and malformed cleanup input fails before service mutation', async () => {
    const { GET: doctor } = await import('@/app/api/workspaces/doctor/route')
    const doctorResponse = await doctor(new Request('http://localhost/api/workspaces/doctor'))
    expect(doctorResponse.status).toBe(200)
    await expect(doctorResponse.json()).resolves.toMatchObject({ healthy: true, checkedRecords: 1 })

    const { POST: clean } = await import('@/app/api/workspaces/[workspaceId]/clean/route')
    const invalid = await clean(new Request('http://localhost/api/workspaces/workspace-1/clean', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policy_confirmed: true, unexpected: true }),
    }), { params: Promise.resolve({ workspaceId: 'workspace-1' }) })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(calls.filter(call => call.method === 'cleanWorkspace')).toHaveLength(0)
  })
})
