import type { MergeEvent, MergeKind, RunEvent, RunScope, RunStatus, ThreadSurface } from './types'
import {
  InvalidThreadSurfaceMergeError,
  SpawnDepthExceededError,
  SpawnLimitExceededError,
  ThreadSurfaceAlreadyExistsError,
  ThreadSurfaceNotFoundError,
  ThreadSurfaceRunScopeNotFoundError,
} from '@/lib/errors'
import type { ThreadSurfaceState } from './repository'

const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['pending', 'running'])

interface CreateRootThreadSurfaceRunArgs {
  surfaceId: string
  surfaceLabel: string
  createdAt: string
  runId: string
  startedAt: string
  executionIndex?: number
}

interface CreateChildThreadSurfaceRunArgs {
  parentSurfaceId: string
  parentAgentNodeId: string
  childSurfaceId: string
  childSurfaceLabel: string
  createdAt: string
  runId: string
  startedAt: string
  executionIndex?: number
  sequenceRef?: string | null
  parentRunId?: string | null
  childIndex?: number | null
  spawnedByAgentId?: string | null
  maxSpawnDepth?: number
  maxChildrenPerSurface?: number
  maxTotalSurfaces?: number
}

interface CreateReplacementRunArgs {
  threadSurfaceId: string
  runId: string
  startedAt: string
  executionIndex?: number
}

interface CompleteRunArgs {
  runId: string
  runStatus: Extract<RunStatus, 'pending' | 'successful' | 'failed'>
  endedAt?: string | null
  runSummary?: string
}

interface CancelRunArgs {
  runId: string
  endedAt: string
}

interface RecordMergeEventArgs {
  mergeId: string
  runId: string
  destinationThreadSurfaceId: string
  sourceThreadSurfaceIds: string[]
  sourceRunIds: string[]
  mergeKind: MergeKind
  executionIndex: number
  createdAt: string
  summary?: string
}

interface RecordChildAgentSpawnEventArgs {
  eventId: string
  runId: string
  threadSurfaceId: string
  childThreadSurfaceId: string
  parentThreadSurfaceId: string
  createdAt: string
}

interface RecordGateCascadeEventArgs {
  eventId: string
  runId: string
  threadSurfaceId: string
  childGateId: string
  parentGateId: string
  cascadeStatus: 'blocked' | 'passed'
  createdAt: string
}

interface RecordSpawnWarningEventArgs {
  eventId: string
  runId: string
  threadSurfaceId: string
  limitType: 'depth' | 'children' | 'total'
  currentValue: number
  maxValue: number
  createdAt: string
}

export const emptyThreadSurfaceState: ThreadSurfaceState = {
  version: 1,
  threadSurfaces: [],
  runs: [],
  mergeEvents: [],
  runEvents: [],
}

export function createRootThreadSurfaceRun(state: ThreadSurfaceState, args: CreateRootThreadSurfaceRunArgs) {
  if (state.threadSurfaces.some(surface => surface.id === args.surfaceId)) {
    throw new ThreadSurfaceAlreadyExistsError(args.surfaceId)
  }

  const threadSurface: ThreadSurface = {
    id: args.surfaceId,
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: args.surfaceLabel,
    createdAt: args.createdAt,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: 'shared' as const,
    visibility: 'dependency' as const,
    isolationLabel: 'NONE' as const,
    revealState: null,
    allowedReadScopes: [] as string[],
    allowedWriteScopes: [] as string[],
  }

  const run = createRunScope({
    runId: args.runId,
    threadSurfaceId: args.surfaceId,
    startedAt: args.startedAt,
    executionIndex: args.executionIndex,
  })

  return {
    state: {
      ...state,
      threadSurfaces: [...state.threadSurfaces, threadSurface],
      runs: [...state.runs, run],
      runEvents: state.runEvents,
    },
    threadSurface,
    run,
  }
}

