import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState: Record<string, unknown> = {
  productEntry: null,
  setProductEntry: () => {},
  selectedNodeId: null as string | null,
  setSelectedNodeId: (id: string | null) => { uiState.selectedNodeId = id },
  selectedPhaseId: null as string | null,
  setSelectedPhaseId: (id: string | null) => { uiState.selectedPhaseId = id },
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

const { GateNode } = await import('./GateNode')

beforeEach(() => {
  uiState.selectedNodeId = null
  uiState.selectedPhaseId = null
})

const baseProps = {
  id: 'gate-1',
  data: {
    id: 'gate-1',
    name: 'Review Gate',
    status: 'PENDING',
    color: '#94a3b8',
    phaseId: 'phase-step-1',
  },
  type: 'gateNode',
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
  width: 96,
  height: 96,
  measured: { width: 96, height: 96 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow node props
} as any

describe('GateNode', () => {
  test('renders gate id', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('gate-1')
  })

  test('renders gate status', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('PENDING')
  })

  test('renders aria-label with name and status', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('aria-label="Gate Review Gate, status PENDING"')
  })

  test('renders diamond shape via rotate(45deg)', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('rotate(45deg)')
  })

  test('renders source and target handles', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('data-handle-type="target"')
    expect(markup).toContain('data-handle-type="source"')
  })

  test('renders APPROVED status', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, status: 'APPROVED', color: '#22c55e' },
    }
    const markup = renderToStaticMarkup(<GateNode {...props} />)
    expect(markup).toContain('APPROVED')
    expect(markup).toContain('#22c55e')
  })

  test('renders selected state when nodeId matches', () => {
    uiState.selectedNodeId = 'gate-1'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    // Selected border uses color + 'bb' suffix
    expect(markup).toContain('#94a3b8bb')
  })

  test('renders unselected state with lower opacity border', () => {
    uiState.selectedNodeId = 'other-node'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    // Unselected border uses color + '60' suffix
    expect(markup).toContain('#94a3b860')
  })

  test('selected diamond background gradient uses node color', () => {
    uiState.selectedNodeId = 'gate-1'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain(`${baseProps.data.color}10`)
  })

  test('unselected diamond background gradient uses node color', () => {
    uiState.selectedNodeId = null
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain(`${baseProps.data.color}10`)
  })

  test('selected box shadow uses larger glow radius', () => {
    uiState.selectedNodeId = 'gate-1'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    // Selected: 0 0 28px color25
    expect(markup).toContain(`0 0 28px ${baseProps.data.color}25`)
  })

  test('unselected box shadow uses smaller glow radius', () => {
    uiState.selectedNodeId = null
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    // Unselected: 0 0 12px color10
    expect(markup).toContain(`0 0 12px ${baseProps.data.color}10`)
  })

  test('renders role=button and tabIndex=0 for accessibility', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
  })

  test('renders fixed dimensions 96x96', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('width:96px')
    expect(markup).toContain('height:96px')
  })

  test('renders inner diamond dimensions 64x64', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('width:64px')
    expect(markup).toContain('height:64px')
  })

  test('renders counter-rotation for inner text', () => {
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    // Inner text is rotated -45deg to remain readable inside the diamond
    expect(markup).toContain('rotate(-45deg)')
  })

  test('renders with BLOCKED status and custom color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, status: 'BLOCKED', color: '#ef4444' },
    }
    const markup = renderToStaticMarkup(<GateNode {...props} />)
    expect(markup).toContain('BLOCKED')
    expect(markup).toContain('#ef4444')
  })

  test('renders gate name in aria-label with different name', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, name: 'Security Check' },
    }
    const markup = renderToStaticMarkup(<GateNode {...props} />)
    expect(markup).toContain('aria-label="Gate Security Check, status PENDING"')
  })

  test('phase-highlighted gate shows emerald scope ring', () => {
    uiState.selectedPhaseId = 'phase-step-1'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('rgba(52,211,153,0.5)')
    expect(markup).toContain('rgba(52,211,153,0.12)')
  })

  test('non-phase gate dims when a phase is selected', () => {
    uiState.selectedPhaseId = 'phase-step-other'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('opacity-35')
  })

  test('gate is fully opaque when no phase is selected', () => {
    uiState.selectedPhaseId = null
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('opacity-100')
    expect(markup).not.toContain('opacity-35')
  })

  test('gate is fully opaque when it belongs to the selected phase', () => {
    uiState.selectedPhaseId = 'phase-step-1'
    const markup = renderToStaticMarkup(<GateNode {...baseProps} />)
    expect(markup).toContain('opacity-100')
    expect(markup).not.toContain('opacity-35')
  })
})
