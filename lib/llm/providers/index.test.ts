import { describe, test, expect } from 'bun:test'
import { isLlmProviderName, getDefaultLlmProvider } from './index'

describe('isLlmProviderName', () => {
  test('returns true for openai', () => {
    expect(isLlmProviderName('openai')).toBe(true)
  })

  test('returns true for openrouter', () => {
    expect(isLlmProviderName('openrouter')).toBe(true)
  })

  test('returns false for unknown providers', () => {
    expect(isLlmProviderName('anthropic')).toBe(false)
    expect(isLlmProviderName('')).toBe(false)
    expect(isLlmProviderName('azure')).toBe(false)
  })
})

describe('getDefaultLlmProvider', () => {
  test('returns openai when no env var set', () => {
    expect(getDefaultLlmProvider({})).toBe('openai')
  })

  test('returns openai when THREADOS_LLM_PROVIDER is undefined', () => {
    expect(getDefaultLlmProvider({ THREADOS_LLM_PROVIDER: undefined })).toBe('openai')
  })

  test('returns configured provider when valid', () => {
    expect(getDefaultLlmProvider({ THREADOS_LLM_PROVIDER: 'openrouter' })).toBe('openrouter')
  })

  test('throws for invalid provider name', () => {
    expect(() => getDefaultLlmProvider({ THREADOS_LLM_PROVIDER: 'invalid' })).toThrow()
  })
})
