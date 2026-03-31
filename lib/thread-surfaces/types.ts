export const RunStatusValues = ['pending', 'running', 'successful', 'failed', 'cancelled'] as const
export type RunStatus = typeof RunStatusValues[number]
export type SurfaceClass = 'shared' | 'private' | 'sealed' | 'control'
export type SurfaceVisibility = 'public' | 'dependency' | 'self_only'
export type IsolationLabel = 'NONE' | 'THREADOS_SCOPED' | 'HOST_ENFORCED'
export type RevealState = 'sealed' | 'revealed' | null

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
  'spawn-limit-warning',
  'spawn-denied',
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
  // V.1 surface model
  surfaceClass?: SurfaceClass
  visibility?: SurfaceVisibility
  isolationLabel?: IsolationLabel
  revealState?: RevealState
  allowedReadScopes?: string[]
  allowedWriteScopes?: string[]
}

export interface NormalizedThreadSurface extends ThreadSurface {
  surfaceClass: SurfaceClass
  visibility: SurfaceVisibility
  isolationLabel: IsolationLabel
  revealState: RevealState
  allowedReadScopes: string[]
  allowedWriteScopes: string[]
}

export function normalizeThreadSurface(surface: ThreadSurface): NormalizedThreadSurface {
  const surfaceClass = surface.surfaceClass ?? 'shared'
  return {
    ...surface,
    surfaceClass,
    visibility: surface.visibility ?? (surfaceClass === 'sealed' ? 'self_only' : 'dependency'),
    isolationLabel: surface.isolationLabel ?? (surfaceClass === 'sealed' ? 'THREADOS_SCOPED' : 'NONE'),
    revealState: surface.revealState ?? (surfaceClass === 'sealed' ? 'sealed' : null),
    allowedReadScopes: surface.allowedReadScopes ?? [],
    allowedWriteScopes: surface.allowedWriteScopes ?? [],
  }
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
  'spawn-limit-warning': {
    limitType: 'depth' | 'children' | 'total'
    currentValue: number
    maxValue: number
  }
  'spawn-denied': {
    reason: string
    childStepId: string
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
