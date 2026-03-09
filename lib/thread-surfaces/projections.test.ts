import { describe, expect, test } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from './types'
import { projectHierarchy, projectLaneBoard, resolveDefaultDisplayRun } from './projections'

const surfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-research', 'thread-outreach', 'thread-synthesis'],
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
]

describe('thread surface projections', () => {
  test('projectHierarchy stays structural and emits parent-child edges', () => {
    const hierarchy = projectHierarchy(surfaces)

    expect(hierarchy.nodes.map(node => node.id)).toEqual([
      'thread-master',
      'thread-research',
      'thread-outreach',
      'thread-synthesis',
    ])
    expect(hierarchy.edges).toEqual([
      { source: 'thread-master', target: 'thread-research' },
      { source: 'thread-master', target: 'thread-outreach' },
      { source: 'thread-master', target: 'thread-synthesis' },
    ])
    expect(hierarchy.nodes[0]).not.toHaveProperty('runStatus')
  })

  test('resolveDefaultDisplayRun prefers active, then latest successful, then latest terminal', () => {
    const terminalRuns: RunScope[] = [
      {
        id: 'run-failed',
        threadSurfaceId: 'thread-master',
        runStatus: 'failed',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
      },
      {
        id: 'run-success',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T01:00:00.000Z',
        endedAt: '2026-03-09T01:10:00.000Z',
      },
      {
        id: 'run-cancelled',
        threadSurfaceId: 'thread-master',
        runStatus: 'cancelled',
        startedAt: '2026-03-09T02:00:00.000Z',
        endedAt: '2026-03-09T02:05:00.000Z',
      },
    ]

    expect(resolveDefaultDisplayRun(terminalRuns)?.id).toBe('run-success')

    const withActiveRun: RunScope[] = [
      ...terminalRuns,
      {
        id: 'run-active',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T03:00:00.000Z',
        endedAt: null,
      },
    ]

    expect(resolveDefaultDisplayRun(withActiveRun)?.id).toBe('run-active')

    const noSuccessRuns = terminalRuns.filter(run => run.id !== 'run-success')
    expect(resolveDefaultDisplayRun(noSuccessRuns)?.id).toBe('run-cancelled')
  })

  test('projectLaneBoard is run-scoped and keeps merge ordering truthful', () => {
    const runs: RunScope[] = [
      {
        id: 'run-old-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-08T00:00:00.000Z',
        endedAt: '2026-03-08T00:10:00.000Z',
        executionIndex: 1,
      },
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
        executionIndex: 15,
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
        sourceRunIds: ['run-research', 'run-outreach'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
        summary: 'Research and outreach merge into synthesis',
      },
    ]

    const laneBoard = projectLaneBoard({
      threadSurfaces: surfaces,
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
      runId: 'run-research',
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-outreach')).toMatchObject({
      runId: 'run-outreach',
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-master')).toMatchObject({
      runId: 'run-master',
      laneTerminalState: undefined,
    })
    expect(laneBoard.rows.some(row => row.runId === 'run-old-master')).toBe(false)
    expect(laneBoard.events).toEqual([
      {
        type: 'merge',
        runId: 'run-synthesis',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach'],
        mergeKind: 'block',
      },
    ])
  })

  test('projectLaneBoard uses source run identity when a source surface has multiple runs', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
        executionIndex: 15,
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
        id: 'run-outreach-old',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'failed',
        startedAt: '2026-03-09T00:01:30.000Z',
        endedAt: '2026-03-09T00:02:00.000Z',
        executionIndex: 11,
      },
      {
        id: 'run-outreach-current',
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
        sourceRunIds: ['run-research', 'run-outreach-current'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
      },
    ]

    const laneBoard = projectLaneBoard({
      threadSurfaces: surfaces,
      runs,
      mergeEvents,
      runIds: ['run-master', 'run-research', 'run-outreach-old', 'run-outreach-current', 'run-synthesis'],
    })

    expect(laneBoard.rows.find(row => row.runId === 'run-outreach-current')).toMatchObject({
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.runId === 'run-outreach-old')).toMatchObject({
      laneTerminalState: undefined,
      mergedIntoThreadSurfaceId: undefined,
    })
    expect(laneBoard.events).toEqual([
      {
        type: 'merge',
        runId: 'run-synthesis',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach-current'],
        mergeKind: 'block',
      },
    ])
  })
})
