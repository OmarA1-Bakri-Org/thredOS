export const RunStatusValues = ['pending', 'running', 'successful', 'failed', 'cancelled'] as const
export type RunStatus = typeof RunStatusValues[number]

export const LaneTerminalStateValues = ['completed', 'failed', 'cancelled', 'merged'] as const
export type LaneTerminalState = typeof LaneTerminalStateValues[number]

export const MergeKindValues = ['single', 'block'] as const
export type MergeKind = typeof MergeKindValues[number]

export const RunEventTypeValues = [
  'step-started',
  'step-completed',
  'gate-approved',
  'child-agent-spawned',
  'merge-occurred',
  'run-cancelled',
  'run-completed',
  'gate-cascade',
] as const
export type RunEventType = typeof RunEventTypeValues[number]

export interface ThreadSurface {
  id: string
  parentSurfaceId: string | null
  parentAgentNodeId: string | null
  depth: number
  surfaceLabel: string
  surfaceDescription?: string
  role?: string
  registeredAgentId?: string
  createdAt: string
  childSurfaceIds: string[]
  sequenceRef: string | null
  spawnedByAgentId: string | null
}

export interface RunScope {
  id: string
  threadSurfaceId: string
  runStatus: RunStatus
  startedAt: string
  endedAt: string | null
  executionIndex?: number
  plannedIndex?: number
  runSummary?: string
  runNotes?: string
  runDiscussion?: string
  parentRunId: string | null
  childIndex: number | null
}

export interface RunEventPayloadByType {
  'step-started': {
    stepId: string
  }
  'step-completed': {
    stepId: string
    laneTerminalState?: LaneTerminalState
  }
  'gate-approved': {
    gateId: string
  }
  'child-agent-spawned': {
    childThreadSurfaceId: string
    parentThreadSurfaceId: string
  }
  'merge-occurred': {
    mergeKind: MergeKind
    destinationThreadSurfaceId: string
    sourceThreadSurfaceIds: string[]
    sourceRunIds?: string[]
    laneTerminalState: LaneTerminalState
  }
  'run-cancelled': {
    reason?: string
  }
  'run-completed': {
    summary?: string
  }
  'gate-cascade': {
    sourceGateId: string
    targetGateId: string
    cascadeResult: 'blocked' | 'approved'
  }
}

interface BaseRunEvent<T extends RunEventType> {
  id: string
  runId: string
  eventType: T
  createdAt: string
  threadSurfaceId: string
  payload: RunEventPayloadByType[T]
}

export type RunEvent = {
  [T in RunEventType]: BaseRunEvent<T>
}[RunEventType]

export interface MergeEvent {
  id: string
  runId: string
  destinationThreadSurfaceId: string
  sourceThreadSurfaceIds: string[]
  sourceRunIds?: string[]
  mergeKind: MergeKind
  executionIndex: number
  createdAt: string
  summary?: string
}

// ── Skill types ──────────────────────────────────────────────────────

export interface ThreadSkillBadge {
  id: string
  label: string
  inherited: boolean
}

export interface SkillProjection {
  threadSurfaceId: string
  skills: ThreadSkillBadge[]
}
