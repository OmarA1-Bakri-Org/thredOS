import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { WorkbenchShell } from './WorkbenchShell'

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>

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
})
