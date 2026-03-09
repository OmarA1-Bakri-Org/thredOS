import { resolveDefaultDisplayRun } from '@/lib/thread-surfaces/projections'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import type { LaneBoardDisplayRow, LaneBoardMergeGroup } from '@/components/lanes/useLaneBoard'

export interface ThreadSurfaceFocusedDetail {
  threadSurfaceId: string
  surfaceLabel: string
  surfaceDescription: string | null
  role: string | null
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

  const row = rows.find(candidate => candidate.threadSurfaceId === fallbackThreadSurfaceId)
  const surfaceRuns = runs.filter(run => run.threadSurfaceId === fallbackThreadSurfaceId)
  const selectedRun = selectedRunId
    ? surfaceRuns.find(run => run.id === selectedRunId) ?? null
    : null
  const displayRun = selectedRun ?? resolveDefaultDisplayRun(surfaceRuns) ?? null

  return {
    threadSurfaceId: threadSurface.id,
    surfaceLabel: threadSurface.surfaceLabel,
    surfaceDescription: threadSurface.surfaceDescription ?? null,
    role: threadSurface.role ?? null,
    runId: displayRun?.id ?? null,
    runStatus: displayRun?.runStatus ?? null,
    executionIndex: displayRun?.executionIndex ?? row?.executionIndex ?? null,
    runSummary: displayRun?.runSummary ?? null,
    runNotes: displayRun?.runNotes ?? null,
    runDiscussion: displayRun?.runDiscussion ?? null,
    laneTerminalState: row?.laneTerminalState ?? null,
    mergedIntoThreadSurfaceId: row?.mergedIntoThreadSurfaceId ?? null,
    incomingMergeGroups: mergeGroups.filter(group => group.destinationThreadSurfaceId === threadSurface.id),
    outgoingMergeEvents: mergeEvents.filter(event => event.sourceThreadSurfaceIds.includes(threadSurface.id)),
  }
}
