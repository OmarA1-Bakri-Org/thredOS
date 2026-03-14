import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState: Record<string, unknown> = {
  productEntry: null,
  setProductEntry: () => {},
  selectedNodeId: null as string | null,
  setSelectedNodeId: (id: string | null) => { uiState.selectedNodeId = id },
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
  viewMode: 'hierarchy',
  setViewMode: () => {},
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (id: string | null) => { uiState.selectedThreadSurfaceId = id },
  selectedRunId: null,
  setSelectedRunId: () => {},
  hierarchyViewport: { x: 0, y: 0, zoom: 1 },
  setHierarchyViewport: () => {},
  laneFocusThreadSurfaceId: null,
  setLaneFocusThreadSurfaceId: () => {},
  laneBoardState: { scrollLeft: 0, focusedThreadSurfaceId: null, focusedRunId: null },
  setLaneBoardState: () => {},
  openLaneViewForThreadSurface: () => {},
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

const { InspectorRail } = await import('./InspectorRail')

beforeEach(() => {
  uiState.selectedThreadSurfaceId = null
  uiState.selectedNodeId = null
})

describe('InspectorRail', () => {
  test('renders Inspector label', () => {
    const markup = renderToStaticMarkup(<InspectorRail><div>content</div></InspectorRail>)
    expect(markup).toContain('Inspector')
  })

  test('renders children', () => {
    const markup = renderToStaticMarkup(<InspectorRail><div data-testid="child">Hello</div></InspectorRail>)
    expect(markup).toContain('data-testid="child"')
    expect(markup).toContain('Hello')
  })

  test('shows Thread / run detail when nothing selected', () => {
    const markup = renderToStaticMarkup(<InspectorRail><div /></InspectorRail>)
    expect(markup).toContain('Thread / run detail')
  })

  test('shows Thread surface when threadSurface selected', () => {
    uiState.selectedThreadSurfaceId = 'thread-root'
    const markup = renderToStaticMarkup(<InspectorRail><div /></InspectorRail>)
    expect(markup).toContain('Thread surface')
    expect(markup).toContain('thread-root')
  })

  test('shows Step / gate detail when node selected', () => {
    uiState.selectedNodeId = 'step-1'
    const markup = renderToStaticMarkup(<InspectorRail><div /></InspectorRail>)
    expect(markup).toContain('Step / gate detail')
  })

  test('renders SVG icon when node selected', () => {
    uiState.selectedNodeId = 'step-1'
    const markup = renderToStaticMarkup(<InspectorRail><div /></InspectorRail>)
    expect(markup).toContain('<svg')
  })

  test('renders SVG icon when no node selected', () => {
    const markup = renderToStaticMarkup(<InspectorRail><div /></InspectorRail>)
    expect(markup).toContain('<svg')
  })
})
