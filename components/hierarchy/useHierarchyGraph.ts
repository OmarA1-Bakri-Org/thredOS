import { projectHierarchy, resolveDefaultDisplayRun } from '@/lib/thread-surfaces/projections'
import type { RunStatus, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import type { HierarchyProjectionNode } from '@/lib/thread-surfaces/projections'

export const HierarchyZoomBandValues = ['macro', 'meso', 'micro'] as const
export type HierarchyZoomBand = typeof HierarchyZoomBandValues[number]

export type HierarchyVisibleField =
  | 'surfaceLabel'
  | 'displayRunStatus'
  | 'surfaceDescription'
  | 'role'
  | 'runSummary'
  | 'childCount'
  | 'runNotes'
  | 'runDiscussion'

export interface HierarchyMetadataDisclosure {
  zoomBand: HierarchyZoomBand
  visibleFields: HierarchyVisibleField[]
}

export interface HierarchyRunContext {
  selectedRunId: string | null
  defaultRunId: string | null
  displayRunId: string | null
  displayRunStatus: RunStatus | null
}

export interface HierarchyClickTarget {
  threadSurfaceId: string
  runId: string | null
  runSelection: 'selected' | 'default' | 'none'
}

export interface HierarchyNodeMetadata {
  childCount: number
  surfaceDescription: string | null
  role: string | null
  runSummary: string | null
  runNotes: string | null
  runDiscussion: string | null
  displayRunStatus: RunStatus | null
}

export interface HierarchyGraphNode {
  id: string
  parentSurfaceId: string | null
  depth: number
  surfaceLabel: string
  childSurfaceIds: string[]
  metadata: HierarchyNodeMetadata
  runContext: HierarchyRunContext
  clickTarget: HierarchyClickTarget
}

export interface HierarchyGraphEdge {
  source: string
  target: string
}

export interface HierarchyGraph {
  nodes: HierarchyGraphNode[]
  edges: HierarchyGraphEdge[]
  zoomBand: HierarchyZoomBand
  metadataDisclosure: HierarchyMetadataDisclosure
}

export interface UseHierarchyGraphArgs {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  zoom: number
  selectedRunIdBySurfaceId?: Record<string, string | undefined>
}

export function useHierarchyGraph({
  threadSurfaces,
  runs,
  zoom,
  selectedRunIdBySurfaceId = {},
}: UseHierarchyGraphArgs): HierarchyGraph {
  const hierarchy = projectHierarchy(threadSurfaces)
  const zoomBand = deriveHierarchyZoomBand(zoom)
  const metadataDisclosure = deriveHierarchyMetadataDisclosure(zoomBand)
  const runsBySurfaceId = groupRunsBySurfaceId(runs)
  const surfacesById = new Map(threadSurfaces.map(surface => [surface.id, surface]))

  return {
    nodes: hierarchy.nodes.map(node =>
      buildGraphNode(node, surfacesById, runsBySurfaceId, selectedRunIdBySurfaceId),
    ),
    edges: hierarchy.edges,
    zoomBand,
    metadataDisclosure,
  }
}

function buildGraphNode(
  node: HierarchyProjectionNode,
  surfacesById: Map<string, ThreadSurface>,
  runsBySurfaceId: Map<string, RunScope[]>,
  selectedRunIdBySurfaceId: Record<string, string | undefined>,
): HierarchyGraphNode {
  const surfaceRuns = runsBySurfaceId.get(node.id) ?? []
  const defaultRun = resolveDefaultDisplayRun(surfaceRuns)
  const selectedRunId = selectedRunIdBySurfaceId[node.id] ?? null
  const selectedRun = selectedRunId ? surfaceRuns.find(run => run.id === selectedRunId) ?? null : null
  const displayRun = selectedRun ?? defaultRun ?? null
  const surface = surfacesById.get(node.id)

  return {
    ...node,
    metadata: buildNodeMetadata(surface, displayRun, node.childSurfaceIds.length),
    runContext: buildRunContext(selectedRunId, defaultRun, displayRun),
    clickTarget: buildClickTarget(node.id, displayRun, selectedRun, defaultRun),
  }
}

function buildNodeMetadata(
  surface: ThreadSurface | undefined,
  displayRun: RunScope | null,
  childCount: number,
): HierarchyNodeMetadata {
  return {
    childCount,
    surfaceDescription: surface?.surfaceDescription ?? null,
    role: surface?.role ?? null,
    runSummary: displayRun?.runSummary ?? null,
    runNotes: displayRun?.runNotes ?? null,
    runDiscussion: displayRun?.runDiscussion ?? null,
    displayRunStatus: displayRun?.runStatus ?? null,
  }
}

function buildRunContext(
  selectedRunId: string | null,
  defaultRun: RunScope | undefined,
  displayRun: RunScope | null,
): HierarchyRunContext {
  return {
    selectedRunId,
    defaultRunId: defaultRun?.id ?? null,
    displayRunId: displayRun?.id ?? null,
    displayRunStatus: displayRun?.runStatus ?? null,
  }
}

function buildClickTarget(
  threadSurfaceId: string,
  displayRun: RunScope | null,
  selectedRun: RunScope | null,
  defaultRun: RunScope | undefined,
): HierarchyClickTarget {
  return {
    threadSurfaceId,
    runId: displayRun?.id ?? null,
    runSelection: selectedRun ? 'selected' : defaultRun ? 'default' : 'none',
  }
}

function deriveHierarchyZoomBand(zoom: number): HierarchyZoomBand {
  if (zoom >= 1.5) return 'micro'
  if (zoom >= 0.9) return 'meso'
  return 'macro'
}

const ZOOM_BAND_FIELDS: Record<HierarchyZoomBand, HierarchyVisibleField[]> = {
  macro: ['surfaceLabel', 'displayRunStatus'],
  meso: ['surfaceLabel', 'displayRunStatus', 'surfaceDescription', 'role', 'runSummary', 'childCount'],
  micro: [
    'surfaceLabel',
    'displayRunStatus',
    'surfaceDescription',
    'role',
    'runSummary',
    'childCount',
    'runNotes',
    'runDiscussion',
  ],
}

function deriveHierarchyMetadataDisclosure(zoomBand: HierarchyZoomBand): HierarchyMetadataDisclosure {
  return {
    zoomBand,
    visibleFields: ZOOM_BAND_FIELDS[zoomBand],
  }
}

function groupRunsBySurfaceId(runs: RunScope[]): Map<string, RunScope[]> {
  const groupedRuns = new Map<string, RunScope[]>()

  for (const run of runs) {
    const surfaceRuns = groupedRuns.get(run.threadSurfaceId)
    if (surfaceRuns) {
      surfaceRuns.push(run)
      continue
    }
    groupedRuns.set(run.threadSurfaceId, [run])
  }

  return groupedRuns
}
