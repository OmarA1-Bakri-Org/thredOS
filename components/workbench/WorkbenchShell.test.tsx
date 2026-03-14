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

// Mock AccordionPanel so we don't need to mock all child hooks
mock.module('./AccordionPanel', () => ({
  AccordionPanel: () => <div data-testid="accordion-panel-mock">Accordion</div>,
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
  test('renders top bar, accordion panel, and center board region', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      board: <div>board</div>,
    })

    expect(collectByDataRegion(shell, 'top-bar')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'accordion-panel')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'board')).toHaveLength(1)
  })

  test('renders mobile left-rail drawer when leftRailOpen is true', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      leftRailOpen: true,
      onDismissLeftRail: () => {},
      board: <div>board</div>,
    })

    expect(collectByDataRegion(shell, 'left-rail-drawer')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'left-rail-drawer-panel')).toHaveLength(1)
    expect(JSON.stringify(shell)).toContain('Thread navigator')
    expect(collectButtonsByLabel(shell, 'Close thread navigator')).toHaveLength(1)
  })

  test('does not render inspector regions (removed in favor of accordion panel)', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      board: <div>board</div>,
    })

    expect(collectByDataRegion(shell, 'inspector')).toHaveLength(0)
    expect(collectByDataRegion(shell, 'inspector-drawer')).toHaveLength(0)
    expect(collectByDataRegion(shell, 'inspector-drawer-panel')).toHaveLength(0)
    expect(collectByDataRegion(shell, 'left-rail')).toHaveLength(0)
  })

  test('accordion panel replaces the old left-rail and inspector on desktop', () => {
    const shell = WorkbenchShell({
      topBar: <div>top</div>,
      leftRail: <div>left</div>,
      board: <div>board</div>,
    })

    const accordionPanel = collectByDataRegion(shell, 'accordion-panel')[0]
    expect(accordionPanel).toBeDefined()
  })
})
