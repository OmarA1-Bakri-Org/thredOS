import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillBadgeRow, type SkillBadge } from './SkillBadgeRow'

describe('SkillBadgeRow', () => {
  test('renders nothing when skills array is empty', () => {
    const markup = renderToStaticMarkup(<SkillBadgeRow skills={[]} />)
    expect(markup).toBe('')
  })

  test('renders a badge for each skill with icon and label', () => {
    const skills: SkillBadge[] = [
      { id: 'search', label: 'Search', inherited: false },
      { id: 'browser', label: 'Browser', inherited: false },
    ]
    const markup = renderToStaticMarkup(<SkillBadgeRow skills={skills} />)

    expect(markup).toContain('data-testid="skill-badge-row"')
    expect(markup).toContain('data-testid="skill-badge-search"')
    expect(markup).toContain('data-testid="skill-badge-browser"')
    expect(markup).toContain('Search')
    expect(markup).toContain('Browser')
  })

  test('inherited skills get dimmed treatment with opacity-60', () => {
    const skills: SkillBadge[] = [
      { id: 'model', label: 'Model', inherited: true },
    ]
    const markup = renderToStaticMarkup(<SkillBadgeRow skills={skills} />)

    expect(markup).toContain('opacity-60')
    expect(markup).toContain('border-slate-800')
  })

  test('local skills get full brightness treatment', () => {
    const skills: SkillBadge[] = [
      { id: 'tools', label: 'Tools', inherited: false },
    ]
    const markup = renderToStaticMarkup(<SkillBadgeRow skills={skills} />)

    expect(markup).toContain('border-slate-700')
    expect(markup).toContain('text-slate-200')
    expect(markup).not.toContain('opacity-60')
  })

  test('falls back to Box icon for unknown skill types', () => {
    const skills: SkillBadge[] = [
      { id: 'unknown-skill', label: 'Custom', inherited: false },
    ]
    const markup = renderToStaticMarkup(<SkillBadgeRow skills={skills} />)

    expect(markup).toContain('data-testid="skill-badge-unknown-skill"')
    expect(markup).toContain('Custom')
  })
})
