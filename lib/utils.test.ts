import { afterEach, describe, expect, test } from 'bun:test'
import { cn, createClientId } from './utils'

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'crypto')
  }
})

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

describe('createClientId', () => {
  test('uses crypto.randomUUID when available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-1234',
      },
    })

    expect(createClientId()).toBe('uuid-1234')
  })

  test('falls back when crypto.randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    })

    const id = createClientId()
    expect(id.startsWith('msg-')).toBe(true)
    expect(id.length).toBeGreaterThan(12)
  })
})
