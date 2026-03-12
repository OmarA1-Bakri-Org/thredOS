import { describe, expect, test, afterEach } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import {
  fetchJson,
  postJson,
  unwrapThreadMergesResponse,
  unwrapThreadRunsResponse,
  unwrapThreadSurfacesResponse,
} from './api'

describe('thread surface api response unwrappers', () => {
  test('unwrapThreadSurfacesResponse returns the surface list from the route payload', () => {
    const threadSurfaces: ThreadSurface[] = [
      {
        id: 'thread-master',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Master',
        createdAt: '2026-03-09T00:00:00.000Z',
        childSurfaceIds: [],
      },
    ]

    expect(unwrapThreadSurfacesResponse({ threadSurfaces })).toEqual(threadSurfaces)
  })

  test('unwrapThreadRunsResponse returns the run list from the route payload', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 1,
      },
    ]

    expect(unwrapThreadRunsResponse({ runs })).toEqual(runs)
  })

  test('unwrapThreadMergesResponse returns the merge list from the route payload', () => {
    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-1',
        runId: 'run-master',
        destinationThreadSurfaceId: 'thread-master',
        sourceThreadSurfaceIds: ['thread-review'],
        mergeKind: 'single',
        executionIndex: 2,
        createdAt: '2026-03-09T00:01:00.000Z',
      },
    ]

    expect(unwrapThreadMergesResponse({ mergeEvents })).toEqual(mergeEvents)
  })

  // ── Edge cases: empty arrays ──────────────────────────────────────

  test('unwrapThreadSurfacesResponse returns empty array when payload has no surfaces', () => {
    expect(unwrapThreadSurfacesResponse({ threadSurfaces: [] })).toEqual([])
  })

  test('unwrapThreadRunsResponse returns empty array when payload has no runs', () => {
    expect(unwrapThreadRunsResponse({ runs: [] })).toEqual([])
  })

  test('unwrapThreadMergesResponse returns empty array when payload has no merge events', () => {
    expect(unwrapThreadMergesResponse({ mergeEvents: [] })).toEqual([])
  })

  // ── Multiple items ────────────────────────────────────────────────

  test('unwrapThreadSurfacesResponse preserves order and all fields for multiple surfaces', () => {
    const threadSurfaces: ThreadSurface[] = [
      {
        id: 'thread-root',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Root',
        createdAt: '2026-03-09T00:00:00.000Z',
        childSurfaceIds: ['thread-child-a', 'thread-child-b'],
      },
      {
        id: 'thread-child-a',
        parentSurfaceId: 'thread-root',
        parentAgentNodeId: 'agent-node-1',
        depth: 1,
        surfaceLabel: 'Child A',
        surfaceDescription: 'First child surface',
        role: 'researcher',
        createdAt: '2026-03-09T01:00:00.000Z',
        childSurfaceIds: [],
      },
      {
        id: 'thread-child-b',
        parentSurfaceId: 'thread-root',
        parentAgentNodeId: 'agent-node-2',
        depth: 1,
        surfaceLabel: 'Child B',
        createdAt: '2026-03-09T02:00:00.000Z',
        childSurfaceIds: [],
      },
    ]

    const result = unwrapThreadSurfacesResponse({ threadSurfaces })
    expect(result).toHaveLength(3)
    expect(result[0].id).toBe('thread-root')
    expect(result[1].id).toBe('thread-child-a')
    expect(result[1].surfaceDescription).toBe('First child surface')
    expect(result[1].role).toBe('researcher')
    expect(result[2].id).toBe('thread-child-b')
  })

  test('unwrapThreadRunsResponse preserves all run statuses and optional fields', () => {
    const runs: RunScope[] = [
      {
        id: 'run-1',
        threadSurfaceId: 'thread-master',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 1,
      },
      {
        id: 'run-2',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T01:00:00.000Z',
        endedAt: '2026-03-09T02:00:00.000Z',
        executionIndex: 2,
        plannedIndex: 3,
        runSummary: 'Completed analysis',
        runNotes: 'Extra notes',
        runDiscussion: 'Discussion content',
      },
      {
        id: 'run-3',
        threadSurfaceId: 'thread-child',
        runStatus: 'failed',
        startedAt: '2026-03-09T03:00:00.000Z',
        endedAt: '2026-03-09T03:30:00.000Z',
      },
    ]

    const result = unwrapThreadRunsResponse({ runs })
    expect(result).toHaveLength(3)
    expect(result[0].runStatus).toBe('pending')
    expect(result[1].runStatus).toBe('successful')
    expect(result[1].runSummary).toBe('Completed analysis')
    expect(result[1].plannedIndex).toBe(3)
    expect(result[2].runStatus).toBe('failed')
    expect(result[2].endedAt).toBe('2026-03-09T03:30:00.000Z')
  })

  test('unwrapThreadMergesResponse preserves multiple merge events with varied merge kinds', () => {
    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-1',
        runId: 'run-master',
        destinationThreadSurfaceId: 'thread-master',
        sourceThreadSurfaceIds: ['thread-review'],
        mergeKind: 'single',
        executionIndex: 1,
        createdAt: '2026-03-09T00:01:00.000Z',
      },
      {
        id: 'merge-2',
        runId: 'run-master',
        destinationThreadSurfaceId: 'thread-master',
        sourceThreadSurfaceIds: ['thread-research', 'thread-analysis'],
        sourceRunIds: ['run-research', 'run-analysis'],
        mergeKind: 'block',
        executionIndex: 2,
        createdAt: '2026-03-09T00:05:00.000Z',
        summary: 'Merged research and analysis results',
      },
    ]

    const result = unwrapThreadMergesResponse({ mergeEvents })
    expect(result).toHaveLength(2)
    expect(result[0].mergeKind).toBe('single')
    expect(result[0].sourceThreadSurfaceIds).toEqual(['thread-review'])
    expect(result[1].mergeKind).toBe('block')
    expect(result[1].sourceThreadSurfaceIds).toHaveLength(2)
    expect(result[1].sourceRunIds).toEqual(['run-research', 'run-analysis'])
    expect(result[1].summary).toBe('Merged research and analysis results')
  })

  // ── Identity: return value IS the same array reference ────────────

  test('unwrapThreadSurfacesResponse returns the same array reference (no copy)', () => {
    const threadSurfaces: ThreadSurface[] = []
    const result = unwrapThreadSurfacesResponse({ threadSurfaces })
    expect(result).toBe(threadSurfaces)
  })

  test('unwrapThreadRunsResponse returns the same array reference (no copy)', () => {
    const runs: RunScope[] = []
    const result = unwrapThreadRunsResponse({ runs })
    expect(result).toBe(runs)
  })

  test('unwrapThreadMergesResponse returns the same array reference (no copy)', () => {
    const mergeEvents: MergeEvent[] = []
    const result = unwrapThreadMergesResponse({ mergeEvents })
    expect(result).toBe(mergeEvents)
  })
})

