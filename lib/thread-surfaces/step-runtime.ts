import { createChildThreadSurfaceRun, createReplacementRun } from './mutations'
import type { ThreadSurfaceState } from './repository'
import type { RunScope, ThreadSurface } from './types'

export interface StepRuntimeStep {
  id: string
  name: string
  orchestrator?: string
}

export interface ResolveStepRuntimeStateArgs {
  state: ThreadSurfaceState
  step: StepRuntimeStep
  runId: string
  startedAt: string
  executionIndex?: number
  rootSurfaceId?: string
  createdAt?: string
}

export interface StepRuntimeResolution {
  state: ThreadSurfaceState
  threadSurfaceId: string
  parentSurfaceId: string
  createdSurface: boolean
  surface: ThreadSurface
  run: RunScope
  replacedRun: RunScope | null
}

const DEFAULT_ROOT_SURFACE_ID = 'thread-root'

export function deriveStepThreadSurfaceId(stepId: string): string {
  return `thread-step-${stepId}`
}

export function resolveStepParentSurfaceId(step: Pick<StepRuntimeStep, 'orchestrator'>, rootSurfaceId = DEFAULT_ROOT_SURFACE_ID): string {
  return step.orchestrator ? deriveStepThreadSurfaceId(step.orchestrator) : rootSurfaceId
}

export function resolveStepRuntimeState({
  state,
  step,
  runId,
  startedAt,
  executionIndex,
  rootSurfaceId = DEFAULT_ROOT_SURFACE_ID,
  createdAt = startedAt,
}: ResolveStepRuntimeStateArgs): StepRuntimeResolution {
  const threadSurfaceId = deriveStepThreadSurfaceId(step.id)
  const parentSurfaceId = resolveStepParentSurfaceId(step, rootSurfaceId)
  const existingSurface = state.threadSurfaces.find(surface => surface.id === threadSurfaceId) ?? null

  if (existingSurface) {
    const replacement = createReplacementRun(state, {
      threadSurfaceId,
      runId,
      startedAt,
      executionIndex,
    })

    return {
      state: replacement.state,
      threadSurfaceId,
      parentSurfaceId,
      createdSurface: false,
      surface: existingSurface,
      run: replacement.run,
      replacedRun: replacement.replacedRun,
    }
  }

  const created = createChildThreadSurfaceRun(state, {
    parentSurfaceId,
    parentAgentNodeId: step.id,
    childSurfaceId: threadSurfaceId,
    childSurfaceLabel: step.name,
    createdAt,
    runId,
    startedAt,
    executionIndex,
  })

  return {
    state: created.state,
    threadSurfaceId,
    parentSurfaceId,
    createdSurface: true,
    surface: created.childSurface,
    run: created.childRun,
    replacedRun: null,
  }
}
