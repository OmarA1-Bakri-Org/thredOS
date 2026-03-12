import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoadingSpinner, LoadingSkeleton } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  test('renders default loading message', () => {
    const markup = renderToStaticMarkup(<LoadingSpinner />)
    expect(markup).toContain('Loading...')
  })

  test('renders custom message', () => {
    const markup = renderToStaticMarkup(<LoadingSpinner message="Initializing..." />)
    expect(markup).toContain('Initializing...')
  })

  test('renders spinner element with animation', () => {
    const markup = renderToStaticMarkup(<LoadingSpinner />)
    expect(markup).toContain('animate-spin')
  })
})

describe('LoadingSkeleton', () => {
  test('renders default 3 skeleton lines', () => {
    const markup = renderToStaticMarkup(<LoadingSkeleton />)
    expect(markup).toContain('animate-pulse')
    // Count skeleton divs by width pattern
    const matches = markup.match(/animate-pulse/g)
    expect(matches?.length).toBe(3)
  })

  test('renders custom number of lines', () => {
    const markup = renderToStaticMarkup(<LoadingSkeleton lines={5} />)
    const matches = markup.match(/animate-pulse/g)
    expect(matches?.length).toBe(5)
  })

  test('renders decreasing widths', () => {
    const markup = renderToStaticMarkup(<LoadingSkeleton lines={3} />)
    expect(markup).toContain('width:85%')
    expect(markup).toContain('width:70%')
    expect(markup).toContain('width:55%')
  })
})
