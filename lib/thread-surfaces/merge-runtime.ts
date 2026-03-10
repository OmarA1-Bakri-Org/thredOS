import { InvalidThreadSurfaceMergeError } from '@/lib/errors'
import type { Step } from '@/lib/sequence/schema'
import type { MergeEvent, ThreadSurface } from './types'

export interface DeriveMergeEventForSuccessfulStepArgs {
  step: Step
  threadSurfaces: ThreadSurface[]
  stepThreadSurfaceIds: Record<string, string>
  runId: string
  mergeId: string
  executionIndex: number
  createdAt: string
  summary?: string
}

export function deriveMergeEventForSuccessfulStep({
  step,
  threadSurfaces,
  stepThreadSurfaceIds,
  runId,
  mergeId,
  executionIndex,
  createdAt,
  summary,
}: DeriveMergeEventForSuccessfulStepArgs): MergeEvent | null {
  if (!step.fusion_synth || step.depends_on.length === 0) {
    return null
  }

  const destinationThreadSurfaceId = stepThreadSurfaceIds[step.id]
  if (!destinationThreadSurfaceId) {
    throw new InvalidThreadSurfaceMergeError(`Merge destination lane must reference an existing thread surface: ${step.id}`)
  }
  if (!threadSurfaces.some(surface => surface.id === destinationThreadSurfaceId)) {
    throw new InvalidThreadSurfaceMergeError(`Merge destination lane must reference an existing thread surface: ${destinationThreadSurfaceId}`)
  }

  const sourceThreadSurfaceIds = step.depends_on.map(stepId => {
    const sourceThreadSurfaceId = stepThreadSurfaceIds[stepId]
    if (!sourceThreadSurfaceId) {
      throw new InvalidThreadSurfaceMergeError(`Merge source lane must reference an existing thread surface: ${stepId}`)
    }
    if (!threadSurfaces.some(surface => surface.id === sourceThreadSurfaceId)) {
      throw new InvalidThreadSurfaceMergeError(`Merge source lane must reference an existing thread surface: ${sourceThreadSurfaceId}`)
    }
    if (sourceThreadSurfaceId === destinationThreadSurfaceId) {
      throw new InvalidThreadSurfaceMergeError('Merge source lanes cannot include the destination lane')
    }
    return sourceThreadSurfaceId
  })

  return {
    id: mergeId,
    runId,
    destinationThreadSurfaceId,
    sourceThreadSurfaceIds,
    mergeKind: sourceThreadSurfaceIds.length === 1 ? 'single' : 'block',
    executionIndex,
    createdAt,
    ...(summary ? { summary } : {}),
  }
}
