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
  const existingRoot = state.threadSurfaces.find(s => s.id === ROOT_ID)
  if (existingRoot) {
    if (existingRoot.surfaceLabel === sequenceLabel) return state

    return {
      ...state,
      threadSurfaces: state.threadSurfaces.map(surface =>
        surface.id === ROOT_ID
          ? { ...surface, surfaceLabel: sequenceLabel }
          : surface,
      ),
    }
  }

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
  const existingSurface = state.threadSurfaces.find(s => s.id === surfaceId)
  if (existingSurface) {
    if (existingSurface.surfaceLabel === stepName) return state

    return {
      ...state,
      threadSurfaces: state.threadSurfaces.map(surface =>
        surface.id === surfaceId
          ? { ...surface, surfaceLabel: stepName }
          : surface,
      ),
    }
  }

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
 * Collect a surface id and all its descendant surface ids recursively.
 */
function collectDescendantIds(surfaces: ThreadSurface[], rootId: string): Set<string> {
  const ids = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.pop()!
    ids.add(id)
    const surface = surfaces.find(s => s.id === id)
    if (surface) {
      for (const childId of surface.childSurfaceIds) {
        if (!ids.has(childId)) queue.push(childId)
      }
    }
  }
  return ids
}

/**
 * Remove a step's thread surface, all its descendant surfaces, and clean up
 * the parent root's childSurfaceIds. Also removes any runs and runEvents
 * targeting the removed surfaces. Returns state unchanged if the surface
 * doesn't exist (idempotent).
 */
export function removeStepSurface(
  state: ThreadSurfaceState,
  stepId: string,
): ThreadSurfaceState {
  const surfaceId = stepSurfaceId(stepId)
  if (!state.threadSurfaces.some(s => s.id === surfaceId)) return state

  const idsToRemove = collectDescendantIds(state.threadSurfaces, surfaceId)

  return {
    ...state,
    threadSurfaces: state.threadSurfaces
      .filter(s => !idsToRemove.has(s.id))
      .map(s => {
        // Clean removed ids from any surviving surface's childSurfaceIds
        const pruned = s.childSurfaceIds.filter(id => !idsToRemove.has(id))
        return pruned.length !== s.childSurfaceIds.length
          ? { ...s, childSurfaceIds: pruned }
          : s
      }),
    runs: state.runs.filter(r => !idsToRemove.has(r.threadSurfaceId)),
    runEvents: state.runEvents.filter(e => !idsToRemove.has(e.threadSurfaceId)),
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
 * - Ensures the root surface exists and has the current sequence label
 * - Creates missing surfaces for steps that exist in the sequence
 * - Removes orphaned surfaces for steps no longer in the sequence
 * - Refreshes step surface labels from the sequence source of truth
 *
 * May return an updated state even when `steps` is empty (e.g., after a root-label
 * refresh or other side-effect-driven updates).
 *
 * @param state - The current thread surface state
 * @param steps - Array of step objects from the sequence
 * @param sequenceLabel - The current sequence name/label
 * @param now - ISO timestamp for new surface creation
 * @returns Updated ThreadSurfaceState (may be the same reference if unchanged)
 */
export function reconcileSurfacesWithSequence(
  state: ThreadSurfaceState,
  steps: Array<{ id: string; name: string }>,
  sequenceLabel: string,
  now: string,
): ThreadSurfaceState {
  let result = state

  if (result.threadSurfaces.some(surface => surface.id === ROOT_ID)) {
    result = ensureRootSurface(result, sequenceLabel, now)
  }

  if (steps.length === 0) return result

  // Create missing surfaces and refresh step labels from the sequence source of truth.
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