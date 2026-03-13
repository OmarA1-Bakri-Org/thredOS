import { describe, test, expect } from 'bun:test'
import {
  findModelFamily,
  resolveModelBackend,
  getConfiguredModel,
  listModelFamilies,
} from './registry'

// ---------------------------------------------------------------------------
// findModelFamily
// ---------------------------------------------------------------------------

describe('findModelFamily', () => {
  test('matches exact model ID', () => {
    const family = findModelFamily('gpt-4o')
    expect(family).not.toBeNull()
    expect(family!.preferredBackend).toBe('openai')
  })

  test('matches prefix pattern for OpenAI models', () => {
    expect(findModelFamily('gpt-4o-mini')?.preferredBackend).toBe('openai')
    expect(findModelFamily('gpt-5')?.preferredBackend).toBe('openai')
    expect(findModelFamily('o1-preview')?.preferredBackend).toBe('openai')
    expect(findModelFamily('o3-mini')?.preferredBackend).toBe('openai')
    expect(findModelFamily('o4-mini')?.preferredBackend).toBe('openai')
  })

  test('matches prefix pattern for Claude models', () => {
    expect(findModelFamily('claude-sonnet-4-20250514')?.prefixPatterns).toContain('claude-')
    expect(findModelFamily('claude-opus-4-20250514')?.displayName).toBe('Claude Sonnet 4')
    expect(findModelFamily('claude-haiku-3.5')?.preferredBackend).toBe('openrouter')
  })

  test('matches prefix pattern for Llama models', () => {
    expect(findModelFamily('meta-llama/llama-3.1-70b')?.preferredBackend).toBe('openrouter')
    expect(findModelFamily('meta-llama/llama-4-405b')?.preferredBackend).toBe('openrouter')
  })

  test('matches prefix pattern for Gemini models', () => {
    expect(findModelFamily('google/gemini-2.5-pro')?.preferredBackend).toBe('openrouter')
    expect(findModelFamily('gemini-2.5-flash')?.preferredBackend).toBe('openrouter')
  })

  test('matches prefix pattern for Mistral models', () => {
    expect(findModelFamily('mistralai/mistral-large')?.preferredBackend).toBe('openrouter')
    expect(findModelFamily('mistral-medium')?.preferredBackend).toBe('openrouter')
  })

  test('returns null for unknown models', () => {
    expect(findModelFamily('unknown-model-xyz')).toBeNull()
    expect(findModelFamily('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveModelBackend
// ---------------------------------------------------------------------------

describe('resolveModelBackend', () => {
  test('routes GPT model directly when OPENAI_API_KEY is set', () => {
    const result = resolveModelBackend('gpt-4o', { OPENAI_API_KEY: 'sk-test' })
    expect(result.backend).toBe('openai')
    expect(result.isRelayed).toBe(false)
    expect(result.modelId).toBe('gpt-4o')
  })

  test('routes Claude model through OpenRouter when OPENROUTER_API_KEY is set', () => {
    const result = resolveModelBackend('claude-sonnet-4-20250514', { OPENROUTER_API_KEY: 'or-test' })
    expect(result.backend).toBe('openrouter')
    expect(result.isRelayed).toBe(true)
  })

  test('routes unknown model through OpenRouter as universal fallback', () => {
    const result = resolveModelBackend('some/custom-model', { OPENROUTER_API_KEY: 'or-test' })
    expect(result.backend).toBe('openrouter')
    expect(result.isRelayed).toBe(true)
  })

  test('routes GPT model through OpenRouter when only OPENROUTER_API_KEY is set', () => {
    const result = resolveModelBackend('gpt-4o', { OPENROUTER_API_KEY: 'or-test' })
    expect(result.backend).toBe('openrouter')
    expect(result.isRelayed).toBe(true)
  })

  test('prefers direct OpenAI when both keys are set for GPT model', () => {
    const result = resolveModelBackend('gpt-4o', {
      OPENAI_API_KEY: 'sk-test',
      OPENROUTER_API_KEY: 'or-test',
    })
    expect(result.backend).toBe('openai')
    expect(result.isRelayed).toBe(false)
  })

  test('throws when no backend is available', () => {
    expect(() => resolveModelBackend('gpt-4o', {})).toThrow('No backend available')
  })

  test('throws for unknown model with no OpenRouter key', () => {
    expect(() => resolveModelBackend('some/custom-model', { OPENAI_API_KEY: 'sk-test' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// getConfiguredModel
// ---------------------------------------------------------------------------

describe('getConfiguredModel', () => {
  test('returns THREADOS_MODEL when set (new config)', () => {
    expect(getConfiguredModel({ THREADOS_MODEL: 'claude-sonnet-4-20250514' })).toBe('claude-sonnet-4-20250514')
  })

  test('THREADOS_MODEL takes priority over legacy config', () => {
    expect(getConfiguredModel({
      THREADOS_MODEL: 'claude-sonnet-4-20250514',
      THREADOS_LLM_PROVIDER: 'openai',
      OPENAI_MODEL: 'gpt-4o',
    })).toBe('claude-sonnet-4-20250514')
  })

  test('falls back to OPENROUTER_MODEL for legacy openrouter config', () => {
    expect(getConfiguredModel({
      THREADOS_LLM_PROVIDER: 'openrouter',
      OPENROUTER_MODEL: 'meta-llama/llama-3.1-70b',
    })).toBe('meta-llama/llama-3.1-70b')
  })

  test('falls back to OPENAI_MODEL for legacy openai config', () => {
    expect(getConfiguredModel({
      THREADOS_LLM_PROVIDER: 'openai',
      OPENAI_MODEL: 'gpt-5',
    })).toBe('gpt-5')
  })

  test('falls back to OPENAI_MODEL when no provider is specified', () => {
    expect(getConfiguredModel({ OPENAI_MODEL: 'gpt-4o-mini' })).toBe('gpt-4o-mini')
  })

  test('defaults to gpt-4o when nothing is configured', () => {
    expect(getConfiguredModel({})).toBe('gpt-4o')
  })
})

// ---------------------------------------------------------------------------
// listModelFamilies
// ---------------------------------------------------------------------------

describe('listModelFamilies', () => {
  test('returns a non-empty list', () => {
    const families = listModelFamilies()
    expect(families.length).toBeGreaterThan(0)
  })

  test('returns copies (not references to internal array)', () => {
    const a = listModelFamilies()
    const b = listModelFamilies()
    expect(a).not.toBe(b)
  })

  test('includes OpenAI and OpenRouter-backed models', () => {
    const families = listModelFamilies()
    const backends = new Set(families.map(f => f.preferredBackend))
    expect(backends.has('openai')).toBe(true)
    expect(backends.has('openrouter')).toBe(true)
  })
})
