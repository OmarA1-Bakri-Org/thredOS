import type { LaneTerminalState, MergeEvent, RunScope, ThreadSurface } from './types'

export interface HierarchyProjectionNode {
  id: string
  parentSurfaceId: string | null
  depth: number
  surfaceLabel: string
  childSurfaceIds: string[]
}

export interface HierarchyProjectionEdge {
  source: string
  target: string
}

export interface HierarchyProjection {
  nodes: HierarchyProjectionNode[]
  edges: HierarchyProjectionEdge[]
}

export interface LaneBoardRow {
  threadSurfaceId: string
  surfaceLabel: string
  runId: string
  executionIndex?: number
  laneTerminalState?: LaneTerminalState
  mergedIntoThreadSurfaceId?: string
}

export interface LaneBoardProjection {
  rows: LaneBoardRow[]
  events: LaneBoardEvent[]
}

export interface LaneBoardMergeEvent {
  type: 'merge'
  runId: string
  executionIndex: number
  destinationThreadSurfaceId: string
  sourceThreadSurfaceIds: string[]
  mergeKind: MergeEvent['mergeKind']
}

export type LaneBoardEvent = LaneBoardMergeEvent

interface ProjectLaneBoardArgs {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  runIds: string[]
}

export function projectHierarchy(threadSurfaces: ThreadSurface[]): HierarchyProjection {
  return {
    nodes: threadSurfaces.map(surface => ({
      id: surface.id,
      parentSurfaceId: surface.parentSurfaceId,
      depth: surface.depth,
      surfaceLabel: surface.surfaceLabel,
      childSurfaceIds: surface.childSurfaceIds,
    })),
    edges: threadSurfaces
      .filter(surface => surface.parentSurfaceId != null)
      .map(surface => ({
        source: surface.parentSurfaceId as string,
        target: surface.id,
      })),
  }
}

export function resolveDefaultDisplayRun(runs: RunScope[]): RunScope | undefined {
  const activeRuns = runs.filter(run => run.runStatus === 'pending' || run.runStatus === 'running')
  if (activeRuns.length > 0) return latestRun(activeRuns)

  const successfulRuns = runs.filter(run => run.runStatus === 'successful')
  if (successfulRuns.length > 0) return latestRun(successfulRuns)

  return latestRun(runs)
}

export function projectLaneBoard({ threadSurfaces, runs, mergeEvents, runIds }: ProjectLaneBoardArgs): LaneBoardProjection {
  const selectedRunIds = new Set(runIds)
  const selectedRuns = runs.filter(run => selectedRunIds.has(run.id))
  const surfaceMap = new Map(threadSurfaces.map(surface => [surface.id, surface]))

  const rows: LaneBoardRow[] = selectedRuns.map(run => ({
    threadSurfaceId: run.threadSurfaceId,
    surfaceLabel: surfaceMap.get(run.threadSurfaceId)?.surfaceLabel ?? run.threadSurfaceId,
    runId: run.id,
    executionIndex: run.executionIndex,
    laneTerminalState: undefined,
    mergedIntoThreadSurfaceId: undefined,
  }))

  const rowMap = new Map(rows.map(row => [row.threadSurfaceId, row]))
  const destinationOrder = new Map<string, { destinationIndex: number; mergeIndex: number; sourcePosition: number }>()

  const selectedMergeEvents = mergeEvents
    .filter(event => selectedRunIds.has(event.runId))
    .sort((left, right) => left.executionIndex - right.executionIndex)

  selectedMergeEvents.forEach((event, mergeOrder) => {
    const destinationRow = rowMap.get(event.destinationThreadSurfaceId)
    if (!destinationRow) return

    destinationOrder.set(event.destinationThreadSurfaceId, {
      destinationIndex: mergeOrder,
      mergeIndex: -1,
      sourcePosition: -1,
    })

    event.sourceThreadSurfaceIds.forEach((sourceId, sourcePosition) => {
      const sourceRow = rowMap.get(sourceId)
      if (!sourceRow) return
      sourceRow.laneTerminalState = 'merged'
      sourceRow.mergedIntoThreadSurfaceId = event.destinationThreadSurfaceId
      destinationOrder.set(sourceId, {
        destinationIndex: mergeOrder,
        mergeIndex: event.executionIndex,
        sourcePosition,
      })
    })
  })

  rows.sort((left, right) => {
    const leftMerge = destinationOrder.get(left.threadSurfaceId)
    const rightMerge = destinationOrder.get(right.threadSurfaceId)

    if (leftMerge && rightMerge) {
      if (leftMerge.destinationIndex !== rightMerge.destinationIndex) {
        return leftMerge.destinationIndex - rightMerge.destinationIndex
      }
      if (leftMerge.mergeIndex !== rightMerge.mergeIndex) {
        return leftMerge.mergeIndex - rightMerge.mergeIndex
      }
      return leftMerge.sourcePosition - rightMerge.sourcePosition
    }
    if (leftMerge) return -1
    if (rightMerge) return 1
    return (left.executionIndex ?? Number.MAX_SAFE_INTEGER) - (right.executionIndex ?? Number.MAX_SAFE_INTEGER)
  })

  return {
    rows,
    events: selectedMergeEvents.map(event => ({
      type: 'merge',
      runId: event.runId,
      executionIndex: event.executionIndex,
      destinationThreadSurfaceId: event.destinationThreadSurfaceId,
      sourceThreadSurfaceIds: event.sourceThreadSurfaceIds,
      mergeKind: event.mergeKind,
    })),
  }
}

function latestRun(runs: RunScope[]): RunScope | undefined {
  return [...runs].sort((left, right) => {
    const leftTimestamp = left.endedAt ?? left.startedAt
    const rightTimestamp = right.endedAt ?? right.startedAt
    return rightTimestamp.localeCompare(leftTimestamp)
  })[0]
}
