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

const { StepNode } = await import('./StepNode')

beforeEach(() => {
  uiState.selectedNodeId = null
  uiState.selectedPhaseId = null
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
    phaseId: 'phase-step-1',
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

  test('renders unselected corner accents with slate fallback', () => {
    uiState.selectedNodeId = 'other-node'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    // Unselected corner accents use rgba(148,163,184,0.18)
    expect(markup).toContain('rgba(148,163,184,0.18)')
  })

  test('selected state applies color-based box shadow glow', () => {
    uiState.selectedNodeId = 'step-1'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    // Selected box shadow: 0 0 24px color1a
    expect(markup).toContain(`0 0 24px ${baseProps.data.color}1a`)
  })

  test('non-selected non-running state uses static shadow', () => {
    uiState.selectedNodeId = null
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('0 2px 10px rgba(0,0,0,0.35)')
  })

  test('renders c (convergent) type with correct color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'c' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('#38bdf8')
  })

  test('renders f (fusion) type with correct color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'f' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('#fbbf24')
  })

  test('renders b (bridge) type with correct color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'b' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('#a78bfa')
  })

  test('renders l (loop) type with correct color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'l' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    expect(markup).toContain('#34d399')
  })

  test('renders unknown type with base fallback color', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, type: 'unknown' },
    }
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    // Unknown type defaults to #64748b (same as base)
    expect(markup).toContain('#64748b')
  })

  test('non-RUNNING status does not have animate-pulse', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).not.toContain('animate-pulse')
  })

  test('selected border uses color with 70 opacity suffix', () => {
    uiState.selectedNodeId = 'step-1'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain(`${baseProps.data.color}70`)
  })

  test('unselected border uses rgba slate color', () => {
    uiState.selectedNodeId = null
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('rgba(51,65,85,0.45)')
  })

  test('renders role=button and tabIndex=0 for accessibility', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
  })

  test('renders fixed width 220', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('width:220px')
  })

  test('RUNNING status applies glow box shadow', () => {
    const props = {
      ...baseProps,
      data: { ...baseProps.data, status: 'RUNNING' },
    }
    uiState.selectedNodeId = null
    const markup = renderToStaticMarkup(<StepNode {...props} />)
    // RUNNING non-selected uses 0 0 16px color12
    expect(markup).toContain(`0 0 16px ${baseProps.data.color}12`)
  })

  test('renders top accent bar with gradient from node color', () => {
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain(`${baseProps.data.color}cc`)
    expect(markup).toContain(`${baseProps.data.color}15`)
  })

  test('phase-highlighted node shows emerald scope ring', () => {
    uiState.selectedPhaseId = 'phase-step-1'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    // Emerald phase border color
    expect(markup).toContain('rgba(52,211,153,0.5)')
    // Emerald phase glow
    expect(markup).toContain('rgba(52,211,153,0.12)')
  })

  test('non-phase node dims when a phase is selected', () => {
    uiState.selectedPhaseId = 'phase-step-other'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('opacity-35')
  })

  test('node is fully opaque when no phase is selected', () => {
    uiState.selectedPhaseId = null
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('opacity-100')
    expect(markup).not.toContain('opacity-35')
  })

  test('node is fully opaque when it belongs to the selected phase', () => {
    uiState.selectedPhaseId = 'phase-step-1'
    const markup = renderToStaticMarkup(<StepNode {...baseProps} />)
    expect(markup).toContain('opacity-100')
    expect(markup).not.toContain('opacity-35')
  })
})
