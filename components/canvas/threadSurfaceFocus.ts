import { resolveDefaultDisplayRun } from '@/lib/thread-surfaces/projections'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import type { LaneBoardDisplayRow, LaneBoardMergeGroup } from '@/components/lanes/useLaneBoard'

export interface ThreadSurfaceFocusedDetail {
  threadSurfaceId: string
  surfaceLabel: string
  surfaceDescription: string | null
  role: string | null
  surfaceClass: string | null
  visibility: string | null
  isolationLabel: string | null
  revealState: string | null
  allowedReadScopes: string[]
  allowedWriteScopes: string[]
  runId: string | null
  runStatus: RunScope['runStatus'] | null
  executionIndex: number | null
  runSummary: string | null
  runNotes: string | null
  runDiscussion: string | null
  laneTerminalState: string | null
  mergedIntoThreadSurfaceId: string | null
  incomingMergeGroups: LaneBoardMergeGroup[]
  outgoingMergeEvents: MergeEvent[]
}

interface ResolveThreadSurfaceFocusedDetailArgs {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  rows: LaneBoardDisplayRow[]
  mergeGroups: LaneBoardMergeGroup[]
  focusedThreadSurfaceId: string | null
  selectedRunId: string | null
}

export function resolveThreadSurfaceFocusedDetail({
  threadSurfaces,
  runs,
  mergeEvents,
  rows,
  mergeGroups,
  focusedThreadSurfaceId,
  selectedRunId,
}: ResolveThreadSurfaceFocusedDetailArgs): ThreadSurfaceFocusedDetail | null {
  const fallbackThreadSurfaceId = focusedThreadSurfaceId ?? rows[0]?.threadSurfaceId ?? null
  if (!fallbackThreadSurfaceId) return null

  const threadSurface = threadSurfaces.find(surface => surface.id === fallbackThreadSurfaceId)
  if (!threadSurface) return null

  const surfaceRuns = runs.filter(run => run.threadSurfaceId === fallbackThreadSurfaceId)
  const displayRun = resolveDisplayRun(surfaceRuns, selectedRunId)
  const row = findMatchingRow(rows, fallbackThreadSurfaceId, displayRun)
  const displayRunId = displayRun?.id ?? null

  return {
    ...buildSurfaceFields(threadSurface),
    ...buildRunFields(displayRun, row),
    ...buildLaneFields(row),
    incomingMergeGroups: filterIncomingMergeGroups(mergeGroups, threadSurface.id, displayRunId),
    outgoingMergeEvents: filterOutgoingMergeEvents(mergeEvents, threadSurface.id, displayRunId),
  }
}

function resolveDisplayRun(surfaceRuns: RunScope[], selectedRunId: string | null): RunScope | null {
  const selectedRun = selectedRunId
    ? surfaceRuns.find(run => run.id === selectedRunId) ?? null
    : null
  return selectedRun ?? resolveDefaultDisplayRun(surfaceRuns) ?? null
}

function findMatchingRow(
  rows: LaneBoardDisplayRow[],
  threadSurfaceId: string,
  displayRun: RunScope | null,
): LaneBoardDisplayRow | undefined {
  return rows.find(candidate =>
    candidate.threadSurfaceId === threadSurfaceId
    && (displayRun ? candidate.runId === displayRun.id : true),
  )
}

function buildSurfaceFields(threadSurface: ThreadSurface) {
  return {
    threadSurfaceId: threadSurface.id,
    surfaceLabel: threadSurface.surfaceLabel,
    surfaceDescription: threadSurface.surfaceDescription ?? null,
    role: threadSurface.role ?? null,
    surfaceClass: threadSurface.surfaceClass ?? null,
    visibility: threadSurface.visibility ?? null,
    isolationLabel: threadSurface.isolationLabel ?? null,
    revealState: threadSurface.revealState ?? null,
    allowedReadScopes: threadSurface.allowedReadScopes ?? [],
    allowedWriteScopes: threadSurface.allowedWriteScopes ?? [],
  }
}

function buildRunFields(displayRun: RunScope | null, row: LaneBoardDisplayRow | undefined) {
  return {
    runId: displayRun?.id ?? null,
    runStatus: displayRun?.runStatus ?? null,
    executionIndex: displayRun?.executionIndex ?? row?.executionIndex ?? null,
    runSummary: displayRun?.runSummary ?? null,
    runNotes: displayRun?.runNotes ?? null,
    runDiscussion: displayRun?.runDiscussion ?? null,
  }
}

function buildLaneFields(row: LaneBoardDisplayRow | undefined) {
  return {
    laneTerminalState: row?.laneTerminalState ?? null,
    mergedIntoThreadSurfaceId: row?.mergedIntoThreadSurfaceId ?? null,
  }
}

function filterIncomingMergeGroups(
  mergeGroups: LaneBoardMergeGroup[],
  threadSurfaceId: string,
  displayRunId: string | null,
): LaneBoardMergeGroup[] {
  return mergeGroups.filter(group =>
    group.destinationThreadSurfaceId === threadSurfaceId
    && (displayRunId == null || group.runId === displayRunId),
  )
}

function filterOutgoingMergeEvents(
  mergeEvents: MergeEvent[],
  threadSurfaceId: string,
  displayRunId: string | null,
): MergeEvent[] {
  return mergeEvents.filter(event =>
    event.sourceThreadSurfaceIds.includes(threadSurfaceId)
    && (displayRunId == null || event.runId === displayRunId),
  )
}
