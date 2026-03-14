import { readFileSync } from 'node:fs'
import { describe, expect, mock, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

/* ── mock @/lib/ui/store with functional openLaneViewForThreadSurface ── */
const uiState: Record<string, unknown> = {
  productEntry: null,
  setProductEntry: () => {},
  selectedNodeId: null,
  setSelectedNodeId: () => {},
  leftRailOpen: false,
  toggleLeftRail: () => {},
  closeLeftRail: () => {},
  inspectorOpen: false,
  toggleInspector: () => {},
  closeInspector: () => {},
  chatOpen: false,
  toggleChat: () => {},
  searchQuery: '',
  setSearchQuery: () => {},
  minimapVisible: true,
  toggleMinimap: () => {},
  viewMode: 'hierarchy' as string,
  setViewMode: (mode: string) => { uiState.viewMode = mode },
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (id: string | null) => { uiState.selectedThreadSurfaceId = id },
  selectedRunId: null as string | null,
  setSelectedRunId: (id: string | null) => { uiState.selectedRunId = id },
  hierarchyViewport: { x: 0, y: 0, zoom: 1 },
  setHierarchyViewport: () => {},
  laneFocusThreadSurfaceId: null as string | null,
  setLaneFocusThreadSurfaceId: () => {},
  laneBoardState: { scrollLeft: 0, focusedThreadSurfaceId: null as string | null, focusedRunId: null as string | null },
  setLaneBoardState: () => {},
  openLaneViewForThreadSurface: (threadSurfaceId: string, runId: string | null = null) => {
    uiState.viewMode = 'lanes'
    uiState.selectedThreadSurfaceId = threadSurfaceId
    uiState.selectedRunId = runId
    uiState.laneFocusThreadSurfaceId = threadSurfaceId
    uiState.laneBoardState = {
      ...(uiState.laneBoardState as Record<string, unknown>),
      focusedThreadSurfaceId: threadSurfaceId,
      focusedRunId: runId,
    }
  },
  createDialogOpen: false,
  createDialogKind: 'step',
  openCreateDialog: () => {},
  closeCreateDialog: () => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof uiState) => unknown) => selector(uiState),
    {
      setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch),
      getState: () => uiState,
    },
  ),
}))

const { resolveThreadSurfaceFocusedDetail } = await import('@/components/canvas/threadSurfaceFocus')
const { resolveThreadSurfaceCanvasData } = await import('@/components/canvas/threadSurfaceScaffold')
const { HierarchyView } = await import('@/components/hierarchy/HierarchyView')
const { useHierarchyGraph } = await import('@/components/hierarchy/useHierarchyGraph')
const { createLaneBoardModel } = await import('@/components/lanes/useLaneBoard')
const {
  unwrapThreadMergesResponse,
  unwrapThreadRunsResponse,
  unwrapThreadSurfacesResponse,
} = await import('@/lib/ui/api')
const { useUIStore } = await import('@/lib/ui/store')
const { contentCreatorWorkflow, resolveWorkflowReferenceStep } = await import('@/lib/workflows')

type ButtonElement = ReactElement<{
  children?: ReactNode
  onClick?: () => void
  'data-thread-surface-id'?: string
}>

type MultiThreadFixture = {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  laneRunIds: string[]
}

const multiThreadState = JSON.parse(
  readFileSync(new URL('../../test/fixtures/thread-surfaces/multi-thread-state.json', import.meta.url), 'utf8'),
) as MultiThreadFixture

const legacyStatus: SequenceStatus = {
  name: 'Legacy Sequence',
  version: '1.0',
  steps: [],
  gates: [],
  summary: {
    total: 0,
    ready: 0,
    running: 0,
    done: 0,
    failed: 0,
    blocked: 0,
    needsReview: 0,
  },
}

function collectButtons(node: ReactNode, acc: ButtonElement[] = []): ButtonElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    try {
      collectButtons(render(element.props), acc)
    } catch {
      // Skip components that require React's render pipeline (e.g. hooks)
    }
    return acc
  }

  if (element.type === 'button') {
    acc.push(element as ButtonElement)
  }

  collectButtons(element.props.children, acc)
  return acc
}

