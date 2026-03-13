import type { LaneTerminalState, MergeEvent, RunScope, SkillProjection, ThreadSkillBadge, ThreadSurface } from './types'
import type { AgentRegistration } from '../agents/types'

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
  sourceRunIds: string[]
  mergeKind: MergeEvent['mergeKind']
}

export type LaneBoardEvent = LaneBoardMergeEvent

interface LaneRowMergeSortKey {
  clusterOrder: number
  role: 0 | 1
  mergeExecutionIndex: number
  sourcePosition: number
}

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
      childSurfaceIds: [...surface.childSurfaceIds],
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

  const rowsBySurfaceId = new Map<string, LaneBoardRow[]>()
  for (const row of rows) {
    const surfaceRows = rowsBySurfaceId.get(row.threadSurfaceId)
    if (surfaceRows) {
      surfaceRows.push(row)
    } else {
      rowsBySurfaceId.set(row.threadSurfaceId, [row])
    }
  }
  const rowMergeOrder = new Map<string, LaneRowMergeSortKey>()

  const selectedMergeEvents = mergeEvents
    .filter(event => selectedRunIds.has(event.runId))
    .sort((left, right) => left.executionIndex - right.executionIndex)

  selectedMergeEvents.forEach((event, mergeOrder) => {
    const destinationRow = rowsBySurfaceId.get(event.destinationThreadSurfaceId)?.find(row => row.runId === event.runId)
    if (!destinationRow) return

    const existingDestinationOrder = rowMergeOrder.get(destinationRow.runId)
    if (
      existingDestinationOrder == null
      || existingDestinationOrder.role !== 0
      || existingDestinationOrder.clusterOrder > mergeOrder
    ) {
      rowMergeOrder.set(destinationRow.runId, {
        clusterOrder: mergeOrder,
        role: 0,
        mergeExecutionIndex: event.executionIndex,
        sourcePosition: -1,
      })
    }

    event.sourceThreadSurfaceIds.forEach((sourceId, sourcePosition) => {
      const sourceRunId = event.sourceRunIds?.[sourcePosition]
      const sourceRow = sourceRunId
        ? rowsBySurfaceId.get(sourceId)?.find(row => row.runId === sourceRunId)
        : rowsBySurfaceId.get(sourceId)?.[0]
      if (!sourceRow) return
      sourceRow.laneTerminalState = 'merged'
      sourceRow.mergedIntoThreadSurfaceId = event.destinationThreadSurfaceId
      const existingSourceOrder = rowMergeOrder.get(sourceRow.runId)
      if (existingSourceOrder?.role === 0) return
      rowMergeOrder.set(sourceRow.runId, {
        clusterOrder: mergeOrder,
        role: 1,
        mergeExecutionIndex: event.executionIndex,
        sourcePosition,
      })
    })
  })

  rows.sort((left, right) => {
    const leftMerge = rowMergeOrder.get(left.runId)
    const rightMerge = rowMergeOrder.get(right.runId)

    if (leftMerge && rightMerge) {
      if (leftMerge.clusterOrder !== rightMerge.clusterOrder) {
        return leftMerge.clusterOrder - rightMerge.clusterOrder
      }
      if (leftMerge.role !== rightMerge.role) {
        return leftMerge.role - rightMerge.role
      }
      if (leftMerge.mergeExecutionIndex !== rightMerge.mergeExecutionIndex) {
        return leftMerge.mergeExecutionIndex - rightMerge.mergeExecutionIndex
      }
      return leftMerge.sourcePosition - rightMerge.sourcePosition
    }
    if (leftMerge) return -1
    if (rightMerge) return 1
    return (left.executionIndex ?? Number.MAX_SAFE_INTEGER) - (right.executionIndex ?? Number.MAX_SAFE_INTEGER)
  })

  return {
    rows: rows.map(row => ({ ...row })),
    events: selectedMergeEvents.map(event => ({
      type: 'merge',
      runId: event.runId,
      executionIndex: event.executionIndex,
      destinationThreadSurfaceId: event.destinationThreadSurfaceId,
      sourceThreadSurfaceIds: [...event.sourceThreadSurfaceIds],
      sourceRunIds: [...(event.sourceRunIds ?? [])],
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

// ── Skill projection ────────────────────────────────────────────────

const DEFAULT_SKILLS: ThreadSkillBadge[] = [
  { id: 'search', label: 'Search', inherited: false },
  { id: 'browser', label: 'Browser', inherited: false },
  { id: 'model', label: 'Model', inherited: false },
  { id: 'tools', label: 'Tools', inherited: false },
  { id: 'files', label: 'Files', inherited: true },
  { id: 'orchestration', label: 'Orchestration', inherited: true },
]

/**
 * Resolve skills for a thread surface from its registered agent.
 *
 * If the agent has `metadata.skills`, those are used (with inherited flag
 * preserved). Otherwise a default skill set is returned with the
 * direct/inherited split pre-assigned.
 */
export function resolveSkillsForAgent(agent: AgentRegistration | null): ThreadSkillBadge[] {
  if (agent?.metadata?.skills && Array.isArray(agent.metadata.skills)) {
    return (agent.metadata.skills as Array<{ id: string; label: string; inherited?: boolean }>).map(s => ({
      id: s.id,
      label: s.label,
      inherited: s.inherited ?? false,
    }))
  }
  return [...DEFAULT_SKILLS]
}

/**
 * Project skills onto each thread surface by resolving the registered
 * agent for that surface and extracting skill data.
 */
export function projectSkills(
  threadSurfaces: ThreadSurface[],
  agents: AgentRegistration[],
): SkillProjection[] {
  const agentById = new Map(agents.map(a => [a.id, a]))

  return threadSurfaces.map(surface => {
    const agent = surface.registeredAgentId
      ? agentById.get(surface.registeredAgentId) ?? null
      : null
    return {
      threadSurfaceId: surface.id,
      skills: resolveSkillsForAgent(agent),
    }
  })
}