// ── fetchJson / postJson ──────────────────────────────────────────────

describe('fetchJson', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns parsed JSON on a successful response', async () => {
    const payload = { id: 1, name: 'test-step' }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ) as unknown as typeof fetch

    const result = await fetchJson<{ id: number; name: string }>('/api/fake')
    expect(result).toEqual(payload)
  })

  test('throws with body.error when response is not ok and body has error field', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Step not found' }), { status: 404, statusText: 'Not Found' })
    ) as unknown as typeof fetch

    await expect(fetchJson('/api/fake')).rejects.toThrow('Step not found')
  })

  test('throws with statusText when response is not ok and body.error is empty', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: '' }), { status: 500, statusText: 'Internal Server Error' })
    ) as unknown as typeof fetch

    await expect(fetchJson('/api/fake')).rejects.toThrow('Internal Server Error')
  })

  test('throws with statusText when response body cannot be parsed as JSON', async () => {
    globalThis.fetch = (async () =>
      new Response('not json', { status: 502, statusText: 'Bad Gateway' })
    ) as unknown as typeof fetch

    await expect(fetchJson('/api/fake')).rejects.toThrow('Bad Gateway')
  })

  test('passes RequestInit through to the underlying fetch call', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchJson('/api/fake', { method: 'DELETE', headers: { 'X-Custom': 'yes' } })
    expect(capturedInit?.method).toBe('DELETE')
    expect((capturedInit?.headers as Record<string, string>)['X-Custom']).toBe('yes')
  })
})

describe('postJson', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sends POST with correct method, content-type, and JSON body', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ created: true }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await postJson<{ created: boolean }>('/api/step', { stepId: 'abc', action: 'add' })

    expect(result).toEqual({ created: true })
    expect(capturedUrl).toBe('/api/step')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(capturedInit?.body).toBe(JSON.stringify({ stepId: 'abc', action: 'add' }))
  })

  test('propagates errors from fetchJson when the server returns an error', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422, statusText: 'Unprocessable Entity' })
    ) as unknown as typeof fetch

    await expect(postJson('/api/step', { bad: true })).rejects.toThrow('Validation failed')
  })
})