describe('thread surface canvas flow', () => {
  test('prefers real thread-surface data over the legacy scaffold and opens lane context from hierarchy clicks', () => {
    useUIStore.setState({
      viewMode: 'hierarchy',
      selectedThreadSurfaceId: null,
      selectedRunId: null,
      laneFocusThreadSurfaceId: null,
      laneBoardState: {
        scrollLeft: 0,
        focusedThreadSurfaceId: null,
        focusedRunId: null,
      },
    })

    const threadSurfaceData = resolveThreadSurfaceCanvasData({
      status: legacyStatus,
      threadSurfaces: unwrapThreadSurfacesResponse({ threadSurfaces: multiThreadState.threadSurfaces }),
      runs: unwrapThreadRunsResponse({ runs: multiThreadState.runs }),
      mergeEvents: unwrapThreadMergesResponse({ mergeEvents: multiThreadState.mergeEvents }),
    })

    expect(threadSurfaceData.source).toBe('api')
    expect(threadSurfaceData.threadSurfaces).toHaveLength(5)
    expect(threadSurfaceData.threadSurfaces[0]?.surfaceLabel).toBe('Master')

    const hierarchyGraph = useHierarchyGraph({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      zoom: 1,
    })

    const view = HierarchyView({
      nodes: hierarchyGraph.nodes.map(node => ({
        id: node.id,
        surfaceLabel: node.surfaceLabel,
        depth: node.depth,
        childCount: node.metadata.childCount,
        runStatus: node.metadata.displayRunStatus,
        runSummary: node.metadata.runSummary,
        clickTarget: {
          threadSurfaceId: node.clickTarget.threadSurfaceId,
          runId: node.clickTarget.runId,
        },
      })),
      selectedThreadSurfaceId: null,
      onOpenLane: useUIStore.getState().openLaneViewForThreadSurface,
    })

    const synthesisButton = collectButtons(view).find(button => button.props['data-thread-surface-id'] === 'thread-synthesis')
    expect(synthesisButton).toBeDefined()

    synthesisButton?.props.onClick?.()

    expect(useUIStore.getState()).toMatchObject({
      viewMode: 'lanes',
      selectedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      laneFocusThreadSurfaceId: 'thread-synthesis',
      laneBoardState: {
        focusedThreadSurfaceId: 'thread-synthesis',
        focusedRunId: 'run-synthesis',
      },
    })

    const laneBoard = createLaneBoardModel({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      mergeEvents: threadSurfaceData.mergeEvents,
      runIds: multiThreadState.laneRunIds,
    })

    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-synthesis')).toMatchObject({
      runId: 'run-synthesis',
      surfaceLabel: 'Synthesis',
    })
    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block-synthesis',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 20,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
      },
      {
        mergeEventId: 'merge-single-master',
        runId: 'run-master',
        mergeKind: 'single',
        executionIndex: 40,
        destinationThreadSurfaceId: 'thread-master',
        orderedThreadSurfaceIds: ['thread-master', 'thread-review'],
      },
    ])

    const focusedDetail = resolveThreadSurfaceFocusedDetail({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      mergeEvents: threadSurfaceData.mergeEvents,
      rows: laneBoard.rows,
      mergeGroups: laneBoard.mergeGroups,
      focusedThreadSurfaceId: useUIStore.getState().laneFocusThreadSurfaceId,
      selectedRunId: useUIStore.getState().selectedRunId,
    })

    expect(focusedDetail).toMatchObject({
      threadSurfaceId: 'thread-synthesis',
      runId: 'run-synthesis',
      runSummary: 'Synthesis merged research and outreach into a unified brief.',
      incomingMergeGroups: [
        expect.objectContaining({
          mergeEventId: 'merge-block-synthesis',
          destinationThreadSurfaceId: 'thread-synthesis',
        }),
      ],
    })

    expect(
      resolveWorkflowReferenceStep(contentCreatorWorkflow, {
        threadSurfaceLabel: focusedDetail?.surfaceLabel,
        threadRole: focusedDetail?.role,
        runSummary: focusedDetail?.runSummary,
      })?.id,
    ).toBe('post_publish_analytics')
  })
})
