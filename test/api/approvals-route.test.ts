import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'

let tmpDir: string

describe.serial('approvals API route', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
    process.env.THREADOS_BASE_PATH = tmpDir
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await cleanTempDir(tmpDir)
  })

  test('POST request and resolve persist approvals, then GET returns the folded current approval state', async () => {
    const { GET, POST } = await import('@/app/api/approvals/route')
    const runId = 'run-approvals-route'

    const requestRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        runId,
        action_type: 'reveal',
        target_ref: 'surface/shared',
        requested_by: 'agent-alpha',
        notes: 'Needs review',
      }),
    }))

    expect(requestRes.status).toBe(200)
    const requestBody = await requestRes.json()
    expect(requestBody.approval).toMatchObject({
      action_type: 'reveal',
      target_ref: 'surface/shared',
      requested_by: 'agent-alpha',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: 'Needs review',
    })

    const resolveRes = await POST(new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve',
        runId,
        approval_id: requestBody.approval.id,
        action_type: 'reveal',
        target_ref: 'surface/shared',
        requested_by: 'agent-alpha',
        approved_by: 'human-reviewer',
        status: 'approved',
        notes: 'Approved',
      }),
    }))

    expect(resolveRes.status).toBe(200)
    const resolveBody = await resolveRes.json()
    expect(resolveBody.approval).toMatchObject({
      id: requestBody.approval.id,
      action_type: 'reveal',
      target_ref: 'surface/shared',
      requested_by: 'agent-alpha',
      status: 'approved',
      approved_by: 'human-reviewer',
      notes: 'Approved',
    })
    expect(resolveBody.approval.approved_at).toBeTruthy()

    const listRes = await GET(new Request(`http://localhost/api/approvals?runId=${runId}`))
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.approvals).toHaveLength(1)
    expect(listBody.approvals[0]).toMatchObject({
      id: requestBody.approval.id,
      action_type: 'reveal',
      target_ref: 'surface/shared',
      requested_by: 'agent-alpha',
      status: 'approved',
      approved_by: 'human-reviewer',
      notes: 'Approved',
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
      surface_id: 'surface/shared',
      actor: 'api:approvals',
    })
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
})
