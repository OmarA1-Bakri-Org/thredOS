import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { HierarchyView, type HierarchyViewNode } from './HierarchyView'

type ButtonElement = ReactElement<{
  children?: ReactNode
  onClick?: () => void
  'data-thread-surface-id'?: string
  'aria-current'?: string
}>

function collectButtons(node: ReactNode, acc: ButtonElement[] = []): ButtonElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    try {
      collectButtons(render(element.props), acc)
    } catch {
      // Skip components that require React's render pipeline (e.g. hooks)
    }
    return acc
  }

  if (element.type === 'button') {
    acc.push(element as ButtonElement)
  }

  collectButtons(element.props.children, acc)
  return acc
}

describe('HierarchyView', () => {
  test('clicking a hierarchy node opens lane view with thread and run context', () => {
    const nodes: HierarchyViewNode[] = [
      {
        id: 'thread-current',
        surfaceLabel: 'Current Thread',
        depth: 0,
        childCount: 0,
        runStatus: 'running',
        runSummary: 'Scaffolded from current status',
        clickTarget: {
          threadSurfaceId: 'thread-current',
          runId: 'status:demo-run',
        },
      },
    ]

    const opened: Array<{ threadSurfaceId: string; runId: string | null }> = []
    const view = HierarchyView({
      nodes,
      selectedThreadSurfaceId: null,
      onOpenLane: (threadSurfaceId, runId) => {
        opened.push({ threadSurfaceId, runId })
      },
    })

    const button = collectButtons(view).find(candidate => candidate.props['data-thread-surface-id'] === 'thread-current')
    expect(button).toBeDefined()

    ;(button?.props.onClick as (() => void) | undefined)?.()

    expect(opened).toEqual([{ threadSurfaceId: 'thread-current', runId: 'status:demo-run' }])
  })

  test('preserves selected thread identity in the rendered node state', () => {
    const nodes: HierarchyViewNode[] = [
      {
        id: 'thread-current',
        surfaceLabel: 'Current Thread',
        depth: 0,
        childCount: 0,
        runStatus: 'successful',
        runSummary: null,
        clickTarget: {
          threadSurfaceId: 'thread-current',
          runId: 'status:demo-run',
        },
      },
      {
        id: 'thread-review',
        surfaceLabel: 'Review Thread',
        depth: 1,
        childCount: 0,
        runStatus: null,
        runSummary: null,
        clickTarget: {
          threadSurfaceId: 'thread-review',
          runId: null,
        },
      },
    ]

    const view = HierarchyView({
      nodes,
      selectedThreadSurfaceId: 'thread-review',
      onOpenLane: () => {},
    })

    const buttons = collectButtons(view)
    const selected = buttons.find(button => button.props['data-thread-surface-id'] === 'thread-review')
    const notSelected = buttons.find(button => button.props['data-thread-surface-id'] === 'thread-current')

    expect(selected?.props['aria-current']).toBe('page')
    expect(notSelected?.props['aria-current']).toBeUndefined()
  })
})
