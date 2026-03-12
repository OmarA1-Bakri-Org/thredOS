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

const { GroupBoundary } = await import('./GroupBoundary')

const baseProps = {
  id: 'group-1',
  data: {
    groupId: 'parallel-workers',
    width: 400,
    height: 300,
  },
  type: 'groupBoundary',
  xPos: 0,
  yPos: 0,
  selected: false,
  isConnectable: false,
  zIndex: 0,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  dragging: false,
  deletable: false,
  selectable: false,
  width: 400,
  height: 300,
  measured: { width: 400, height: 300 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow node props
} as any

describe('GroupBoundary', () => {
  test('renders group id label', () => {
    const markup = renderToStaticMarkup(<GroupBoundary {...baseProps} />)
    expect(markup).toContain('parallel-workers')
  })

  test('renders with correct dimensions', () => {
    const markup = renderToStaticMarkup(<GroupBoundary {...baseProps} />)
    expect(markup).toContain('width:400px')
    expect(markup).toContain('height:300px')
  })

  test('renders corner bracket marks', () => {
    const markup = renderToStaticMarkup(<GroupBoundary {...baseProps} />)
    // The component renders 4 corner bracket divs using Tailwind classes
    expect(markup).toContain('absolute top-0 left-0')
    expect(markup).toContain('absolute top-0 right-0')
    expect(markup).toContain('absolute bottom-0 left-0')
    expect(markup).toContain('absolute bottom-0 right-0')
  })

  test('renders as pointer-events-none', () => {
    const markup = renderToStaticMarkup(<GroupBoundary {...baseProps} />)
    expect(markup).toContain('pointer-events-none')
  })

  test('renders with indigo bracket color', () => {
    const markup = renderToStaticMarkup(<GroupBoundary {...baseProps} />)
    expect(markup).toContain('rgba(99, 102, 241, 0.28)')
  })
})
