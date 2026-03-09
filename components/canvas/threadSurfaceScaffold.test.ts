import { describe, expect, test } from 'bun:test'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import {
  hasResolvedThreadSurfaceApiData,
  resolveThreadSurfaceCanvasData,
} from './threadSurfaceScaffold'

const status: SequenceStatus = {
  name: 'Sequence Scaffold',
  version: '1.0',
  steps: [],
  gates: [],
  summary: {
    total: 3,
    ready: 1,
    running: 1,
    done: 1,
    failed: 0,
    blocked: 0,
    needsReview: 0,
  },
}

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

const mergeEvents: MergeEvent[] = []

describe('thread surface scaffold resolution', () => {
  test('does not treat partial backend payloads as resolved api data', () => {
    expect(hasResolvedThreadSurfaceApiData(undefined, runs, mergeEvents)).toBeFalse()
    expect(hasResolvedThreadSurfaceApiData(threadSurfaces, undefined, mergeEvents)).toBeFalse()
    expect(hasResolvedThreadSurfaceApiData(threadSurfaces, runs, undefined)).toBeFalse()

    const result = resolveThreadSurfaceCanvasData({
      status,
      runs,
      mergeEvents,
    })

    expect(result.source).toBe('status-scaffold')
    expect(result.threadSurfaces).toHaveLength(1)
    expect(result.threadSurfaces[0]?.surfaceLabel).toBe('Sequence Scaffold')
  })

  test('uses api data only after all backend collections resolve together', () => {
    const result = resolveThreadSurfaceCanvasData({
      status,
      threadSurfaces,
      runs,
      mergeEvents,
    })

    expect(result.source).toBe('api')
    expect(result.threadSurfaces).toEqual(threadSurfaces)
    expect(result.runs).toEqual(runs)
  })
})
