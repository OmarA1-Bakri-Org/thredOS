import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { ProductEntryScreen } from './ProductEntryScreen'

type ButtonElement = ReactElement<{
  children?: ReactNode
  onClick?: () => void
  disabled?: boolean
  'data-entry-option'?: string
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
    collectButtons(render(element.props), acc)
    return acc
  }

  if (element.type === 'button') {
    acc.push(element as ButtonElement)
  }

  collectButtons(element.props.children, acc)
  return acc
}

describe('ProductEntryScreen', () => {
  test('selecting thredOS enters the workbench', () => {
    const selections: string[] = []
    const view = ProductEntryScreen({
      onEnterThredOS: () => {
        selections.push('thredos')
      },
    })

    const thredOSButton = collectButtons(view).find(
      button => button.props['data-entry-option'] === 'thredos',
    )

    expect(thredOSButton).toBeDefined()
    expect(thredOSButton?.props.disabled).toBeUndefined()

    ;(thredOSButton?.props.onClick as (() => void) | undefined)?.()

    expect(selections).toEqual(['thredos'])
  })

  test('public entry surface keeps Thread Runner out of scope', () => {
    const view = ProductEntryScreen({ onEnterThredOS: () => {} })

    const threadRunnerButton = collectButtons(view).find(
      button => button.props['data-entry-option'] === 'thread-runner',
    )

    expect(threadRunnerButton).toBeUndefined()
  })

  test('renders a single primary thredOS entry action', () => {
    const view = ProductEntryScreen({ onEnterThredOS: () => {} })

    expect(collectButtons(view)).toHaveLength(1)
  })
})