export function createChildThreadSurfaceRun(state: ThreadSurfaceState, args: CreateChildThreadSurfaceRunArgs) {
  const parentIndex = state.threadSurfaces.findIndex(surface => surface.id === args.parentSurfaceId)
  if (parentIndex === -1) {
    throw new ThreadSurfaceNotFoundError(args.parentSurfaceId)
  }
  if (state.threadSurfaces.some(surface => surface.id === args.childSurfaceId)) {
    throw new ThreadSurfaceAlreadyExistsError(args.childSurfaceId)
  }

  const parent = state.threadSurfaces[parentIndex]
  validateSpawnLimits(parent, state, args)

  const childSurface = buildChildSurface(parent, args)
  const childRun = createRunScope({
    runId: args.runId,
    threadSurfaceId: args.childSurfaceId,
    startedAt: args.startedAt,
    executionIndex: args.executionIndex,
    parentRunId: args.parentRunId ?? null,
    childIndex: args.childIndex ?? null,
  })

  const nextThreadSurfaces = [...state.threadSurfaces]
  nextThreadSurfaces[parentIndex] = {
    ...parent,
    childSurfaceIds: [...parent.childSurfaceIds, args.childSurfaceId],
  }
  nextThreadSurfaces.push(childSurface)

  const warningEvents = collectSpawnWarnings(parent, nextThreadSurfaces.length, args)

  return {
    state: {
      ...state,
      threadSurfaces: nextThreadSurfaces,
      runs: [...state.runs, childRun],
      runEvents: [...state.runEvents, ...warningEvents],
    },
    childSurface,
    childRun,
  }
}

function validateSpawnLimits(
  parent: ThreadSurface,
  state: ThreadSurfaceState,
  args: CreateChildThreadSurfaceRunArgs,
): void {
  const childDepth = parent.depth + 1
  if (args.maxSpawnDepth != null && childDepth > args.maxSpawnDepth) {
    throw new SpawnDepthExceededError(childDepth, args.maxSpawnDepth)
  }
  if (args.maxChildrenPerSurface != null && parent.childSurfaceIds.length >= args.maxChildrenPerSurface) {
    throw new SpawnLimitExceededError('children', parent.childSurfaceIds.length, args.maxChildrenPerSurface)
  }
  if (args.maxTotalSurfaces != null && state.threadSurfaces.length >= args.maxTotalSurfaces) {
    throw new SpawnLimitExceededError('total', state.threadSurfaces.length, args.maxTotalSurfaces)
  }
}

function buildChildSurface(parent: ThreadSurface, args: CreateChildThreadSurfaceRunArgs): ThreadSurface {
  return {
    id: args.childSurfaceId,
    parentSurfaceId: parent.id,
    parentAgentNodeId: args.parentAgentNodeId,
    depth: parent.depth + 1,
    surfaceLabel: args.childSurfaceLabel,
    createdAt: args.createdAt,
    childSurfaceIds: [],
    sequenceRef: args.sequenceRef ?? null,
    spawnedByAgentId: args.spawnedByAgentId ?? null,
    surfaceClass: 'shared' as const,
    visibility: 'dependency' as const,
    isolationLabel: 'NONE' as const,
    revealState: null,
    allowedReadScopes: [] as string[],
    allowedWriteScopes: [] as string[],
  }
}

function buildSpawnWarning(
  id: string,
  runId: string,
  createdAt: string,
  threadSurfaceId: string,
  limitType: 'depth' | 'children' | 'total',
  currentValue: number,
  maxValue: number,
): RunEvent {
  return {
    id,
    runId,
    eventType: 'spawn-limit-warning',
    createdAt,
    threadSurfaceId,
    payload: { limitType, currentValue, maxValue },
  }
}

function collectSpawnWarnings(
  parent: ThreadSurface,
  totalSurfaceCount: number,
  args: CreateChildThreadSurfaceRunArgs,
): RunEvent[] {
  const warnings: RunEvent[] = []
  const childDepth = parent.depth + 1

  if (args.maxSpawnDepth != null && childDepth >= args.maxSpawnDepth * 0.8) {
    warnings.push(buildSpawnWarning(
      `warn-depth-${args.runId}`, args.runId, args.createdAt,
      args.childSurfaceId, 'depth', childDepth, args.maxSpawnDepth,
    ))
  }

  if (args.maxChildrenPerSurface != null && parent.childSurfaceIds.length + 1 >= args.maxChildrenPerSurface * 0.8) {
    warnings.push(buildSpawnWarning(
      `warn-children-${args.runId}`, args.runId, args.createdAt,
      args.parentSurfaceId, 'children', parent.childSurfaceIds.length + 1, args.maxChildrenPerSurface,
    ))
  }

  if (args.maxTotalSurfaces != null && totalSurfaceCount >= args.maxTotalSurfaces * 0.8) {
    warnings.push(buildSpawnWarning(
      `warn-total-${args.runId}`, args.runId, args.createdAt,
      args.childSurfaceId, 'total', totalSurfaceCount, args.maxTotalSurfaces,
    ))
  }

  return warnings
}

