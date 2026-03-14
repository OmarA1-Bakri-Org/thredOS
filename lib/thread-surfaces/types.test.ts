import { describe, expect, test } from 'bun:test'
import {
  LaneTerminalStateValues,
  MergeKindValues,
  RunEventTypeValues,
  RunStatusValues,
  type LaneTerminalState,
  type MergeEvent,
  type RunEvent,
  type RunScope,
  type RunStatus,
  type ThreadSurface,
} from './types'

describe('thread surface domain types', () => {
  test('exports canonical run and lane state values', () => {
    expect(RunStatusValues).toEqual(['pending', 'running', 'successful', 'failed', 'cancelled'])
    expect(LaneTerminalStateValues).toEqual(['completed', 'failed', 'cancelled', 'merged'])
    expect(MergeKindValues).toEqual(['single', 'block'])
    expect(RunEventTypeValues).toEqual([
      'step-started',
      'step-completed',
      'gate-approved',
      'child-agent-spawned',
      'merge-occurred',
      'run-cancelled',
      'run-completed',
      'gate-cascade',
    ])
  })

  test('ThreadSurface captures structural identity separate from runs', () => {
    const threadSurface: ThreadSurface = {
      id: 'thread-master',
      parentSurfaceId: null,
      parentAgentNodeId: null,
      depth: 0,
      surfaceLabel: 'Master thread',
      createdAt: '2026-03-09T00:00:00.000Z',
      childSurfaceIds: ['thread-research', 'thread-outreach'],
      sequenceRef: null,
      spawnedByAgentId: null,
    }

    expect(threadSurface.surfaceLabel).toBe('Master thread')
    expect(threadSurface.childSurfaceIds).toHaveLength(2)
    expect(threadSurface.parentSurfaceId).toBeNull()
  })

  test('RunScope is an execution attempt, not a restart mutation on the thread surface', () => {
    const status: RunStatus = 'running'

    const run: RunScope = {
      id: 'run-001',
      threadSurfaceId: 'thread-master',
      runStatus: status,
      startedAt: '2026-03-09T00:05:00.000Z',
      endedAt: null,
      executionIndex: 1,
      plannedIndex: 0,
      runSummary: 'Initial execution attempt',
      runNotes: 'Fresh run created instead of restarting',
      runDiscussion: 'Discussing current attempt only',
      parentRunId: null,
      childIndex: null,
    }

    expect(run.threadSurfaceId).toBe('thread-master')
    expect(run.id).not.toBe(run.threadSurfaceId)
    expect(run.runStatus).toBe('running')
    expect(run.runStatus).not.toBe('cancelled')
  })

  test('MergeEvent targets an existing destination lane and keeps source lanes explicit', () => {
    const mergeEvent: MergeEvent = {
      id: 'merge-001',
      runId: 'run-001',
      destinationThreadSurfaceId: 'thread-synthesis',
      sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
      sourceRunIds: ['run-research', 'run-outreach'],
      mergeKind: 'block',
      executionIndex: 14,
      createdAt: '2026-03-09T00:15:00.000Z',
      summary: 'Research and outreach merged into synthesis',
    }

    expect(mergeEvent.destinationThreadSurfaceId).toBe('thread-synthesis')
    expect(mergeEvent.sourceThreadSurfaceIds).toEqual(['thread-research', 'thread-outreach'])
    expect(mergeEvent.sourceRunIds).toEqual(['run-research', 'run-outreach'])
    expect(mergeEvent.sourceThreadSurfaceIds).not.toContain(mergeEvent.destinationThreadSurfaceId)
  })

  test('RunEvent and lane states represent terminal merged lanes without restart semantics', () => {
    const laneState: LaneTerminalState = 'merged'

    const runEvent: RunEvent = {
      id: 'event-001',
      runId: 'run-001',
      eventType: 'merge-occurred',
      createdAt: '2026-03-09T00:15:00.000Z',
      threadSurfaceId: 'thread-synthesis',
      payload: {
        mergeKind: 'single',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research'],
        sourceRunIds: ['run-research'],
        laneTerminalState: laneState,
      },
    }

    expect(runEvent.eventType).toBe('merge-occurred')
    expect(runEvent.payload).toEqual({
      mergeKind: 'single',
      destinationThreadSurfaceId: 'thread-synthesis',
      laneTerminalState: 'merged',
      sourceThreadSurfaceIds: ['thread-research'],
      sourceRunIds: ['run-research'],
    })
  })
})
