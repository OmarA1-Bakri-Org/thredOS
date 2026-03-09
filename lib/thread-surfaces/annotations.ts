import { resolveDefaultDisplayRun } from './projections'
import type { RunScope, ThreadSurface } from './types'

export interface SurfaceIdentity {
  surfaceId: string
  surfaceLabel: string
  surfaceDescription: string | null
  role: string | null
}

export interface SurfaceAnnotationRunContext {
  selectedRunId: string | null
  defaultRunId: string | null
  displayRunId: string | null
  runSelection: 'selected' | 'default' | 'none'
}

export interface SurfaceAnnotationPayload {
  runSummary: string | null
  runNotes: string | null
  runDiscussion: string | null
}

export interface SurfaceAnnotations {
  surface: SurfaceIdentity
  runContext: SurfaceAnnotationRunContext
  annotations: SurfaceAnnotationPayload
}

export interface ResolveSurfaceAnnotationsArgs {
  surface: ThreadSurface
  runs: RunScope[]
  selectedRunId?: string
}

export function resolveSurfaceAnnotations({
  surface,
  runs,
  selectedRunId,
}: ResolveSurfaceAnnotationsArgs): SurfaceAnnotations {
  const surfaceRuns = runs.filter(run => run.threadSurfaceId === surface.id)
  const defaultRun = resolveDefaultDisplayRun(surfaceRuns) ?? null
  const selectedRun = selectedRunId ? surfaceRuns.find(run => run.id === selectedRunId) ?? null : null
  const displayRun = selectedRun ?? defaultRun

  return {
    surface: {
      surfaceId: surface.id,
      surfaceLabel: surface.surfaceLabel,
      surfaceDescription: surface.surfaceDescription ?? null,
      role: surface.role ?? null,
    },
    runContext: {
      selectedRunId: selectedRun?.id ?? null,
      defaultRunId: defaultRun?.id ?? null,
      displayRunId: displayRun?.id ?? null,
      runSelection: selectedRun ? 'selected' : defaultRun ? 'default' : 'none',
    },
    annotations: {
      runSummary: displayRun?.runSummary ?? null,
      runNotes: displayRun?.runNotes ?? null,
      runDiscussion: displayRun?.runDiscussion ?? null,
    },
  }
}
