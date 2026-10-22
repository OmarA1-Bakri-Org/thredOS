import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { RuntimeRepositoryError } from '@/lib/runtime/run-repository'

describe.serial('Change Set API routes', () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const summary = { schema_version: 1, id: 'change-set-attempt-1', revision: 0,
    workflow_run_id: 'run-1', attempt_id: 'attempt-1', status: 'captured' }

  beforeEach(() => {
    calls.length = 0
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      listChangeSets: async (...args: unknown[]) => { calls.push({ method: 'list', args }); return [summary] },
      inspectChangeSet: async (...args: unknown[]) => { calls.push({ method: 'inspect', args }); return { schema_version: 1, summary, entries: [] } },
      inspectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'inspectById', args }); return { schema_version: 1, summary, entries: [] } },
      compareChangeSets: async (...args: unknown[]) => { calls.push({ method: 'compare', args }); return { schema_version: 1, paths: [] } },
      selectChangeSet: async (...args: unknown[]) => { calls.push({ method: 'select', args }); return { ...summary, status: 'selected', revision: 1 } },
      rejectChangeSet: async (...args: unknown[]) => { calls.push({ method: 'reject', args }); return { ...summary, status: 'rejected', revision: 1 } },
      selectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'selectById', args }); return { ...summary, status: 'selected', revision: 1 } },
      rejectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'rejectById', args }); return { ...summary, status: 'rejected', revision: 1 } },
    } as unknown as RuntimeServicePort
  })
  afterEach(() => { delete globalThis.__THREADOS_RUNTIME_SERVICE__ })

  test('list, review and compare delegate to the same runtime service', async () => {
    const { GET: list } = await import('@/app/api/change-sets/route')
    const listed = await list(new Request('http://localhost/api/change-sets?run_id=run-1'))
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({ schema_version: 1, change_sets: [summary] })
    const { GET: detail } = await import('@/app/api/change-sets/[changeSetId]/route')
    const inspected = await detail(new Request('http://localhost/api/change-sets/change-set-attempt-1'), {
      params: Promise.resolve({ changeSetId: 'change-set-attempt-1' }),
    })
    expect(inspected.status).toBe(200)
    const { GET: compare } = await import('@/app/api/change-sets/compare/route')
    const compared = await compare(new Request('http://localhost/api/change-sets/compare?run_id=run-1&left_attempt_id=attempt-1&right_attempt_id=attempt-2'))
    expect(compared.status).toBe(200)
    expect(calls).toEqual([
      { method: 'list', args: ['run-1'] },
      { method: 'inspectById', args: ['change-set-attempt-1'] },
      { method: 'compare', args: ['run-1', 'attempt-1', 'attempt-2'] },
    ])
  })

  test('select and reject pass the exact ID, revision, actor context, and rejection reason', async () => {
    const { POST: select } = await import('@/app/api/change-sets/[changeSetId]/select/route')
    const selected = await select(new Request('http://localhost/api/change-sets/change-set-attempt-1/select', {
      method: 'POST', headers: { 'idempotency-key': 'select-1', 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: 'run-1', attempt_id: 'attempt-1', expected_revision: 0 }),
    }), { params: Promise.resolve({ changeSetId: 'change-set-attempt-1' }) })
    expect(selected.status).toBe(200)
    expect(selected.headers.get('Idempotency-Key')).toBe('select-1')
    const { POST: reject } = await import('@/app/api/change-sets/[changeSetId]/reject/route')
    const rejected = await reject(new Request('http://localhost/api/change-sets/change-set-attempt-1/reject', {
      method: 'POST', headers: { 'idempotency-key': 'reject-1', 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: 'run-1', attempt_id: 'attempt-1', expected_revision: 1, reason: 'Candidate was incomplete' }),
    }), { params: Promise.resolve({ changeSetId: 'change-set-attempt-1' }) })
    expect(rejected.status).toBe(200)
    expect(calls.map(call => call.method)).toEqual(['select', 'reject'])
    expect(calls[0]?.args[0]).toEqual({ runId: 'run-1', attemptId: 'attempt-1', changeSetId: 'change-set-attempt-1', expectedRevision: 0 })
    expect(calls[0]?.args[1]).toMatchObject({ interface: 'api', idempotencyKey: 'select-1' })
    expect(calls[1]?.args[0]).toMatchObject({ reason: 'Candidate was incomplete', expectedRevision: 1 })
  })

  test('invalid input and revision conflicts return stable API errors', async () => {
    const { POST: select } = await import('@/app/api/change-sets/[changeSetId]/select/route')
    const params = { params: Promise.resolve({ changeSetId: 'change-set-attempt-1' }) }
    const invalid = await select(new Request('http://localhost/api/change-sets/change-set-attempt-1/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: 'run-1', attempt_id: 'attempt-1', expected_revision: -1 }),
    }), params)
    expect(invalid.status).toBe(400)
    expect(calls).toHaveLength(0)
    globalThis.__THREADOS_RUNTIME_SERVICE__!.selectChangeSet = async () => {
      throw new RuntimeRepositoryError('CHANGE_SET_REVISION_CONFLICT', 'Change Set revision changed')
    }
    const conflict = await select(new Request('http://localhost/api/change-sets/change-set-attempt-1/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: 'run-1', attempt_id: 'attempt-1', expected_revision: 0 }),
    }), params)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'CHANGE_SET_REVISION_CONFLICT' })
  })

  test('ID-only mutation bodies delegate through the same service', async () => {
    const { POST: select } = await import('@/app/api/change-sets/[changeSetId]/select/route')
    const { POST: reject } = await import('@/app/api/change-sets/[changeSetId]/reject/route')
    const params = { params: Promise.resolve({ changeSetId: 'change-set-attempt-1' }) }
    const selected = await select(new Request('http://localhost/api/change-sets/change-set-attempt-1/select', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_revision: 0 }),
    }), params)
    const rejected = await reject(new Request('http://localhost/api/change-sets/change-set-attempt-1/reject', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: 1, reason: 'No longer wanted' }),
    }), params)
    expect([selected.status, rejected.status]).toEqual([200, 200])
    expect(calls.map(call => call.method)).toEqual(['selectById', 'rejectById'])
    expect(calls[0]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1', expectedRevision: 0 })
    expect(calls[1]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1', expectedRevision: 1,
      reason: 'No longer wanted' })
  })
})
