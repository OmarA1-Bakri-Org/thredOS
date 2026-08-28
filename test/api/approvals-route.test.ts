import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readApprovals } from '@/lib/approvals/repository'
import { setApprovalTraceAppenderForTests } from '@/lib/approvals/runtime'
import { readTraceEvents } from '@/lib/traces/reader'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'

let tmpDir: string

describe.serial('approvals API route', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
    process.env.THREADOS_BASE_PATH = tmpDir
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    setApprovalTraceAppenderForTests(null)
    await cleanTempDir(tmpDir)
  })

  test('exact run approvals require binding, resolve through the persisted pending record, and project execution authority honestly', async () => {
    const { GET, POST } = await import('@/app/api/approvals/route')
    const runId = 'run-approvals-route'

    const invalidRequestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
      }),
    }))

    expect(invalidRequestRes.status).toBe(400)
    await expect(invalidRequestRes.json()).resolves.toMatchObject({
      code: 'APPROVAL_BINDING_REQUIRED',
    })

    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        notes: 'Needs exact review',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        precondition_hash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        expires_at: '2099-01-01T00:00:00.000Z',
      }),
    }))

    expect(requestRes.status).toBe(200)
    const requestBody = await requestRes.json()
    expect(requestBody).toMatchObject({
      commit_status: 'committed',
      trace_status: 'persisted',
    })
    expect(requestBody.approval).toMatchObject({
      action_type: 'run',
      target_ref: 'step:build',
      requested_by: 'agent-alpha',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: 'Needs exact review',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      precondition_hash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expires_at: '2099-01-01T00:00:00.000Z',
      consumed_at: null,
      consumed_by: null,
      binding_status: 'exact',
      authoritative_for_execution: false,
    })

    const resolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId,
        approval_id: requestBody.approval.id,
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        approved_by: 'ignored-reviewer',
        status: 'approved',
        notes: 'Approved',
      }),
    }))

    expect(resolveRes.status).toBe(200)
    const resolveBody = await resolveRes.json()
    expect(resolveBody).toMatchObject({
      commit_status: 'committed',
      trace_status: 'persisted',
    })
    expect(resolveBody.approval).toMatchObject({
      id: requestBody.approval.id,
      action_type: 'run',
      target_ref: 'step:build',
      requested_by: 'agent-alpha',
      status: 'approved',
      approved_by: 'local@thredos',
      notes: 'Approved',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      binding_status: 'exact',
      authoritative_for_execution: true,
    })
    expect(resolveBody.approval.approved_at).toBeTruthy()

    const listRes = await GET(new Request(`http://localhost/api/approvals?runId=${runId}`))
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.approvals).toHaveLength(1)
    expect(listBody.approvals[0]).toMatchObject({
      id: requestBody.approval.id,
      action_type: 'run',
      target_ref: 'step:build',
      requested_by: 'agent-alpha',
      status: 'approved',
      approved_by: 'local@thredos',
      notes: 'Approved',
      binding_status: 'exact',
      authoritative_for_execution: true,
    })

    const traceRes = await (await import('@/app/api/traces/route')).GET(
      new Request(`http://localhost/api/traces?runId=${runId}`),
    )
    expect(traceRes.status).toBe(200)
    const traceBody = await traceRes.json()
    expect(traceBody.events).toHaveLength(2)
    expect(traceBody.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'approval-requested',
      'approval-resolved',
    ])
    expect(traceBody.events[0]).toMatchObject({
      run_id: runId,
      surface_id: 'step:build',
      actor: 'api:approvals',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })
  })

  test('resolve fails closed when caller tries to change exact binding or target fields', async () => {
    const { POST } = await import('@/app/api/approvals/route')
    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId: 'run-approvals-mismatch',
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      }),
    }))
    const requestBody = await requestRes.json()

    const resolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId: 'run-approvals-mismatch',
        approval_id: requestBody.approval.id,
        status: 'approved',
        target_ref: 'step:other',
      }),
    }))

    expect(resolveRes.status).toBe(409)
    await expect(resolveRes.json()).resolves.toMatchObject({
      code: 'APPROVAL_BINDING_MISMATCH',
    })
  })

  test('duplicate and expired resolves fail closed', async () => {
    const { POST } = await import('@/app/api/approvals/route')

    const duplicateRequestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId: 'run-approvals-duplicate',
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      }),
    }))
    const duplicateRequestBody = await duplicateRequestRes.json()

    const firstResolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId: 'run-approvals-duplicate',
        approval_id: duplicateRequestBody.approval.id,
        status: 'approved',
      }),
    }))
    expect(firstResolveRes.status).toBe(200)

    const duplicateResolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId: 'run-approvals-duplicate',
        approval_id: duplicateRequestBody.approval.id,
        status: 'approved',
      }),
    }))
    expect(duplicateResolveRes.status).toBe(409)
    await expect(duplicateResolveRes.json()).resolves.toMatchObject({
      code: 'APPROVAL_ALREADY_RESOLVED',
    })

    const expiredRequestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId: 'run-approvals-expired',
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        expires_at: '2026-08-27T00:00:00.000Z',
      }),
    }))
    const expiredRequestBody = await expiredRequestRes.json()

    const expiredResolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId: 'run-approvals-expired',
        approval_id: expiredRequestBody.approval.id,
        status: 'approved',
      }),
    }))
    expect(expiredResolveRes.status).toBe(409)
    await expect(expiredResolveRes.json()).resolves.toMatchObject({
      code: 'APPROVAL_EXPIRED',
    })
  })

  test('resolve returns committed approval plus warning when trace persistence fails after commit', async () => {
    const { POST } = await import('@/app/api/approvals/route')
    const runId = 'run-approvals-trace-failure'

    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      }),
    }))
    const requestBody = await requestRes.json()

    setApprovalTraceAppenderForTests(async () => {
      throw new Error('trace append failed')
    })

    const resolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId,
        approval_id: requestBody.approval.id,
        status: 'approved',
      }),
    }))

    expect(resolveRes.status).toBe(200)
    const resolveBody = await resolveRes.json()
    expect(resolveBody).toMatchObject({
      commit_status: 'committed',
      trace_status: 'failed',
      warning_code: 'APPROVAL_TRACE_PERSIST_FAILED',
      warning: 'Approval committed, but approval trace projection persistence failed.',
    })
    expect(resolveBody.warning).not.toContain('trace append failed')
    expect(resolveBody.approval).toMatchObject({
      id: requestBody.approval.id,
      status: 'approved',
      approved_by: 'local@thredos',
    })

    const approvals = await readApprovals(tmpDir, runId)
    expect(approvals.map(approval => approval.status)).toEqual(['pending', 'approved'])
    const traces = await readTraceEvents(tmpDir, runId)
    expect(traces.map(trace => trace.event_type)).toEqual(['approval-requested'])
  })

  test('concurrent resolve requests have exactly one winner and persist one terminal approval record', async () => {
    const { POST } = await import('@/app/api/approvals/route')
    const runId = 'run-approvals-concurrent'

    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'run',
        target_ref: 'step:build',
        requested_by: 'agent-alpha',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      }),
    }))
    const requestBody = await requestRes.json()

    const [firstResolveRes, secondResolveRes] = await Promise.all([
      POST(new Request('http://localhost/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          runId,
          approval_id: requestBody.approval.id,
          status: 'approved',
        }),
      })),
      POST(new Request('http://localhost/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          runId,
          approval_id: requestBody.approval.id,
          status: 'approved',
        }),
      })),
    ])

    const statuses = [firstResolveRes.status, secondResolveRes.status].sort((left, right) => left - right)
    expect(statuses).toEqual([200, 409])
    const conflictResponse = firstResolveRes.status === 409 ? firstResolveRes : secondResolveRes
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'APPROVAL_ALREADY_RESOLVED',
    })

    const approvals = await readApprovals(tmpDir, runId)
    expect(approvals).toHaveLength(2)
    expect(approvals.filter(approval => approval.id === requestBody.approval.id)).toHaveLength(2)
    expect(approvals.filter(approval => approval.status === 'approved')).toHaveLength(1)
  })

  test('legacy reveal approvals remain compatible but project as unbound and non-authoritative', async () => {
    const { GET, POST } = await import('@/app/api/approvals/route')
    const runId = 'run-approvals-reveal'

    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'reveal',
        target_ref: 'surface/shared',
        requested_by: 'agent-alpha',
      }),
    }))
    const requestBody = await requestRes.json()

    const resolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId,
        approval_id: requestBody.approval.id,
        status: 'approved',
        approved_by: 'ignored-reviewer',
      }),
    }))

    expect(resolveRes.status).toBe(200)
    const listRes = await GET(new Request(`http://localhost/api/approvals?runId=${runId}`))
    const listBody = await listRes.json()
    expect(listBody.approvals).toEqual([
      expect.objectContaining({
        id: requestBody.approval.id,
        action_type: 'reveal',
        binding_status: 'unbound',
        authoritative_for_execution: false,
        approved_by: 'local@thredos',
      }),
    ])
  })

  test('GET returns 400 when runId is missing', async () => {
    const { GET } = await import('@/app/api/approvals/route')
    const res = await GET(new Request('http://localhost/api/approvals'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: 'MISSING_PARAM',
      error: 'runId required',
    })
  })

  test('rejects unsafe run IDs before repository access', async () => {
    const { GET, POST } = await import('@/app/api/approvals/route')
    const getRes = await GET(new Request('http://localhost/api/approvals?runId=..%2Fescape'))
    expect(getRes.status).toBe(400)

    const postRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', runId: '../escape', target_ref: 'step-a' }),
    }))
    expect(postRes.status).toBe(400)
  })
})
