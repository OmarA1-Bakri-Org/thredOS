import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { WorkbenchShell } from './WorkbenchShell'

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
      chat: <div>chat</div>,
      chatOpen: true,
    })

    expect(collectByDataRegion(shell, 'top-bar')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'left-rail')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'board')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'inspector')).toHaveLength(1)
    expect(collectByDataRegion(shell, 'chat')).toHaveLength(1)
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
    expect(collectButtonsByLabel(shell, 'Close thread navigator')).toHaveLength(1)
    expect(collectButtonsByLabel(shell, 'Close inspector')).toHaveLength(1)
  })
})
