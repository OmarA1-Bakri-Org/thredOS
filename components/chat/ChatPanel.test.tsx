import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatPanel } from './ChatPanel'

describe('ChatPanel', () => {
  test('renders the hardened empty state and contextual shell copy', () => {
    const markup = renderToStaticMarkup(<ChatPanel />)

    expect(markup).toContain('data-testid="chat-panel"')
    expect(markup).toContain('data-testid="chat-top-pills"')
    expect(markup).toContain('Thread Chat')
    expect(markup).toContain('Sequence context')
    expect(markup).toContain('Reviewed mutations')
    expect(markup).toContain('Thread dialogue')
    expect(markup).toContain('Context-bound assistant')
    expect(markup).toContain('data-testid="chat-empty-state"')
    expect(markup).toContain('Ready for bounded guidance')
    expect(markup).toContain('Ask ThreadOS to inspect, modify, or explain the active sequence.')
    expect(markup).toContain('Propose a controlled change and review the diff before applying it.')
  })
})
