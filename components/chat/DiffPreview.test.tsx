import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiffPreview } from './DiffPreview'

describe('DiffPreview', () => {
  test('returns null for empty diff', () => {
    const markup = renderToStaticMarkup(<DiffPreview diff="" />)
    expect(markup).toBe('')
  })

  test('renders Preview Changes header', () => {
    const markup = renderToStaticMarkup(<DiffPreview diff="+ added line" />)
    expect(markup).toContain('Preview Changes')
  })

  test('renders added lines with green color class', () => {
    const markup = renderToStaticMarkup(<DiffPreview diff="+ added line" />)
    expect(markup).toContain('text-emerald-300')
    expect(markup).toContain('+ added line')
  })

  test('renders removed lines with red color class', () => {
    const markup = renderToStaticMarkup(<DiffPreview diff="- removed line" />)
    expect(markup).toContain('text-rose-300')
    expect(markup).toContain('- removed line')
  })

  test('renders hunk headers with blue color class', () => {
    const markup = renderToStaticMarkup(<DiffPreview diff="@@ -1,3 +1,4 @@" />)
    expect(markup).toContain('text-sky-300')
  })

  test('renders context lines without color class', () => {
    const diff = 'context line\n+ added\n- removed'
    const markup = renderToStaticMarkup(<DiffPreview diff={diff} />)
    expect(markup).toContain('context line')
  })

  test('renders multi-line diff', () => {
    const diff = '@@ -1,3 +1,4 @@\n context\n- old\n+ new'
    const markup = renderToStaticMarkup(<DiffPreview diff={diff} />)
    expect(markup).toContain('context')
    expect(markup).toContain('old')
    expect(markup).toContain('new')
  })
})
