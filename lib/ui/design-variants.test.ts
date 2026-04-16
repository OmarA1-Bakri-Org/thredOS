import { describe, expect, test } from 'bun:test'
import {
  buildEntryPreviewHref,
  buildLoginPreviewHref,
  buildWorkbenchPreviewHref,
  resolvePreviewMode,
  resolveUiVariant,
} from './design-variants'

describe('design variants', () => {
  test('defaults unknown variants to premium control once B is selected', () => {
    expect(resolveUiVariant(undefined)).toBe('premium-control')
    expect(resolveUiVariant(null)).toBe('premium-control')
    expect(resolveUiVariant('something-else')).toBe('premium-control')
    expect(resolveUiVariant('premium-control')).toBe('premium-control')
  })

  test('recognizes preview mode tokens', () => {
    expect(resolvePreviewMode('1')).toBe(true)
    expect(resolvePreviewMode('true')).toBe(true)
    expect(resolvePreviewMode('preview')).toBe(true)
    expect(resolvePreviewMode('0')).toBe(false)
  })

  test('builds preview links for entry, login, and workbench', () => {
    expect(buildEntryPreviewHref('operator-minimalism')).toBe('/?uiVariant=operator-minimalism&preview=1')
    expect(buildWorkbenchPreviewHref('premium-control')).toBe('/app?uiVariant=premium-control&preview=1')
    expect(buildLoginPreviewHref('industrial-systems')).toContain('/login?uiVariant=industrial-systems&preview=1&next=')
    expect(decodeURIComponent(buildLoginPreviewHref('industrial-systems'))).toContain('/app?uiVariant=industrial-systems&preview=1')
  })
})