export function createReplacementRun(state: ThreadSurfaceState, args: CreateReplacementRunArgs) {
  if (!state.threadSurfaces.some(surface => surface.id === args.threadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.threadSurfaceId)
  }

  const replacedRun = findLatestRunForSurface(state.runs, args.threadSurfaceId) ?? null
  const run = createRunScope({
    runId: args.runId,
    threadSurfaceId: args.threadSurfaceId,
    startedAt: args.startedAt,
    executionIndex: args.executionIndex,
  })

  return {
    state: {
      ...state,
      runs: [...state.runs, run],
      runEvents: state.runEvents,
    },
    replacedRun,
    run,
  }
}

export function completeRun(state: ThreadSurfaceState, args: CompleteRunArgs) {
  return mutateRun(state, args.runId, run => ({
    ...run,
    runStatus: args.runStatus,
    endedAt: args.endedAt ?? run.endedAt,
    ...(args.runSummary ? { runSummary: args.runSummary } : {}),
  }))
}

export function cancelRun(state: ThreadSurfaceState, args: CancelRunArgs) {
  return mutateRun(state, args.runId, run => ({
    ...run,
    runStatus: 'cancelled',
    endedAt: args.endedAt,
  }))
}

export function recordMergeEvent(state: ThreadSurfaceState, args: RecordMergeEventArgs) {
  if (!state.threadSurfaces.some(surface => surface.id === args.destinationThreadSurfaceId)) {
    throw new InvalidThreadSurfaceMergeError(`Merge destination lane must reference an existing thread surface: ${args.destinationThreadSurfaceId}`)
  }

  if (args.sourceRunIds.length !== args.sourceThreadSurfaceIds.length) {
    throw new InvalidThreadSurfaceMergeError('Merge source runs must align with merge source lanes')
  }

  for (const sourceThreadSurfaceId of args.sourceThreadSurfaceIds) {
    if (!state.threadSurfaces.some(surface => surface.id === sourceThreadSurfaceId)) {
      throw new InvalidThreadSurfaceMergeError(`Merge source lane must reference an existing thread surface: ${sourceThreadSurfaceId}`)
    }
    if (sourceThreadSurfaceId === args.destinationThreadSurfaceId) {
      throw new InvalidThreadSurfaceMergeError('Merge source lanes cannot include the destination lane')
    }
  }

  args.sourceThreadSurfaceIds.forEach((sourceThreadSurfaceId, index) => {
    const sourceRunId = args.sourceRunIds[index]
    const sourceRun = state.runs.find(run => run.id === sourceRunId)
    if (!sourceRun) {
      throw new InvalidThreadSurfaceMergeError(`Merge source run must reference an existing run scope: ${sourceRunId}`)
    }
    if (sourceRun.threadSurfaceId !== sourceThreadSurfaceId) {
      throw new InvalidThreadSurfaceMergeError(`Merge source run must belong to the source lane: ${sourceRunId}`)
    }
  })

  const mergeEvent: MergeEvent = {
    id: args.mergeId,
    runId: args.runId,
    destinationThreadSurfaceId: args.destinationThreadSurfaceId,
    sourceThreadSurfaceIds: [...args.sourceThreadSurfaceIds],
    sourceRunIds: [...args.sourceRunIds],
    mergeKind: args.mergeKind,
    executionIndex: args.executionIndex,
    createdAt: args.createdAt,
    ...(args.summary ? { summary: args.summary } : {}),
  }

  return {
    state: {
      ...state,
      mergeEvents: [...state.mergeEvents, mergeEvent],
      runEvents: state.runEvents,
    },
    mergeEvent,
  }
}

export function recordChildAgentSpawnEvent(state: ThreadSurfaceState, args: RecordChildAgentSpawnEventArgs) {
  if (!state.threadSurfaces.some(surface => surface.id === args.threadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.threadSurfaceId)
  }
  if (!state.threadSurfaces.some(surface => surface.id === args.parentThreadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.parentThreadSurfaceId)
  }
  if (!state.threadSurfaces.some(surface => surface.id === args.childThreadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.childThreadSurfaceId)
  }

  const runEvent: RunEvent = {
    id: args.eventId,
    runId: args.runId,
    eventType: 'child-agent-spawned',
    createdAt: args.createdAt,
    threadSurfaceId: args.threadSurfaceId,
    payload: {
      childThreadSurfaceId: args.childThreadSurfaceId,
      parentThreadSurfaceId: args.parentThreadSurfaceId,
    },
  }

  return {
    state: {
      ...state,
      mergeEvents: state.mergeEvents,
      threadSurfaces: state.threadSurfaces,
      runs: state.runs,
      runEvents: [...state.runEvents, runEvent],
    },
    runEvent,
  }
}

