import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { CompactThreadCard } = await import('./CompactThreadCard')

const baseNode = {
  id: 'thread-root',
  surfaceLabel: 'Main Thread',
  depth: 0,
  role: 'default' as const,
  childCount: 3,
  runStatus: 'running' as const,
  runSummary: 'Processing content pipeline',
  clickTarget: { threadSurfaceId: 'thread-root', runId: 'run-1' },
}

describe('CompactThreadCard', () => {
  test('renders surface label', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={false} onSelect={() => {}} />
    )
    expect(markup).toContain('Main Thread')
  })

  test('renders child count', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={false} onSelect={() => {}} />
    )
    expect(markup).toContain('3 children')
  })

  test('renders singular child text for count 1', () => {
    const node = { ...baseNode, childCount: 1 }
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={node} selected={false} onSelect={() => {}} />
    )
    expect(markup).toContain('1 child')
    expect(markup).not.toContain('1 children')
  })

  test('renders run status', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={false} onSelect={() => {}} />
    )
    expect(markup).toContain('running')
  })

  test('renders data-thread-surface-id attribute', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={false} onSelect={() => {}} />
    )
    expect(markup).toContain('data-thread-surface-id="thread-root"')
  })

  test('renders aria-current when selected', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={true} onSelect={() => {}} />
    )
    expect(markup).toContain('aria-current="page"')
  })

  test('does not render aria-current when not selected', () => {
    const markup = renderToStaticMarkup(
      <CompactThreadCard node={baseNode} selected={false} onSelect={() => {}} />
    )
    expect(markup).not.toContain('aria-current')
  })
})
