import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as uiStore from '@/lib/ui/store'

// Mock the store
const triggerUiState = {
  chatOpen: false,
  toggleChat: () => {},
}

beforeEach(() => {
  spyOn(uiStore, 'useUIStore').mockImplementation(((selector?: (s: typeof triggerUiState) => unknown) => (
    selector ? selector(triggerUiState) : triggerUiState
  )) as typeof uiStore.useUIStore)
})

afterEach(() => {
  mock.restore()
})

const { FloatingChatTrigger } = await import('./FloatingChatTrigger')

describe('FloatingChatTrigger', () => {
  test('renders trigger pill with chat label', () => {
    const markup = renderToStaticMarkup(<FloatingChatTrigger />)
    expect(markup).toContain('Chat with thredOS')
  })

  test('renders with fixed positioning', () => {
    const markup = renderToStaticMarkup(<FloatingChatTrigger />)
    expect(markup).toContain('fixed')
  })
})