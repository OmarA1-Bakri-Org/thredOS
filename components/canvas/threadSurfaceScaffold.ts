export type ThreadSurfaceHierarchyStatus = 'pending' | 'running' | 'successful' | 'failed' | 'cancelled' | null

import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

export interface ThreadSurfaceScaffold {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
}

export interface ResolveThreadSurfaceCanvasDataArgs {
  status?: SequenceStatus | null
  threadSurfaces?: ThreadSurface[] | null
  runs?: RunScope[] | null
  mergeEvents?: MergeEvent[] | null
}

export interface ThreadSurfaceCanvasData extends ThreadSurfaceScaffold {
  source: 'api' | 'status-scaffold' | 'empty'
}

const CURRENT_THREAD_SURFACE_ID = 'thread-current'
const CURRENT_RUN_ID = 'status:current-run'
const STATUS_TIMESTAMP = '2026-03-09T00:00:00.000Z'

export function buildThreadSurfaceScaffold(status: SequenceStatus): ThreadSurfaceScaffold {
  const threadSurface: ThreadSurface = {
    id: CURRENT_THREAD_SURFACE_ID,
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: status.name || 'Current Thread',
    surfaceDescription: 'Scaffolded from the current sequence status until thread-surface APIs are available.',
    role: 'orchestrator',
    createdAt: STATUS_TIMESTAMP,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  }

  const runStatus = deriveRunStatus(status)
  const run: RunScope = {
    id: CURRENT_RUN_ID,
    threadSurfaceId: threadSurface.id,
    runStatus,
    startedAt: STATUS_TIMESTAMP,
    endedAt: runStatus === 'running' || runStatus === 'pending' ? null : STATUS_TIMESTAMP,
    executionIndex: 1,
    runSummary: buildRunSummary(status),
    runNotes: 'Sequence-backed scaffold for hierarchy-to-lane navigation.',
    runDiscussion: 'Full recursive thread-surface data will replace this scaffold once the backend exposes real thread runs.',
    parentRunId: null,
    childIndex: null,
  }

  return {
    threadSurfaces: [threadSurface],
    runs: [run],
    mergeEvents: [],
  }
}

export function resolveThreadSurfaceCanvasData({
  status,
  threadSurfaces,
  runs,
  mergeEvents,
}: ResolveThreadSurfaceCanvasDataArgs): ThreadSurfaceCanvasData {
  if (hasResolvedThreadSurfaceApiData(threadSurfaces, runs, mergeEvents) && hasPersistedThreadSurfaceData(threadSurfaces, runs, mergeEvents)) {
    return {
      source: 'api',
      threadSurfaces: threadSurfaces ?? [],
      runs: runs ?? [],
      mergeEvents: mergeEvents ?? [],
    }
  }

  if (status) {
    return {
      source: 'status-scaffold',
      ...buildThreadSurfaceScaffold(status),
    }
  }

  return {
    source: 'empty',
    threadSurfaces: [],
    runs: [],
    mergeEvents: [],
  }
}

const RUN_STATUS_CHECKS: Array<{
  test: (summary: SequenceStatus['summary']) => boolean
  status: Exclude<ThreadSurfaceHierarchyStatus, null>
}> = [
  { test: s => s.running > 0, status: 'running' },
  { test: s => s.failed > 0, status: 'failed' },
  { test: s => s.total > 0 && s.done === s.total, status: 'successful' },
  { test: s => s.ready > 0 || s.blocked > 0 || s.needsReview > 0, status: 'pending' },
]

function deriveRunStatus(status: SequenceStatus): Exclude<ThreadSurfaceHierarchyStatus, null> {
  for (const check of RUN_STATUS_CHECKS) {
    if (check.test(status.summary)) return check.status
  }
  return 'cancelled'
}

function buildRunSummary(status: SequenceStatus): string {
  return [
    `${status.summary.total} total step${status.summary.total === 1 ? '' : 's'}`,
    `${status.summary.running} running`,
    `${status.summary.done} done`,
    `${status.summary.failed} failed`,
  ].join(' | ')
}

export function hasResolvedThreadSurfaceApiData(
  threadSurfaces?: ThreadSurface[] | null,
  runs?: RunScope[] | null,
  mergeEvents?: MergeEvent[] | null,
): boolean {
  const collections = [threadSurfaces, runs, mergeEvents]
  return collections.every(collection => Array.isArray(collection))
}

function hasPersistedThreadSurfaceData(
  threadSurfaces?: ThreadSurface[] | null,
  runs?: RunScope[] | null,
  mergeEvents?: MergeEvent[] | null,
): boolean {
  return (threadSurfaces?.length ?? 0) > 0 || (runs?.length ?? 0) > 0 || (mergeEvents?.length ?? 0) > 0
}
