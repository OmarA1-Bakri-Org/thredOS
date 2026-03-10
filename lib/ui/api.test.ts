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
})
