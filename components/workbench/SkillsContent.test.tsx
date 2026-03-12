import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillsContent } from './SkillsContent'

describe('SkillsContent', () => {
  test('renders default skills inventory', () => {
    const markup = renderToStaticMarkup(<SkillsContent />)
    expect(markup).toContain('skill-inventory-panel')
    expect(markup).toContain('Search')
    expect(markup).toContain('Files')
  })
})
