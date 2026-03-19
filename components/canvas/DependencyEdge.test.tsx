import { describe, test, expect, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

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

const { DependencyEdge } = await import('./DependencyEdge')

const baseProps = {
  id: 'edge-1',
  source: 'step-a',
  target: 'step-b',
  sourceX: 0,
  sourceY: 50,
  targetX: 200,
  targetY: 50,
  sourcePosition: 'right',
  targetPosition: 'left',
  style: { stroke: '#3b82f6' },
  animated: false,
  data: {},
  markerEnd: undefined,
  markerStart: undefined,
  interactionWidth: 10,
  sourceHandleId: undefined,
  targetHandleId: undefined,
  pathOptions: undefined,
  label: undefined,
  labelStyle: undefined,
  labelShowBg: undefined,
  labelBgPadding: undefined,
  labelBgBorderRadius: undefined,
  labelBgStyle: undefined,
  selected: false,
  deletable: true,
  selectable: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow edge props
} as any

describe('DependencyEdge', () => {
  test('renders SVG path elements', () => {
    const markup = renderToStaticMarkup(<DependencyEdge {...baseProps} />)
    expect(markup).toContain('<path')
    expect(markup).toContain('M 0 0 L 100 100')
  })

  test('renders target endpoint circle', () => {
    const markup = renderToStaticMarkup(<DependencyEdge {...baseProps} />)
    expect(markup).toContain('<circle')
    expect(markup).toContain('cx="200"')
    expect(markup).toContain('cy="50"')
  })

  test('uses stroke color from style', () => {
    const markup = renderToStaticMarkup(<DependencyEdge {...baseProps} />)
    expect(markup).toContain('#3b82f6')
  })

  test('renders glow layer with lower opacity', () => {
    const markup = renderToStaticMarkup(<DependencyEdge {...baseProps} />)
    expect(markup).toContain('stroke-width="6"')
    expect(markup).toContain('stroke-opacity="0.07"')
  })

  test('renders animated dash pattern when animated', () => {
    const props = { ...baseProps, animated: true }
    const markup = renderToStaticMarkup(<DependencyEdge {...props} />)
    expect(markup).toContain('stroke-dasharray="6 4"')
    expect(markup).toContain('thredos-edge-flow')
  })

  test('renders without dash pattern when not animated', () => {
    const markup = renderToStaticMarkup(<DependencyEdge {...baseProps} />)
    expect(markup).not.toContain('stroke-dasharray')
    expect(markup).not.toContain('thredos-edge-flow')
  })

  test('uses default color when style.stroke is not set', () => {
    const props = { ...baseProps, style: {} }
    const markup = renderToStaticMarkup(<DependencyEdge {...props} />)
    expect(markup).toContain('#94a3b8')
  })
})