export function recordGateCascadeEvent(state: ThreadSurfaceState, args: RecordGateCascadeEventArgs) {
  if (!state.threadSurfaces.some(surface => surface.id === args.threadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.threadSurfaceId)
  }
  if (!state.runs.some(run => run.id === args.runId)) {
    throw new ThreadSurfaceRunScopeNotFoundError(args.runId)
  }

  const cascadeResultMap = { blocked: 'blocked', passed: 'approved' } as const

  const runEvent: RunEvent = {
    id: args.eventId,
    runId: args.runId,
    eventType: 'gate-cascade',
    createdAt: args.createdAt,
    threadSurfaceId: args.threadSurfaceId,
    payload: {
      sourceGateId: args.parentGateId,
      targetGateId: args.childGateId,
      cascadeResult: cascadeResultMap[args.cascadeStatus],
    },
  }

  return {
    state: {
      ...state,
      runEvents: [...state.runEvents, runEvent],
    },
    runEvent,
  }
}

export function recordSpawnWarningEvent(state: ThreadSurfaceState, args: RecordSpawnWarningEventArgs) {
  if (!state.threadSurfaces.some(surface => surface.id === args.threadSurfaceId)) {
    throw new ThreadSurfaceNotFoundError(args.threadSurfaceId)
  }
  if (!state.runs.some(run => run.id === args.runId)) {
    throw new ThreadSurfaceRunScopeNotFoundError(args.runId)
  }

  const runEvent: RunEvent = {
    id: args.eventId,
    runId: args.runId,
    eventType: 'spawn-limit-warning',
    createdAt: args.createdAt,
    threadSurfaceId: args.threadSurfaceId,
    payload: {
      limitType: args.limitType,
      currentValue: args.currentValue,
      maxValue: args.maxValue,
    },
  }

  return {
    state: {
      ...state,
      runEvents: [...state.runEvents, runEvent],
    },
    runEvent,
  }
}

export function findLatestRunForSurface(runs: RunScope[], threadSurfaceId: string): RunScope | undefined {
  return [...runs]
    .filter(run => run.threadSurfaceId === threadSurfaceId)
    .sort((left, right) => compareRunTimestamps(right) - compareRunTimestamps(left))[0]
}

export function findLatestActiveRunForSurface(runs: RunScope[], threadSurfaceId: string): RunScope | undefined {
  return [...runs]
    .filter(run => run.threadSurfaceId === threadSurfaceId && ACTIVE_RUN_STATUSES.has(run.runStatus))
    .sort((left, right) => compareRunTimestamps(right) - compareRunTimestamps(left))[0]
}

function createRunScope({
  runId,
  threadSurfaceId,
  startedAt,
  executionIndex,
  parentRunId,
  childIndex,
}: {
  runId: string
  threadSurfaceId: string
  startedAt: string
  executionIndex?: number
  parentRunId?: string | null
  childIndex?: number | null
}): RunScope {
  return {
    id: runId,
    threadSurfaceId,
    runStatus: 'running',
    startedAt,
    endedAt: null,
    parentRunId: parentRunId ?? null,
    childIndex: childIndex ?? null,
    ...(executionIndex != null ? { executionIndex } : {}),
  }
}

function mutateRun(state: ThreadSurfaceState, runId: string, transform: (run: RunScope) => RunScope) {
  const runIndex = state.runs.findIndex(run => run.id === runId)
  if (runIndex === -1) {
    throw new ThreadSurfaceRunScopeNotFoundError(runId)
  }

  const run = transform(state.runs[runIndex])
  const runs = [...state.runs]
  runs[runIndex] = run

  return {
    state: {
      ...state,
      runs,
      threadSurfaces: state.threadSurfaces,
      mergeEvents: state.mergeEvents,
      runEvents: state.runEvents,
    },
    run,
  }
}

function compareRunTimestamps(run: RunScope): number {
  return Date.parse(run.endedAt ?? run.startedAt)
}
