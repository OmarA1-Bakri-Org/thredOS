import { describe, expect, test } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import {
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
