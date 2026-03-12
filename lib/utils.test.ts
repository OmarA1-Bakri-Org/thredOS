import { describe, test, expect } from 'bun:test'
import { cn } from './utils'

describe('cn', () => {
  test('merges class names', () => {
    const result = cn('foo', 'bar')
    expect(result).toContain('foo')
    expect(result).toContain('bar')
  })

  test('handles conditional classes', () => {
    const result = cn('base', false && 'hidden', 'visible')
    expect(result).toContain('base')
    expect(result).toContain('visible')
    expect(result).not.toContain('hidden')
  })

  test('merges tailwind conflicts correctly', () => {
    // twMerge should resolve conflicts
    const result = cn('px-2', 'px-4')
    expect(result).toBe('px-4')
  })

  test('handles undefined and null', () => {
    const result = cn('base', undefined, null, 'end')
    expect(result).toContain('base')
    expect(result).toContain('end')
  })

  test('handles empty input', () => {
    const result = cn()
    expect(result).toBe('')
  })

  test('handles array input', () => {
    const result = cn(['foo', 'bar'])
    expect(result).toContain('foo')
    expect(result).toContain('bar')
  })
})
