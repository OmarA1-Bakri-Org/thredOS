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
  selectedThreadSurfaceId: null,
  setSelectedThreadSurfaceId: () => {},
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

mock.module('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-handle-type={type} data-handle-position={position} />
  ),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
  getSmoothStepPath: (..._args: any[]) => ['M 0 0 L 100 100'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
  ReactFlow: (props: any) => <div data-testid="reactflow">{props.children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
  ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
  MiniMap: () => <div data-testid="minimap" />,
  Controls: () => <div data-testid="controls" />,
  Background: () => <div data-testid="background" />,
  useReactFlow: () => ({ fitView: () => {}, getNodes: () => [], getEdges: () => [] }),
  memo: <T,>(fn: T): T => fn,
}))

const { FusionMerge } = await import('./FusionMerge')

beforeEach(() => {
  uiState.selectedNodeId = null
})

const baseProps = {
  id: 'synth-1',
  data: {
    id: 'synth-1',
    name: 'Synthesis Step',
    status: 'READY',
    type: 'f',
    model: 'claude-code',
    color: '#fbbf24',
  },
  type: 'fusionMerge',
  xPos: 0,
  yPos: 0,
  selected: false,
  isConnectable: true,
  zIndex: 0,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  dragging: false,
  deletable: true,
  selectable: true,
  width: 220,
  height: 80,
  measured: { width: 220, height: 80 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow node props
} as any

describe('FusionMerge', () => {
  test('renders fusion name', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('Synthesis Step')
  })

  test('renders fusion id', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('synth-1')
  })

  test('renders fusion status', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('READY')
  })

  test('renders synth badge', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('synth')
  })

  test('renders model badge', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('claude-code')
  })

  test('renders aria-label with name and status', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('aria-label="Fusion synth Synthesis Step, status READY"')
  })

  test('renders trapezoid SVG shape', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('<polygon')
    expect(markup).toContain('points="14,2 206,2 180,78 40,78"')
  })

  test('renders source and target handles', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('data-handle-type="target"')
    expect(markup).toContain('data-handle-type="source"')
  })

  test('renders gradient with node id', () => {
    const markup = renderToStaticMarkup(<FusionMerge {...baseProps} />)
    expect(markup).toContain('fg-synth-1')
  })
})
