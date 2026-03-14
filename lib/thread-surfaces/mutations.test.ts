import { describe, expect, test } from 'bun:test'
import type { RunEvent, RunScope, ThreadSurface } from './types'
import type { ThreadSurfaceState } from './repository'
import {
  cancelRun,
  completeRun,
  createChildThreadSurfaceRun,
  createReplacementRun,
  createRootThreadSurfaceRun,
  emptyThreadSurfaceState,
  findLatestActiveRunForSurface,
  findLatestRunForSurface,
  recordChildAgentSpawnEvent,
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
    sequenceRef: null,
    spawnedByAgentId: null,
  }

  const rootRun: RunScope = {
    id: 'run-root-001',
    threadSurfaceId: 'thread-root',
    runStatus: 'successful',
    startedAt: timestamp,
    endedAt: '2026-03-09T10:05:00.000Z',
    executionIndex: 1,
    parentRunId: null,
    childIndex: null,
  }

  return {
    version: 1,
    threadSurfaces: [rootSurface],
    runs: [rootRun],
    mergeEvents: [],
    runEvents: [],
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
      sequenceRef: null,
      spawnedByAgentId: null,
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
      sequenceRef: null,
      spawnedByAgentId: null,
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
      parentRunId: null,
      childIndex: null,
    })
    expect(result.run).toMatchObject({
      id: 'run-root-002',
      threadSurfaceId: 'thread-root',
      runStatus: 'running',
      endedAt: null,
      executionIndex: 3,
      parentRunId: null,
      childIndex: null,
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
      sourceRunIds: ['run-review-001'],
      mergeKind: 'single',
      executionIndex: 10,
      createdAt: timestamp,
      summary: 'Review merged into root',
    })

    expect(merged.mergeEvent).toMatchObject({
      id: 'merge-001',
      destinationThreadSurfaceId: 'thread-root',
      sourceThreadSurfaceIds: ['thread-review'],
      sourceRunIds: ['run-review-001'],
      mergeKind: 'single',
    })
    expect(() =>
      recordMergeEvent(stateWithChild, {
        mergeId: 'merge-bad',
        runId: 'run-root-001',
        destinationThreadSurfaceId: 'thread-missing',
        sourceThreadSurfaceIds: ['thread-review'],
        sourceRunIds: ['run-review-001'],
        mergeKind: 'single',
        executionIndex: 11,
        createdAt: timestamp,
      }),
    ).toThrow('destination lane')
    expect(() =>
      recordMergeEvent(stateWithChild, {
        mergeId: 'merge-bad-run',
        runId: 'run-root-001',
        destinationThreadSurfaceId: 'thread-root',
        sourceThreadSurfaceIds: ['thread-review'],
        sourceRunIds: ['run-root-001'],
        mergeKind: 'single',
        executionIndex: 12,
        createdAt: timestamp,
      }),
    ).toThrow('source run')
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
          parentRunId: null,
          childIndex: null,
        },
      ],
      mergeEvents: [],
      runEvents: [],
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

  test('recordChildAgentSpawnEvent appends a child-agent-spawned run event for existing surfaces', () => {
    const stateWithChild = createChildThreadSurfaceRun(buildRootState(), {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-worker',
      childSurfaceId: 'thread-worker',
      childSurfaceLabel: 'Worker thread',
      createdAt: timestamp,
      runId: 'run-worker-001',
      startedAt: timestamp,
      executionIndex: 2,
    }).state

    const result = recordChildAgentSpawnEvent(stateWithChild, {
      eventId: 'event-001',
      runId: 'run-root-001',
      threadSurfaceId: 'thread-root',
      childThreadSurfaceId: 'thread-worker',
      parentThreadSurfaceId: 'thread-root',
      createdAt: timestamp,
    })

    expect(result.runEvent).toEqual<RunEvent>({
      id: 'event-001',
      runId: 'run-root-001',
      eventType: 'child-agent-spawned',
      createdAt: timestamp,
      threadSurfaceId: 'thread-root',
      payload: {
        childThreadSurfaceId: 'thread-worker',
        parentThreadSurfaceId: 'thread-root',
      },
    })
    expect(result.state.runEvents).toEqual([result.runEvent])
  })

  test('completeRun sets status to successful with endedAt timestamp', () => {
    const state: ThreadSurfaceState = {
      version: 1,
      threadSurfaces: buildRootState().threadSurfaces,
      runs: [
        {
          id: 'run-active',
          threadSurfaceId: 'thread-root',
          runStatus: 'running',
          startedAt: timestamp,
          endedAt: null,
          executionIndex: 1,
          parentRunId: null,
          childIndex: null,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    }

    const result = completeRun(state, {
      runId: 'run-active',
      runStatus: 'successful',
      endedAt: '2026-03-09T10:30:00.000Z',
      runSummary: 'Completed without errors',
    })

    expect(result.run).toMatchObject({
      id: 'run-active',
      runStatus: 'successful',
      endedAt: '2026-03-09T10:30:00.000Z',
      runSummary: 'Completed without errors',
      parentRunId: null,
      childIndex: null,
    })
    expect(result.state.runs).toHaveLength(1)
  })

  test('completeRun sets status to failed without optional runSummary', () => {
    const state: ThreadSurfaceState = {
      version: 1,
      threadSurfaces: buildRootState().threadSurfaces,
      runs: [
        {
          id: 'run-failing',
          threadSurfaceId: 'thread-root',
          runStatus: 'running',
          startedAt: timestamp,
          endedAt: null,
          parentRunId: null,
          childIndex: null,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    }

    const result = completeRun(state, {
      runId: 'run-failing',
      runStatus: 'failed',
      endedAt: '2026-03-09T10:45:00.000Z',
    })

    expect(result.run).toMatchObject({
      id: 'run-failing',
      runStatus: 'failed',
      endedAt: '2026-03-09T10:45:00.000Z',
      parentRunId: null,
      childIndex: null,
    })
    expect(result.run.runSummary).toBeUndefined()
  })

  test('completeRun throws when run ID does not exist', () => {
    expect(() =>
      completeRun(buildRootState(), {
        runId: 'run-nonexistent',
        runStatus: 'successful',
        endedAt: '2026-03-09T10:30:00.000Z',
      }),
    ).toThrow('run-nonexistent')
  })
})

describe('run query helpers', () => {
  const runs: RunScope[] = [
    {
      id: 'run-old',
      threadSurfaceId: 'thread-root',
      runStatus: 'successful',
      startedAt: '2026-03-09T08:00:00.000Z',
      endedAt: '2026-03-09T08:30:00.000Z',
      parentRunId: null,
      childIndex: null,
    },
    {
      id: 'run-mid',
      threadSurfaceId: 'thread-root',
      runStatus: 'failed',
      startedAt: '2026-03-09T09:00:00.000Z',
      endedAt: '2026-03-09T09:30:00.000Z',
      parentRunId: null,
      childIndex: null,
    },
    {
      id: 'run-active',
      threadSurfaceId: 'thread-root',
      runStatus: 'running',
      startedAt: '2026-03-09T10:00:00.000Z',
      endedAt: null,
      parentRunId: null,
      childIndex: null,
    },
    {
      id: 'run-other-surface',
      threadSurfaceId: 'thread-child',
      runStatus: 'pending',
      startedAt: '2026-03-09T11:00:00.000Z',
      endedAt: null,
      parentRunId: null,
      childIndex: null,
    },
  ]

  test('findLatestRunForSurface returns the most recent run by timestamp', () => {
    const latest = findLatestRunForSurface(runs, 'thread-root')
    expect(latest).toBeDefined()
    expect(latest!.id).toBe('run-active')
  })

  test('findLatestRunForSurface returns undefined for unknown surface', () => {
    const result = findLatestRunForSurface(runs, 'thread-nonexistent')
    expect(result).toBeUndefined()
  })

  test('findLatestRunForSurface returns undefined for empty runs array', () => {
    const result = findLatestRunForSurface([], 'thread-root')
    expect(result).toBeUndefined()
  })

  test('findLatestActiveRunForSurface returns only pending or running runs', () => {
    const active = findLatestActiveRunForSurface(runs, 'thread-root')
    expect(active).toBeDefined()
    expect(active!.id).toBe('run-active')
    expect(active!.runStatus).toBe('running')
  })

  test('findLatestActiveRunForSurface returns pending run for child surface', () => {
    const active = findLatestActiveRunForSurface(runs, 'thread-child')
    expect(active).toBeDefined()
    expect(active!.id).toBe('run-other-surface')
    expect(active!.runStatus).toBe('pending')
  })

  test('findLatestActiveRunForSurface returns undefined when no active runs exist', () => {
    const completedRuns: RunScope[] = [
      {
        id: 'run-done',
        threadSurfaceId: 'thread-root',
        runStatus: 'successful',
        startedAt: '2026-03-09T08:00:00.000Z',
        endedAt: '2026-03-09T08:30:00.000Z',
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-cancelled',
        threadSurfaceId: 'thread-root',
        runStatus: 'cancelled',
        startedAt: '2026-03-09T09:00:00.000Z',
        endedAt: '2026-03-09T09:30:00.000Z',
        parentRunId: null,
        childIndex: null,
      },
    ]
    const result = findLatestActiveRunForSurface(completedRuns, 'thread-root')
    expect(result).toBeUndefined()
  })

  test('findLatestActiveRunForSurface returns undefined for unknown surface', () => {
    const result = findLatestActiveRunForSurface(runs, 'thread-nonexistent')
    expect(result).toBeUndefined()
  })
})
