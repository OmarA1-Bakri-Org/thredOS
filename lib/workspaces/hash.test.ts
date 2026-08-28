import { describe, expect, test } from 'bun:test'
import { hashCanonicalJson, hashSha256Bytes } from './hash'

describe('hashSha256Bytes', () => {
  test('hashes binary data deterministically', () => {
    expect(hashSha256Bytes(Buffer.from([0, 255, 1, 2, 3, 254])))
      .toBe('sha256:d15cade4706f93abecb9d6ce0675c1f6498f84519250b0b362d95ffeb52440bb')
  })
})

describe('hashCanonicalJson', () => {
  test('is stable across object key order', () => {
    const first = hashCanonicalJson({
      zeta: 1,
      alpha: {
        beta: true,
        gamma: ['x', { delta: null }],
      },
    })
    const second = hashCanonicalJson({
      alpha: {
        gamma: ['x', { delta: null }],
        beta: true,
      },
      zeta: 1,
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('rejects unsupported canonical JSON values', () => {
    expect(() => hashCanonicalJson({ bad: Number.NaN })).toThrow('canonical JSON')
    expect(() => hashCanonicalJson({ bad: undefined })).toThrow('canonical JSON')
  })

  test('preserves prototype-like own keys in the canonical hash', () => {
    const withPrototypeKey = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>

    expect(hashCanonicalJson(withPrototypeKey)).not.toBe(hashCanonicalJson({}))
    expect(hashCanonicalJson(withPrototypeKey)).toBe(
      hashCanonicalJson(JSON.parse('{"__proto__":{"x":1}}')),
    )
  })
})
