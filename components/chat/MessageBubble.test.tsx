import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageBubble } from './MessageBubble'

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>

function collectByTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    collectByTestId(render(element.props), target, acc)
    return acc
  }

  if (typeof element.type === 'object' && element.type && 'type' in element.type) {
    const memoType = (element.type as { type?: unknown }).type
    if (typeof memoType === 'function') {
      collectByTestId(memoType(element.props), target, acc)
      return acc
    }
  }

  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByTestId(element.props.children, target, acc)
  return acc
}

describe('MessageBubble', () => {
  test('renders user and assistant bubbles with distinct test ids', () => {
    const user = <MessageBubble role="user" content="Ship it." />
    const assistant = <MessageBubble role="assistant" content="Inspecting the sequence." />

    expect(collectByTestId(user, 'chat-message-user')).toHaveLength(1)
    expect(collectByTestId(assistant, 'chat-message-assistant')).toHaveLength(1)
  })

  test('keeps the builder and assistant labels in the message shell', () => {
    const userMarkup = renderToStaticMarkup(<MessageBubble role="user" content="Ship it." />)
    const assistantMarkup = renderToStaticMarkup(<MessageBubble role="assistant" content="Inspecting the sequence." />)

    expect(userMarkup).toContain('Builder prompt')
    expect(assistantMarkup).toContain('ThreadOS response')
  })
})
