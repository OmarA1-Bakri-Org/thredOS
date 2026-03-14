import { describe, expect, test } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import type { LaneBoardDisplayRow, LaneBoardMergeGroup } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from './threadSurfaceFocus'

const threadSurfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    surfaceDescription: 'Root orchestrator surface',
    role: 'orchestrator',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-synthesis'],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-synthesis',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-synthesis',
    depth: 1,
    surfaceLabel: 'Synthesis',
    surfaceDescription: 'Combines child work into one brief',
    role: 'synthesizer',
    createdAt: '2026-03-09T00:03:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-review',
    parentSurfaceId: 'thread-synthesis',
    parentAgentNodeId: 'spawn-review',
    depth: 2,
    surfaceLabel: 'Review',
    createdAt: '2026-03-09T00:04:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
]

const runs: RunScope[] = [
  {
    id: 'run-master',
    threadSurfaceId: 'thread-master',
    runStatus: 'running',
    startedAt: '2026-03-09T00:00:00.000Z',
    endedAt: null,
    executionIndex: 40,
    runSummary: 'Master owns final delivery.',
    parentRunId: null,
    childIndex: null,
  },
  {
    id: 'run-synthesis',
    threadSurfaceId: 'thread-synthesis',
    runStatus: 'running',
    startedAt: '2026-03-09T00:03:00.000Z',
    endedAt: null,
    executionIndex: 20,
    runSummary: 'Synthesis is consolidating research.',
    runNotes: 'Prepare the review packet.',
    runDiscussion: 'Child discussion context.',
    parentRunId: null,
    childIndex: null,
  },
]

const mergeEvents: MergeEvent[] = [
  {
    id: 'merge-master',
    runId: 'run-master',
    destinationThreadSurfaceId: 'thread-master',
    sourceThreadSurfaceIds: ['thread-review'],
    mergeKind: 'single',
    executionIndex: 40,
    createdAt: '2026-03-09T00:08:30.000Z',
    summary: 'Review merged into master.',
  },
]

const rows: LaneBoardDisplayRow[] = [
  {
    threadSurfaceId: 'thread-synthesis',
    surfaceLabel: 'Synthesis',
    runId: 'run-synthesis',
    executionIndex: 20,
    isMergeSource: false,
  },
  {
    threadSurfaceId: 'thread-master',
    surfaceLabel: 'Master',
    runId: 'run-master',
    executionIndex: 40,
    isMergeSource: false,
  },
  {
    threadSurfaceId: 'thread-review',
    surfaceLabel: 'Review',
    runId: 'run-review',
    executionIndex: 30,
    laneTerminalState: 'merged',
    mergedIntoThreadSurfaceId: 'thread-master',
    isMergeSource: true,
  },
]

const mergeGroups: LaneBoardMergeGroup[] = [
  {
    mergeEventId: 'merge-master',
    runId: 'run-master',
    mergeKind: 'single',
    executionIndex: 40,
    destinationThreadSurfaceId: 'thread-master',
    orderedThreadSurfaceIds: ['thread-master', 'thread-review'],
  },
]

describe('thread surface focused detail', () => {
  test('resolves focused thread details from the selected thread instead of falling back to the root sequence', () => {
    const detail = resolveThreadSurfaceFocusedDetail({
      threadSurfaces,
      runs,
      mergeEvents,
      rows,
      mergeGroups,
      focusedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
    })

    expect(detail).toMatchObject({
      threadSurfaceId: 'thread-synthesis',
      surfaceLabel: 'Synthesis',
      role: 'synthesizer',
      runId: 'run-synthesis',
      executionIndex: 20,
      runSummary: 'Synthesis is consolidating research.',
      runNotes: 'Prepare the review packet.',
      runDiscussion: 'Child discussion context.',
    })
  })

  test('surfaces merge metadata for destination and source lanes', () => {
    const destination = resolveThreadSurfaceFocusedDetail({
      threadSurfaces,
      runs,
      mergeEvents,
      rows,
      mergeGroups,
      focusedThreadSurfaceId: 'thread-master',
      selectedRunId: 'run-master',
    })
    const source = resolveThreadSurfaceFocusedDetail({
      threadSurfaces,
      runs,
      mergeEvents,
      rows,
      mergeGroups,
      focusedThreadSurfaceId: 'thread-review',
      selectedRunId: null,
    })

    expect(destination?.incomingMergeGroups).toEqual(mergeGroups)
    expect(source).toMatchObject({
      threadSurfaceId: 'thread-review',
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-master',
    })
  })
})
