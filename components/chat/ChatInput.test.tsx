import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { ChatInput } = await import('./ChatInput')

describe('ChatInput', () => {
  test('renders textarea with placeholder', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('Ask about your sequence...')
  })

  test('renders send button with aria-label', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('Send message')
  })

  test('renders disabled state', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} disabled />)
    expect(markup).toContain('disabled')
  })

  test('renders textarea element', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('<textarea')
  })

  test('renders send icon as SVG', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('<svg')
  })
})
