import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchChangeSetComparison,
  fetchChangeSetReview,
  fetchChangeSets,
  postChangeSetDecision,
  RuntimeApiError,
} from './api'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('Change Set UI client', () => {
  test('lists, inspects, compares, and records an exact revision without calling apply', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      const payload = String(input).endsWith('/select') || String(input).endsWith('/reject')
        ? { schema_version: 1, change_set: { id: 'change-1', revision: 3, status: 'selected' } }
        : String(input).includes('/compare?') ? { schema_version: 1, paths: [] }
          : String(input).includes('?run_id=') ? { schema_version: 1, change_sets: [{ id: 'change-1' }] }
            : { schema_version: 1, summary: { id: 'change-1' }, entries: [] }
      return Response.json(payload)
    }, { preconnect: originalFetch.preconnect })
    expect((await fetchChangeSets('run with space'))[0]?.id).toBe('change-1')
    expect((await fetchChangeSetReview('change/1')).summary.id).toBe('change-1')
    await fetchChangeSetComparison('run-1', 'attempt-1', 'attempt-2')
    await postChangeSetDecision('change-1', { action: 'select', expectedRevision: 2 })
    await postChangeSetDecision('change-1', { action: 'reject', expectedRevision: 2, reason: '  incomplete  ' })
    expect(requests.map(request => request.url)).toEqual([
      '/api/change-sets?run_id=run%20with%20space',
      '/api/change-sets/change%2F1',
      '/api/change-sets/compare?run_id=run-1&left_attempt_id=attempt-1&right_attempt_id=attempt-2',
      '/api/change-sets/change-1/select',
      '/api/change-sets/change-1/reject',
    ])
    expect(JSON.parse(requests[3]!.init!.body as string)).toEqual({ expected_revision: 2 })
    expect(JSON.parse(requests[4]!.init!.body as string)).toEqual({ expected_revision: 2, reason: 'incomplete' })
    expect(requests.every(request => !request.url.includes('/apply'))).toBe(true)
  })

  test('preserves stable revision-conflict errors', async () => {
    globalThis.fetch = Object.assign(async () => Response.json(
      { code: 'CHANGE_SET_REVISION_CONFLICT', error: 'Changed since inspection' },
      { status: 409 },
    ), { preconnect: originalFetch.preconnect })
    await expect(postChangeSetDecision('change-1', { action: 'select', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CHANGE_SET_REVISION_CONFLICT', status: 409 })
    expect(RuntimeApiError.name).toBe('RuntimeApiError')
  })
})
