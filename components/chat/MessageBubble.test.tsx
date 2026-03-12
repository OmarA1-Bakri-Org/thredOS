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

  test('renders user content as plain text', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Deploy the service now." />)
    expect(markup).toContain('Deploy the service now.')
  })

  test('renders assistant content through Markdown', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="assistant" content="This is **bold** text." />)
    expect(markup).toContain('<strong>')
    expect(markup).toContain('bold')
  })

  test('renders timestamp as relative time (just now)', () => {
    const recentTimestamp = Date.now() - 5000 // 5 seconds ago
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" timestamp={recentTimestamp} />)
    expect(markup).toContain('just now')
  })

  test('renders timestamp as minutes ago', () => {
    const minutesAgo = Date.now() - 120_000 // 2 minutes ago
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" timestamp={minutesAgo} />)
    expect(markup).toContain('2m ago')
  })

  test('renders timestamp as hours ago', () => {
    const hoursAgo = Date.now() - 7_200_000 // 2 hours ago
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" timestamp={hoursAgo} />)
    expect(markup).toContain('2h ago')
  })

  test('renders timestamp as days ago', () => {
    const daysAgo = Date.now() - 172_800_000 // 2 days ago
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" timestamp={daysAgo} />)
    expect(markup).toContain('2d ago')
  })

  test('omits timestamp span when timestamp is not provided', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" />)
    expect(markup).not.toContain('ago')
    expect(markup).not.toContain('just now')
  })

  test('user bubble has blue border styling', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" />)
    expect(markup).toContain('border-[#16417C]')
  })

  test('assistant bubble has slate border styling', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="assistant" content="Test" />)
    expect(markup).toContain('border-slate-700')
  })

  test('user bubble is right-aligned', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="user" content="Test" />)
    expect(markup).toContain('justify-end')
  })

  test('assistant bubble is left-aligned', () => {
    const markup = renderToStaticMarkup(<MessageBubble role="assistant" content="Test" />)
    expect(markup).toContain('justify-start')
  })
})
