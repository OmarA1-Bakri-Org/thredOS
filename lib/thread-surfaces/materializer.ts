import type { ThreadSurfaceState } from './repository'
import type { ThreadSurface } from './types'

const ROOT_ID = 'thread-root'

function stepSurfaceId(stepId: string): string {
  return `thread-${stepId}`
}

/**
 * Ensure a root thread surface exists in state. Creates one with depth 0
 * and the given sequence label if absent. Returns state unchanged if root
 * already exists (idempotent).
 */
export function ensureRootSurface(
  state: ThreadSurfaceState,
  sequenceLabel: string,
  now: string,
): ThreadSurfaceState {
  if (state.threadSurfaces.some(s => s.id === ROOT_ID)) return state

  const root: ThreadSurface = {
    id: ROOT_ID,
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: sequenceLabel,
    role: 'orchestrator',
    createdAt: now,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  }
  return { ...state, threadSurfaces: [...state.threadSurfaces, root] }
}

/**
 * Materialize a thread surface for a step as a child of the root surface.
 * Auto-creates the root surface if missing. Returns state unchanged if the
 * step surface already exists (idempotent).
 */
export function materializeStepSurface(
  state: ThreadSurfaceState,
  stepId: string,
  stepName: string,
  sequenceLabel: string,
  now: string,
): ThreadSurfaceState {
  state = ensureRootSurface(state, sequenceLabel, now)

  const surfaceId = stepSurfaceId(stepId)
  if (state.threadSurfaces.some(s => s.id === surfaceId)) return state

  const surface: ThreadSurface = {
    id: surfaceId,
    parentSurfaceId: ROOT_ID,
    parentAgentNodeId: stepId,
    depth: 1,
    surfaceLabel: stepName,
    role: 'worker',
    createdAt: now,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  }

  const threadSurfaces = state.threadSurfaces.map(s =>
    s.id === ROOT_ID
      ? { ...s, childSurfaceIds: [...s.childSurfaceIds, surfaceId] }
      : s,
  )

  return { ...state, threadSurfaces: [...threadSurfaces, surface] }
}

/**
 * Remove a step's thread surface and clean up the parent root's
 * childSurfaceIds. Also removes any runs and runEvents targeting the
 * removed surface. Returns state unchanged if the surface doesn't exist
 * (idempotent).
 */
export function removeStepSurface(
  state: ThreadSurfaceState,
  stepId: string,
): ThreadSurfaceState {
  const surfaceId = stepSurfaceId(stepId)
  if (!state.threadSurfaces.some(s => s.id === surfaceId)) return state

  return {
    ...state,
    threadSurfaces: state.threadSurfaces
      .filter(s => s.id !== surfaceId)
      .map(s =>
        s.id === ROOT_ID
          ? { ...s, childSurfaceIds: s.childSurfaceIds.filter(id => id !== surfaceId) }
          : s,
      ),
    runs: state.runs.filter(r => r.threadSurfaceId !== surfaceId),
    runEvents: state.runEvents.filter(e => e.threadSurfaceId !== surfaceId),
  }
}

/**
 * Batch-create thread surfaces for multiple steps. Each step gets a child
 * surface under the root. Idempotent — existing surfaces are not duplicated.
 */
export function materializeBulkStepSurfaces(
  state: ThreadSurfaceState,
  steps: Array<{ id: string; name: string }>,
  sequenceLabel: string,
  now: string,
): ThreadSurfaceState {
  for (const step of steps) {
    state = materializeStepSurface(state, step.id, step.name, sequenceLabel, now)
  }
  return state
}

/**
 * Return a fresh empty ThreadSurfaceState — used on sequence reset.
 */
export function clearAllSurfaces(): ThreadSurfaceState {
  return { version: 1, threadSurfaces: [], runs: [], mergeEvents: [], runEvents: [] }
}

/**
 * Reconcile thread surfaces with the current sequence steps.
 * - Creates missing surfaces for steps that exist in the sequence
 * - Removes orphaned surfaces for steps no longer in the sequence
 *
 * Returns state unchanged if steps is empty (nothing to reconcile against).
 */
export function reconcileSurfacesWithSequence(
  state: ThreadSurfaceState,
  steps: Array<{ id: string; name: string }>,
  sequenceLabel: string,
  now: string,
): ThreadSurfaceState {
  if (steps.length === 0) return state

  let result = state

  // Create missing surfaces
  for (const step of steps) {
    result = materializeStepSurface(result, step.id, step.name, sequenceLabel, now)
  }

  // Remove surfaces for steps no longer in the sequence
  const stepSurfaceIds = new Set(steps.map(s => stepSurfaceId(s.id)))
  const orphaned = result.threadSurfaces.filter(
    s => s.parentSurfaceId === ROOT_ID && !stepSurfaceIds.has(s.id),
  )
  for (const orphan of orphaned) {
    const stepId = orphan.parentAgentNodeId ?? orphan.id.replace('thread-', '')
    result = removeStepSurface(result, stepId)
  }

  return result
}
