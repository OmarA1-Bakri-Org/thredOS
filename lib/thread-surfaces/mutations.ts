import {
  InvalidThreadSurfaceMergeError,
  ThreadSurfaceAlreadyExistsError,
  ThreadSurfaceNotFoundError,
  ThreadSurfaceRunScopeNotFoundError,
} from '@/lib/errors'
import type { MergeEvent, MergeKind, RunScope, RunStatus, ThreadSurface } from './types'
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
}

interface CreateReplacementRunArgs {
  threadSurfaceId: string
  runId: string
  startedAt: string
  executionIndex?: number
}

interface CompleteRunArgs {
  runId: string
  runStatus: Extract<RunStatus, 'successful' | 'failed'>
  endedAt: string
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
  mergeKind: MergeKind
  executionIndex: number
  createdAt: string
  summary?: string
}

export const emptyThreadSurfaceState: ThreadSurfaceState = {
  version: 1,
  threadSurfaces: [],
  runs: [],
  mergeEvents: [],
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
  const childSurface: ThreadSurface = {
    id: args.childSurfaceId,
    parentSurfaceId: parent.id,
    parentAgentNodeId: args.parentAgentNodeId,
    depth: parent.depth + 1,
    surfaceLabel: args.childSurfaceLabel,
    createdAt: args.createdAt,
    childSurfaceIds: [],
  }

  const childRun = createRunScope({
    runId: args.runId,
    threadSurfaceId: args.childSurfaceId,
    startedAt: args.startedAt,
    executionIndex: args.executionIndex,
  })

  const nextThreadSurfaces = [...state.threadSurfaces]
  nextThreadSurfaces[parentIndex] = {
    ...parent,
    childSurfaceIds: [...parent.childSurfaceIds, args.childSurfaceId],
  }
  nextThreadSurfaces.push(childSurface)

  return {
    state: {
      ...state,
      threadSurfaces: nextThreadSurfaces,
      runs: [...state.runs, childRun],
    },
    childSurface,
    childRun,
  }
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
    },
    replacedRun,
    run,
  }
}

export function completeRun(state: ThreadSurfaceState, args: CompleteRunArgs) {
  return mutateRun(state, args.runId, run => ({
    ...run,
    runStatus: args.runStatus,
    endedAt: args.endedAt,
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

  for (const sourceThreadSurfaceId of args.sourceThreadSurfaceIds) {
    if (!state.threadSurfaces.some(surface => surface.id === sourceThreadSurfaceId)) {
      throw new InvalidThreadSurfaceMergeError(`Merge source lane must reference an existing thread surface: ${sourceThreadSurfaceId}`)
    }
    if (sourceThreadSurfaceId === args.destinationThreadSurfaceId) {
      throw new InvalidThreadSurfaceMergeError('Merge source lanes cannot include the destination lane')
    }
  }

  const mergeEvent: MergeEvent = {
    id: args.mergeId,
    runId: args.runId,
    destinationThreadSurfaceId: args.destinationThreadSurfaceId,
    sourceThreadSurfaceIds: [...args.sourceThreadSurfaceIds],
    mergeKind: args.mergeKind,
    executionIndex: args.executionIndex,
    createdAt: args.createdAt,
    ...(args.summary ? { summary: args.summary } : {}),
  }

  return {
    state: {
      ...state,
      mergeEvents: [...state.mergeEvents, mergeEvent],
    },
    mergeEvent,
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
}: {
  runId: string
  threadSurfaceId: string
  startedAt: string
  executionIndex?: number
}): RunScope {
  return {
    id: runId,
    threadSurfaceId,
    runStatus: 'running',
    startedAt,
    endedAt: null,
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
    },
    run,
  }
}

function compareRunTimestamps(run: RunScope): number {
  return Date.parse(run.endedAt ?? run.startedAt)
}
