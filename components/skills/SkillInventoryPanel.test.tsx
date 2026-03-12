import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillInventoryPanel } from './SkillInventoryPanel'
import type { SkillBadge } from './SkillBadgeRow'

describe('SkillInventoryPanel', () => {
  test('shows empty state when no skills are provided', () => {
    const markup = renderToStaticMarkup(<SkillInventoryPanel skills={[]} />)

    expect(markup).toContain('data-testid="skill-inventory-panel"')
    expect(markup).toContain('data-testid="skill-inventory-empty"')
    expect(markup).toContain('No skills assigned to this surface.')
  })

  test('groups skills into Local and Inherited sections', () => {
    const skills: SkillBadge[] = [
      { id: 'search', label: 'Search', inherited: false },
      { id: 'browser', label: 'Browser', inherited: true },
      { id: 'tools', label: 'Tools', inherited: false },
    ]
    const markup = renderToStaticMarkup(<SkillInventoryPanel skills={skills} />)

    expect(markup).toContain('data-testid="skill-group-local"')
    expect(markup).toContain('data-testid="skill-group-inherited"')
    expect(markup).toContain('Local')
    expect(markup).toContain('Inherited')
    expect(markup).toContain('Search')
    expect(markup).toContain('Browser')
    expect(markup).toContain('Tools')
  })

  test('renders SKILLS header label', () => {
    const markup = renderToStaticMarkup(<SkillInventoryPanel skills={[]} />)
    expect(markup).toContain('Skills')
  })

  test('does not show Inherited group when all skills are local', () => {
    const skills: SkillBadge[] = [
      { id: 'search', label: 'Search', inherited: false },
    ]
    const markup = renderToStaticMarkup(<SkillInventoryPanel skills={skills} />)

    expect(markup).toContain('data-testid="skill-group-local"')
    expect(markup).not.toContain('data-testid="skill-group-inherited"')
  })

  test('does not show Local group when all skills are inherited', () => {
    const skills: SkillBadge[] = [
      { id: 'browser', label: 'Browser', inherited: true },
    ]
    const markup = renderToStaticMarkup(<SkillInventoryPanel skills={skills} />)

    expect(markup).not.toContain('data-testid="skill-group-local"')
    expect(markup).toContain('data-testid="skill-group-inherited"')
  })
})
