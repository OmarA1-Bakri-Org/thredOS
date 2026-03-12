import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { EmptyState } = await import('./EmptyState')

describe('EmptyState', () => {
  test('renders heading', () => {
    const markup = renderToStaticMarkup(<EmptyState />)
    expect(markup).toContain('No Sequence Found')
  })

  test('renders init command', () => {
    const markup = renderToStaticMarkup(<EmptyState />)
    expect(markup).toContain('thread init my-project')
  })

  test('renders getting started text', () => {
    const markup = renderToStaticMarkup(<EmptyState />)
    expect(markup).toContain('Get started by initializing a new sequence')
  })

  test('renders the icon as SVG', () => {
    const markup = renderToStaticMarkup(<EmptyState />)
    expect(markup).toContain('<svg')
  })
})
