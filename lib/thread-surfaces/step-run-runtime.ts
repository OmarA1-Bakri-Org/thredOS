import type { Step } from '@/lib/sequence/schema'
import { InvalidThreadSurfaceMergeError } from '@/lib/errors'
import { completeRun, createChildThreadSurfaceRun, createReplacementRun, findLatestRunForSurface, recordChildAgentSpawnEvent, recordMergeEvent } from '@/lib/thread-surfaces/mutations'
import type { ThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'
import { deriveStepThreadSurfaceId, ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { deriveMergeEventForSuccessfulStep } from '@/lib/thread-surfaces/merge-runtime'

export interface StepRunScope {
  runId: string
  startedAt: string
  executionIndex: number
  threadSurfaceId: string
}

interface BeginStepRunOptions {
  now: string
  nextRunId: string
  executionIndex?: number
}

interface FinalizeStepRunOptions {
  step: Step
  stepRun: StepRunScope | null
  success: boolean
  endedAt: string
  runtimeEvents: RuntimeDelegationEvent[]
  nextRunId: () => string
  nextEventId: () => string
  nextMergeId: () => string
}

export function beginStepRunIfSurfaceExists(
  state: ThreadSurfaceState,
  step: Step,
  opts: BeginStepRunOptions,
): { state: ThreadSurfaceState; stepRun: StepRunScope | null } {
  const threadSurfaceId = deriveStepThreadSurfaceId(step.id)
  const existingSurface = state.threadSurfaces.find(surface => surface.id === threadSurfaceId) ?? null

  if (existingSurface == null) {
    return { state, stepRun: null }
  }

  const executionIndex = opts.executionIndex ?? state.runs.length + 1
  const nextState = createReplacementRun(state, {
    threadSurfaceId,
    runId: opts.nextRunId,
    startedAt: opts.now,
    executionIndex,
  }).state

  return {
    state: nextState,
    stepRun: {
      runId: opts.nextRunId,
      startedAt: opts.now,
      executionIndex,
      threadSurfaceId,
    },
  }
}

export function finalizeStepRunWithRuntimeEvents(
  state: ThreadSurfaceState,
  opts: FinalizeStepRunOptions,
): { state: ThreadSurfaceState; stepRun: StepRunScope | null } {
  let nextState = state
  let effectiveStepRun = opts.stepRun

  if (effectiveStepRun == null && opts.success && opts.runtimeEvents.length > 0) {
    const materialized = materializeStepRunForRuntimeEvents(nextState, opts.step, {
      now: opts.endedAt,
      nextRunId: opts.nextRunId(),
    })
    nextState = materialized.state
    effectiveStepRun = materialized.stepRun
  }

  if (effectiveStepRun == null) {
    return { state: nextState, stepRun: null }
  }

  nextState = completeRun(nextState, {
    runId: effectiveStepRun.runId,
    runStatus: opts.success ? 'successful' : 'failed',
    endedAt: opts.endedAt,
    runSummary: opts.success ? `step:${opts.step.id}` : `step:${opts.step.id}:failed`,
  }).state

  if (opts.success && opts.runtimeEvents.length > 0) {
    nextState = persistRuntimeDelegationEvents(nextState, effectiveStepRun, opts.step, opts.runtimeEvents, {
      nextRunId: opts.nextRunId,
      nextEventId: opts.nextEventId,
      nextMergeId: opts.nextMergeId,
    })
  }

  if (opts.success) {
    nextState = deriveFusionMergeIfApplicable(nextState, opts.step, effectiveStepRun, opts.nextMergeId)
  }

  return { state: nextState, stepRun: effectiveStepRun }
}

function materializeStepRunForRuntimeEvents(
  state: ThreadSurfaceState,
  step: Step,
  opts: { now: string; nextRunId: string },
): { state: ThreadSurfaceState; stepRun: StepRunScope } {
  const executionIndex = state.runs.length + 1
  const threadSurfaceId = deriveStepThreadSurfaceId(step.id)
  const existingSurface = state.threadSurfaces.find(surface => surface.id === threadSurfaceId) ?? null

  const nextState = existingSurface
    ? createReplacementRun(state, {
        threadSurfaceId,
        runId: opts.nextRunId,
        startedAt: opts.now,
        executionIndex,
      }).state
    : createChildThreadSurfaceRun(state, {
        parentSurfaceId: resolveParentSurfaceId(state, step),
        parentAgentNodeId: step.id,
        childSurfaceId: threadSurfaceId,
        childSurfaceLabel: step.name,
        createdAt: opts.now,
        runId: opts.nextRunId,
        startedAt: opts.now,
        executionIndex,
      }).state

  return {
    state: nextState,
    stepRun: {
      runId: opts.nextRunId,
      startedAt: opts.now,
      executionIndex,
      threadSurfaceId,
    },
  }
}

function persistRuntimeDelegationEvents(
  state: ThreadSurfaceState,
  stepRun: StepRunScope,
  step: Step,
  runtimeEvents: RuntimeDelegationEvent[],
  ids: {
    nextRunId: () => string
    nextEventId: () => string
    nextMergeId: () => string
  },
): ThreadSurfaceState {
  let nextState = state

  for (const event of runtimeEvents) {
    if (event.eventType === 'spawn-child') {
      const parentThreadSurfaceId = event.parentStepId
        ? deriveStepThreadSurfaceId(event.parentStepId)
        : stepRun.threadSurfaceId
      const childThreadSurfaceId = deriveStepThreadSurfaceId(event.childStepId)
      const createdAt = event.createdAt
      const childSurfaceExists = nextState.threadSurfaces.some(surface => surface.id === childThreadSurfaceId)

      if (!childSurfaceExists) {
        nextState = createChildThreadSurfaceRun(nextState, {
          parentSurfaceId: parentThreadSurfaceId,
          parentAgentNodeId: event.childStepId,
          childSurfaceId: childThreadSurfaceId,
          childSurfaceLabel: event.childLabel,
          createdAt,
          runId: ids.nextRunId(),
          startedAt: createdAt,
          executionIndex: nextState.runs.length + 1,
        }).state
      } else if (childThreadSurfaceId !== stepRun.threadSurfaceId) {
        nextState = createReplacementRun(nextState, {
          threadSurfaceId: childThreadSurfaceId,
          runId: ids.nextRunId(),
          startedAt: createdAt,
          executionIndex: nextState.runs.length + 1,
        }).state
      }

      nextState = recordChildAgentSpawnEvent(nextState, {
        eventId: ids.nextEventId(),
        runId: stepRun.runId,
        threadSurfaceId: parentThreadSurfaceId,
        childThreadSurfaceId,
        parentThreadSurfaceId,
        createdAt,
      }).state
      continue
    }

    nextState = recordMergeEvent(nextState, {
      mergeId: ids.nextMergeId(),
      runId: stepRun.runId,
      destinationThreadSurfaceId: deriveStepThreadSurfaceId(event.destinationStepId),
      sourceThreadSurfaceIds: event.sourceStepIds.map(sourceStepId => deriveStepThreadSurfaceId(sourceStepId)),
      sourceRunIds: event.sourceStepIds.map(sourceStepId => {
        const sourceThreadSurfaceId = deriveStepThreadSurfaceId(sourceStepId)
        const sourceRunId = findLatestRunForSurface(nextState.runs, sourceThreadSurfaceId)?.id
        if (!sourceRunId) {
          throw new InvalidThreadSurfaceMergeError(`Merge source run must exist for lane ${sourceThreadSurfaceId}`)
        }
        return sourceRunId
      }),
      mergeKind: event.mergeKind,
      executionIndex: stepRun.executionIndex,
      createdAt: event.createdAt,
      summary: event.summary ?? step.name,
    }).state
  }

  return nextState
}

function deriveFusionMergeIfApplicable(
  state: ThreadSurfaceState,
  step: Step,
  stepRun: StepRunScope,
  nextMergeId: () => string,
): ThreadSurfaceState {
  const stepThreadSurfaceIds: Record<string, string> = {
    [step.id]: deriveStepThreadSurfaceId(step.id),
  }
  for (const depId of step.depends_on) {
    stepThreadSurfaceIds[depId] = deriveStepThreadSurfaceId(depId)
  }

  const mergeEvent = deriveMergeEventForSuccessfulStep({
    step,
    threadSurfaces: state.threadSurfaces,
    stepThreadSurfaceIds,
    runId: stepRun.runId,
    mergeId: nextMergeId(),
    executionIndex: stepRun.executionIndex,
    createdAt: stepRun.startedAt,
    summary: step.name,
  })

  if (mergeEvent == null) {
    return state
  }

  const sourceRunIds = mergeEvent.sourceThreadSurfaceIds.map(sourceThreadSurfaceId => {
    const sourceRun = findLatestRunForSurface(state.runs, sourceThreadSurfaceId)
    if (!sourceRun) {
      throw new InvalidThreadSurfaceMergeError(`Merge source run must exist for lane ${sourceThreadSurfaceId}`)
    }
    return sourceRun.id
  })

  return recordMergeEvent(state, {
    mergeId: mergeEvent.id,
    runId: mergeEvent.runId,
    destinationThreadSurfaceId: mergeEvent.destinationThreadSurfaceId,
    sourceThreadSurfaceIds: mergeEvent.sourceThreadSurfaceIds,
    sourceRunIds,
    mergeKind: mergeEvent.mergeKind,
    executionIndex: mergeEvent.executionIndex,
    createdAt: mergeEvent.createdAt,
    summary: mergeEvent.summary,
  }).state
}

function resolveParentSurfaceId(state: ThreadSurfaceState, step: Step): string {
  if (step.watchdog_for) {
    const watchedSurfaceId = deriveStepThreadSurfaceId(step.watchdog_for)
    if (state.threadSurfaces.some(surface => surface.id === watchedSurfaceId)) {
      return watchedSurfaceId
    }
  }

  return ROOT_THREAD_SURFACE_ID
}
