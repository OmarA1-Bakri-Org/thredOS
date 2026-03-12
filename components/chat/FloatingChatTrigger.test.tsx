import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// Mock the store
const triggerUiState = {
  chatOpen: false,
  toggleChat: () => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (s: typeof triggerUiState) => unknown) => selector(triggerUiState),
}))

const { FloatingChatTrigger } = await import('./FloatingChatTrigger')

describe('FloatingChatTrigger', () => {
  test('renders trigger pill with chat label', () => {
    const markup = renderToStaticMarkup(<FloatingChatTrigger />)
    expect(markup).toContain('Chat with ThreadOS')
  })

  test('renders with fixed positioning', () => {
    const markup = renderToStaticMarkup(<FloatingChatTrigger />)
    expect(markup).toContain('fixed')
  })
})
