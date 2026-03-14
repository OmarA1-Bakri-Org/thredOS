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

  test('textarea starts with single row', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('rows="1"')
  })

  test('textarea has resize-none class', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('resize-none')
  })

  test('send button is disabled when textarea is empty', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    // The button has disabled={disabled || !value.trim()} — value starts as ''
    // so the button should be disabled
    const buttonMatch = markup.match(/<button[^>]*aria-label="Send message"[^>]*>/)
    expect(buttonMatch).toBeTruthy()
    expect(buttonMatch![0]).toContain('disabled')
  })

  test('textarea is disabled when disabled prop is true', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} disabled />)
    const textareaMatch = markup.match(/<textarea[^>]*>/)
    expect(textareaMatch).toBeTruthy()
    expect(textareaMatch![0]).toContain('disabled')
  })

  test('renders border-t class on the input container', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('border-t')
  })

  test('renders min-h-[44px] on the textarea', () => {
    const markup = renderToStaticMarkup(<ChatInput onSend={() => {}} />)
    expect(markup).toContain('min-h-[44px]')
  })
})
