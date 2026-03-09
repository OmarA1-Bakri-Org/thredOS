import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import { createLaneBoardModel } from './useLaneBoard'

const multiThreadState = JSON.parse(
  readFileSync(new URL('../../test/fixtures/thread-surfaces/multi-thread-state.json', import.meta.url), 'utf8'),
) as {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  laneRunIds: string[]
}

const threadSurfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-research', 'thread-outreach', 'thread-synthesis', 'thread-review'],
  },
  {
    id: 'thread-research',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-research',
    depth: 1,
    surfaceLabel: 'Research',
    createdAt: '2026-03-09T00:01:00.000Z',
    childSurfaceIds: [],
  },
  {
    id: 'thread-outreach',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-outreach',
    depth: 1,
    surfaceLabel: 'Outreach',
    createdAt: '2026-03-09T00:02:00.000Z',
    childSurfaceIds: [],
  },
  {
    id: 'thread-synthesis',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-synthesis',
    depth: 1,
    surfaceLabel: 'Synthesis',
    createdAt: '2026-03-09T00:03:00.000Z',
    childSurfaceIds: [],
  },
  {
    id: 'thread-review',
    parentSurfaceId: 'thread-synthesis',
    parentAgentNodeId: 'spawn-review',
    depth: 2,
    surfaceLabel: 'Review',
    createdAt: '2026-03-09T00:04:00.000Z',
    childSurfaceIds: [],
  },
]

describe('createLaneBoardModel', () => {
  test('orders rows by run-scoped executionIndex once execution has begun', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 30,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 10,
      },
      {
        id: 'run-outreach',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:06:00.000Z',
        executionIndex: 20,
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents: [],
      runIds: ['run-master', 'run-research', 'run-outreach'],
      draftSurfaceOrder: ['thread-master', 'thread-outreach', 'thread-research'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-research',
      'thread-outreach',
      'thread-master',
    ])
  })

  test('uses draft surface order before execution indexes exist', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master-draft',
        threadSurfaceId: 'thread-master',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
      },
      {
        id: 'run-research-draft',
        threadSurfaceId: 'thread-research',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: null,
      },
      {
        id: 'run-outreach-draft',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: null,
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents: [],
      runIds: ['run-master-draft', 'run-research-draft', 'run-outreach-draft'],
      draftSurfaceOrder: ['thread-outreach', 'thread-master', 'thread-research'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-outreach',
      'thread-master',
      'thread-research',
    ])
  })

  test('keeps draft rows in explicit draft order when mixed with executed rows', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 30,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 10,
      },
      {
        id: 'run-outreach-draft',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: null,
      },
      {
        id: 'run-review-draft',
        threadSurfaceId: 'thread-review',
        runStatus: 'pending',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents: [],
      runIds: ['run-master', 'run-research', 'run-outreach-draft', 'run-review-draft'],
      draftSurfaceOrder: ['thread-review', 'thread-outreach', 'thread-master', 'thread-research'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-research',
      'thread-master',
      'thread-review',
      'thread-outreach',
    ])
  })

  test('renders merges destination-first followed by sources in merge order and keeps sources terminal', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 40,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:04:00.000Z',
        executionIndex: 12,
      },
      {
        id: 'run-outreach',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 13,
      },
      {
        id: 'run-synthesis',
        threadSurfaceId: 'thread-synthesis',
        runStatus: 'running',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
        executionIndex: 14,
      },
    ]

    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-block',
        runId: 'run-synthesis',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents,
      runIds: ['run-master', 'run-research', 'run-outreach', 'run-synthesis'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-synthesis',
      'thread-research',
      'thread-outreach',
      'thread-master',
    ])
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-research')).toMatchObject({
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
      isMergeSource: true,
    })
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-outreach')).toMatchObject({
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
      isMergeSource: true,
    })
    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
      },
    ])
  })

  test('derives merge groups from visible rows only when run selection is partial', () => {
    const runs: RunScope[] = [
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:04:00.000Z',
        executionIndex: 12,
      },
      {
        id: 'run-outreach',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 13,
      },
      {
        id: 'run-synthesis',
        threadSurfaceId: 'thread-synthesis',
        runStatus: 'running',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
        executionIndex: 14,
      },
    ]

    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-block',
        runId: 'run-synthesis',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents,
      runIds: ['run-research', 'run-synthesis'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-synthesis',
      'thread-research',
    ])
    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research'],
      },
    ])
  })

  test('preserves singular versus block merge representation', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: null,
        executionIndex: 50,
      },
      {
        id: 'run-review',
        threadSurfaceId: 'thread-review',
        runStatus: 'running',
        startedAt: '2026-03-09T00:07:00.000Z',
        endedAt: null,
        executionIndex: 25,
      },
      {
        id: 'run-synthesis',
        threadSurfaceId: 'thread-synthesis',
        runStatus: 'running',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
        executionIndex: 14,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:04:00.000Z',
        executionIndex: 12,
      },
      {
        id: 'run-outreach',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 13,
      },
    ]

    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-block',
        runId: 'run-synthesis',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
      },
      {
        id: 'merge-single',
        runId: 'run-review',
        destinationThreadSurfaceId: 'thread-review',
        sourceThreadSurfaceIds: ['thread-synthesis'],
        mergeKind: 'single',
        executionIndex: 25,
        createdAt: '2026-03-09T00:08:00.000Z',
      },
    ]

    const laneBoard = createLaneBoardModel({
      threadSurfaces,
      runs,
      mergeEvents,
      runIds: ['run-master', 'run-review', 'run-synthesis', 'run-research', 'run-outreach'],
    })

    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
      },
      {
        mergeEventId: 'merge-single',
        runId: 'run-review',
        mergeKind: 'single',
        executionIndex: 25,
        destinationThreadSurfaceId: 'thread-review',
        orderedThreadSurfaceIds: ['thread-review', 'thread-synthesis'],
      },
    ])
  })

  test('uses the shared multi-thread fixture for destination-first ordering and both merge shapes', () => {
    const laneBoard = createLaneBoardModel({
      threadSurfaces: multiThreadState.threadSurfaces,
      runs: multiThreadState.runs,
      mergeEvents: multiThreadState.mergeEvents,
      runIds: multiThreadState.laneRunIds,
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-synthesis',
      'thread-research',
      'thread-outreach',
      'thread-master',
      'thread-review',
    ])
    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block-synthesis',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 20,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
      },
      {
        mergeEventId: 'merge-single-master',
        runId: 'run-master',
        mergeKind: 'single',
        executionIndex: 40,
        destinationThreadSurfaceId: 'thread-master',
        orderedThreadSurfaceIds: ['thread-master', 'thread-review'],
      },
    ])
  })
})
