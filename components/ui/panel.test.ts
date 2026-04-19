import { describe, expect, test } from 'bun:test'
import { panelVariants } from './panel'

describe('panelVariants', () => {
  test('default produces neutral tone and md padding', () => {
    const classes = panelVariants({})
    expect(classes).toContain('border-slate-800/90')
    expect(classes).toContain('px-4 py-4')
  })

  test('accent tone uses sky border', () => {
    const classes = panelVariants({ tone: 'accent' })
    expect(classes).toContain('border-sky-500/30')
  })

  test('emerald tone uses emerald palette', () => {
    const classes = panelVariants({ tone: 'emerald' })
    expect(classes).toContain('border-emerald-500/25')
    expect(classes).toContain('bg-emerald-500/5')
  })

  test('padding xl maps to p-8', () => {
    expect(panelVariants({ padding: 'xl' })).toContain('p-8')
  })

  test('padding none produces no pad class', () => {
    const classes = panelVariants({ padding: 'none' })
    expect(classes).not.toContain('p-8')
    expect(classes).not.toContain('px-4')
  })

  test('elevation overlay adds deep shadow', () => {
    expect(panelVariants({ elevation: 'overlay' })).toContain(
      'shadow-[0_28px_80px_rgba(0,0,0,0.45)]',
    )
  })

  test('elevation none emits no shadow', () => {
    const classes = panelVariants({ elevation: 'none' })
    expect(classes).not.toContain('shadow-')
  })
})
