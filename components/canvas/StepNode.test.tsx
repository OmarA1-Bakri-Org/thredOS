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

const { StepNode } = await import('./StepNode')

beforeEach(() => {
  uiState.selectedNodeId = null
})

const baseProps = {
  id: 'step-1',
  data: {
    id: 'step-1',
    name: 'Research',
    status: 'READY',
    type: 'base',
    model: 'claude-code',
    color: '#3b82f6',
  },
  type: 'stepNode',
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
  parentId: undefined,
  sourcePosition: undefined,
  targetPosition: undefined,
  dragHandle: undefined,
  width: 220,
  height: 80,
  measured: { width: 220, height: 80 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow node props
} as any

describe('StepNode', () => {
  test('renders step name', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('Research')
  })

  test('renders step id', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('step-1')
  })

  test('renders step status', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('READY')
  })

  test('renders step type badge', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('base')
  })

  test('renders step model badge', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('claude-code')
  })

  test('renders aria-label with name and status', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('aria-label="Step Research, status READY"')
  })

  test('renders source and target handles', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('data-handle-type="target"')
    expect(markup).toContain('data-handle-type="source"')
  })

  test('renders RUNNING status with pulse class', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, status: 'RUNNING' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('RUNNING')
    expect(markup).toContain('animate-pulse')
  })

  test('renders parallel type with correct color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'p' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('#818cf8')
  })

  test('renders selected state when nodeId matches', () => {
    uiState.selectedNodeId = 'step-1'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    // Selected state uses the node color for corner accents and handles
    expect(markup).toContain('#3b82f6')
  })
})
