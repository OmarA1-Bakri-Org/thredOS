import { describe, expect, test, mock } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'

// Mock the store before importing WorkbenchShell
const shellUiState = {
  chatOpen: false,
  toggleChat: () => {},
  chatPosition: { x: 0, y: 0 },
  setChatPosition: () => {},
  chatSize: { width: 400, height: 500 },
  setChatSize: () => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (s: typeof shellUiState) => unknown) => selector(shellUiState),
}))

// Mock next/dynamic to just render nothing (ChatPanel is dynamically imported)
mock.module('next/dynamic', () => ({
  default: () => () => null,
}))

// Mock FloatingChatTrigger
mock.module('@/components/chat/FloatingChatTrigger', () => ({
  FloatingChatTrigger: () => null,
}))

const { WorkbenchShell } = await import('./WorkbenchShell')

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>

function collectButtonsByLabel(node: ReactNode, label: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtonsByLabel(child, label, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    collectButtonsByLabel(render(element.props), label, acc)
    return acc
  }

  if (element.type === 'button' && element.props['aria-label'] === label) {
    acc.push(element)
  }

  collectButtonsByLabel(element.props.children, label, acc)
  return acc
}

function collectByDataRegion(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByDataRegion(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (element.props['data-workbench-region'] === target) {
    acc.push(element)
  }

  collectByDataRegion(element.props.children, target, acc)
  return acc
}

describe('WorkbenchShell', () => {
  test('renders top bar, left rail, center board region, and right inspector rail', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      board: <div>board</div>,
      inspector: <div>inspector</div>,
    })

    expect(collectByDataRegion(shell, 'top-bar')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'left-rail')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'board')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'inspector')).toHaveLength(1)
  })

  test('renders mobile drawer regions when rail overlays are opened', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      leftRailOpen: true,
      onDismissLeftRail: () => {},
      board: <div>board</div>,
      inspector: <div>inspector</div>,
      inspectorOpen: true,
      onDismissInspector: () => {},
    })

    expect(collectByDataRegion(shell, 'left-rail-drawer')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'inspector-drawer')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'left-rail-drawer-panel')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'inspector-drawer-panel')).toHaveLength(1)
    expect(JSON.stringify(shell)).toContain('Thread navigator')
    expect(JSON.stringify(shell)).toContain('Inspector')
    expect(collectButtonsByLabel(shell, 'Close thread navigator')).toHaveLength(1)
    expect(collectButtonsByLabel(shell, 'Close inspector')).toHaveLength(1)
  })

  test('keeps center board dominant by narrowing fixed rails on the default desktop shell', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      board: <div>board</div>,
      inspector: <div>inspector</div>,
    })

    const leftRail = collectByDataRegion(shell, 'left-rail')[0]
    const inspector = collectByDataRegion(shell, 'inspector')[0]

    expect(String(leftRail?.props.className ?? '')).toContain('w-72')
    expect(String(inspector?.props.className ?? '')).toContain('w-md')
  })
})
