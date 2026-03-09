import { describe, expect, test } from 'bun:test'
import type { RunScope, ThreadSurface } from './types'
import type { ThreadSurfaceState } from './repository'
import {
  cancelRun,
  createChildThreadSurfaceRun,
  createReplacementRun,
  createRootThreadSurfaceRun,
  emptyThreadSurfaceState,
  recordMergeEvent,
} from './mutations'

const timestamp = '2026-03-09T10:00:00.000Z'

function buildRootState(): ThreadSurfaceState {
  const rootSurface: ThreadSurface = {
    id: 'thread-root',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master thread',
    createdAt: timestamp,
    childSurfaceIds: [],
  }

  const rootRun: RunScope = {
    id: 'run-root-001',
    threadSurfaceId: 'thread-root',
    runStatus: 'successful',
    startedAt: timestamp,
    endedAt: '2026-03-09T10:05:00.000Z',
    executionIndex: 1,
  }

  return {
    version: 1,
    threadSurfaces: [rootSurface],
    runs: [rootRun],
    mergeEvents: [],
  }
}

describe('thread surface lifecycle mutations', () => {
  test('createRootThreadSurfaceRun creates the root surface and its first run', () => {
    const result = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Master thread',
      createdAt: timestamp,
      runId: 'run-root-001',
      startedAt: timestamp,
      executionIndex: 1,
    })

    expect(result.threadSurface).toMatchObject({
      id: 'thread-root',
      parentSurfaceId: null,
      depth: 0,
      surfaceLabel: 'Master thread',
      childSurfaceIds: [],
    })
    expect(result.run).toMatchObject({
      id: 'run-root-001',
      threadSurfaceId: 'thread-root',
      runStatus: 'running',
      endedAt: null,
      executionIndex: 1,
    })
    expect(result.state.threadSurfaces).toHaveLength(1)
    expect(result.state.runs).toHaveLength(1)
  })

  test('createChildThreadSurfaceRun creates a child surface when a child agent appears', () => {
    const result = createChildThreadSurfaceRun(buildRootState(), {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-research',
      childSurfaceId: 'thread-research',
      childSurfaceLabel: 'Research thread',
      createdAt: timestamp,
      runId: 'run-research-001',
      startedAt: timestamp,
      executionIndex: 2,
    })

    expect(result.childSurface).toMatchObject({
      id: 'thread-research',
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-research',
      depth: 1,
      childSurfaceIds: [],
    })
    expect(result.childRun).toMatchObject({
      id: 'run-research-001',
      threadSurfaceId: 'thread-research',
      runStatus: 'running',
      executionIndex: 2,
    })
    expect(result.state.threadSurfaces.find(surface => surface.id === 'thread-root')?.childSurfaceIds).toEqual(['thread-research'])
  })

  test('createReplacementRun appends a new run scope instead of mutating an old run', () => {
    const originalState = buildRootState()

    const result = createReplacementRun(originalState, {
      threadSurfaceId: 'thread-root',
      runId: 'run-root-002',
      startedAt: '2026-03-09T11:00:00.000Z',
      executionIndex: 3,
    })

    expect(result.replacedRun).toMatchObject({
      id: 'run-root-001',
      runStatus: 'successful',
      endedAt: '2026-03-09T10:05:00.000Z',
    })
    expect(result.run).toMatchObject({
      id: 'run-root-002',
      threadSurfaceId: 'thread-root',
      runStatus: 'running',
      endedAt: null,
      executionIndex: 3,
    })
    expect(result.state.runs.map(run => run.id)).toEqual(['run-root-001', 'run-root-002'])
  })

  test('recordMergeEvent records merges only against existing destination lanes', () => {
    const stateWithChild = createChildThreadSurfaceRun(buildRootState(), {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-review',
      childSurfaceId: 'thread-review',
      childSurfaceLabel: 'Review thread',
      createdAt: timestamp,
      runId: 'run-review-001',
      startedAt: timestamp,
      executionIndex: 2,
    }).state

    const merged = recordMergeEvent(stateWithChild, {
      mergeId: 'merge-001',
      runId: 'run-root-001',
      destinationThreadSurfaceId: 'thread-root',
      sourceThreadSurfaceIds: ['thread-review'],
      mergeKind: 'single',
      executionIndex: 10,
      createdAt: timestamp,
      summary: 'Review merged into root',
    })

    expect(merged.mergeEvent).toMatchObject({
      id: 'merge-001',
      destinationThreadSurfaceId: 'thread-root',
      sourceThreadSurfaceIds: ['thread-review'],
      mergeKind: 'single',
    })
    expect(() =>
      recordMergeEvent(stateWithChild, {
        mergeId: 'merge-bad',
        runId: 'run-root-001',
        destinationThreadSurfaceId: 'thread-missing',
        sourceThreadSurfaceIds: ['thread-review'],
        mergeKind: 'single',
        executionIndex: 11,
        createdAt: timestamp,
      }),
    ).toThrow('destination lane')
  })

  test('cancelRun marks the run cancelled without turning it into a restart', () => {
    const state: ThreadSurfaceState = {
      version: 1,
      threadSurfaces: buildRootState().threadSurfaces,
      runs: [
        {
          id: 'run-root-active',
          threadSurfaceId: 'thread-root',
          runStatus: 'running',
          startedAt: timestamp,
          endedAt: null,
          executionIndex: 4,
        },
      ],
      mergeEvents: [],
    }

    const result = cancelRun(state, {
      runId: 'run-root-active',
      endedAt: '2026-03-09T10:10:00.000Z',
    })

    expect(result.run).toMatchObject({
      id: 'run-root-active',
      runStatus: 'cancelled',
      endedAt: '2026-03-09T10:10:00.000Z',
    })
    expect(result.state.runs).toHaveLength(1)
  })
})
