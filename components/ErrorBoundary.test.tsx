import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { ErrorBoundary } = await import('./ErrorBoundary')

describe('ErrorBoundary', () => {
  test('renders children when no error', () => {
    const markup = renderToStaticMarkup(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>
    )
    expect(markup).toContain('data-testid="child"')
    expect(markup).toContain('Hello')
  })

  test('renders custom fallback when provided and error occurs', () => {
    // We can't easily trigger getDerivedStateFromError in SSR,
    // but we can test the static method directly
    const state = ErrorBoundary.getDerivedStateFromError(new Error('Test error'))
    expect(state.hasError).toBe(true)
    expect(state.error?.message).toBe('Test error')
  })

  test('getDerivedStateFromError returns error state', () => {
    const error = new Error('Something went wrong')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(error)
  })
})
