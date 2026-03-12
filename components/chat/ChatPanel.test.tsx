import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// Mock the store before importing ChatPanel
const chatUiState = {
  chatOpen: true,
  toggleChat: () => {},
  chatPosition: { x: 0, y: 0 },
  setChatPosition: () => {},
  chatSize: { width: 400, height: 500 },
  setChatSize: () => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (s: typeof chatUiState) => unknown) => selector(chatUiState),
}))

const { ChatPanel } = await import('./ChatPanel')

describe('ChatPanel', () => {
  test('renders the hardened empty state and contextual shell copy', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)

    expect(markup).toContain('data-testid="chat-panel"')
    expect(markup).toContain('data-testid="chat-header"')
    expect(markup).toContain('data-testid="chat-top-pills"')
    expect(markup).toContain('data-testid="chat-mode-card"')
    expect(markup).toContain('Thread Chat')
    expect(markup).toContain('Sequence context')
    expect(markup).toContain('Reviewed mutations')
    expect(markup).toContain('Context-bound assistant')
    expect(markup).toContain('data-testid="chat-empty-state"')
    expect(markup).toContain('data-testid="chat-empty-example-grid"')
    expect(markup).toContain('Ready for bounded guidance')
    expect(markup).toContain('Ask ThreadOS to inspect, modify, or explain the active sequence.')
    expect(markup).toContain('Propose a controlled change and review the diff before applying it.')
  })

  test('renders aria-busy=false when not loading', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('aria-busy="false"')
  })

  test('renders aria-live region for message list', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('aria-live="polite"')
  })

  test('renders the ChatInput component at the bottom', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('Ask about your sequence...')
    expect(markup).toContain('Send message')
  })

  test('renders compact header without verbose description', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).not.toContain('Thread dialogue')
    expect(markup).toContain('Thread Chat')
  })

  test('renders the Summarize example in the empty state grid', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('Summarize the selected thread and current run context.')
  })

  test('does not render loading indicator in initial state', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).not.toContain('ThreadOS is reasoning over the active thread surface...')
  })

  test('renders the flex column layout container', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('flex h-full flex-col')
  })

  test('renders with floating positioning classes', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('fixed')
    expect(markup).toContain('chat-floating-container')
  })

  test('renders a close button', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)
    expect(markup).toContain('chat-close-button')
    expect(markup).toContain('Close chat')
  })
})
