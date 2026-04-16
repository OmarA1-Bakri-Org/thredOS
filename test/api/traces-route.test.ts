import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { appendTraceEvent } from '@/lib/traces/writer'

let tmpDir: string

describe.serial('traces API route', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
    process.env.THREADOS_BASE_PATH = tmpDir
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await cleanTempDir(tmpDir)
  })

  test('GET returns persisted trace events in append order', async () => {
    const { GET } = await import('@/app/api/traces/route')
    const runId = 'run-traces-route'

    await appendTraceEvent(tmpDir, runId, {
      ts: '2026-03-28T10:00:00.000Z',
      run_id: runId,
      surface_id: 'surface-a',
      actor: 'threados',
      event_type: 'step-started',
      payload_ref: null,
      policy_ref: null,
    })

    await appendTraceEvent(tmpDir, runId, {
      ts: '2026-03-28T10:01:00.000Z',
      run_id: runId,
      surface_id: 'surface-a',
      actor: 'threados',
      event_type: 'step-completed',
      payload_ref: 'artifacts/output.json',
      policy_ref: null,
    })

    const res = await GET(new Request(`http://localhost/api/traces?runId=${runId}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(2)
    expect(body.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'step-started',
      'step-completed',
    ])
    expect(body.events[1]).toMatchObject({
      payload_ref: 'artifacts/output.json',
      policy_ref: null,
    })
  })

  test('GET returns 400 when runId is missing', async () => {
    const { GET } = await import('@/app/api/traces/route')
    const res = await GET(new Request('http://localhost/api/traces'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: 'MISSING_PARAM',
      error: 'runId query parameter required',
    })
  })
})
