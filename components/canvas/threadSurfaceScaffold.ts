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

function deriveRunStatus(status: SequenceStatus): Exclude<ThreadSurfaceHierarchyStatus, null> {
  if (status.summary.running > 0) return 'running'
  if (status.summary.failed > 0) return 'failed'
  if (status.summary.total > 0 && status.summary.done === status.summary.total) return 'successful'
  if (status.summary.ready > 0 || status.summary.blocked > 0 || status.summary.needsReview > 0) return 'pending'
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
  return Array.isArray(threadSurfaces) && Array.isArray(runs) && Array.isArray(mergeEvents)
}

function hasPersistedThreadSurfaceData(
  threadSurfaces?: ThreadSurface[] | null,
  runs?: RunScope[] | null,
  mergeEvents?: MergeEvent[] | null,
): boolean {
  return (threadSurfaces?.length ?? 0) > 0 || (runs?.length ?? 0) > 0 || (mergeEvents?.length ?? 0) > 0
}
