import { describe, test, expect } from 'bun:test'
import {
  AgentNotFoundError,
  PromptNotFoundError,
  ThreadSurfaceNotFoundError,
  ThreadSurfaceRunNotFoundError,
  ThreadSurfaceAlreadyExistsError,
  InvalidThreadSurfaceMergeError,
  ThreadSurfaceRunScopeNotFoundError,
  InvalidLlmProviderError,
  MissingLlmProviderConfigError,
} from './errors'

describe('Extended error classes', () => {
  test('AgentNotFoundError without hint', () => {
    const e = new AgentNotFoundError('claude-code')
    expect(e.code).toBe('AGENT_NOT_FOUND')
    expect(e.message).toContain('claude-code')
    expect(e.message).toContain('not found on PATH')
  })

  test('AgentNotFoundError with hint', () => {
    const e = new AgentNotFoundError('codex', 'Install via npm')
    expect(e.message).toContain('Install via npm')
  })

  test('PromptNotFoundError', () => {
    const e = new PromptNotFoundError('step-1', '.threados/prompts/step-1.md')
    expect(e.code).toBe('PROMPT_NOT_FOUND')
    expect(e.message).toContain('step-1')
    expect(e.message).toContain('.threados/prompts/step-1.md')
  })

  test('ThreadSurfaceNotFoundError', () => {
    const e = new ThreadSurfaceNotFoundError('surface-x')
    expect(e.code).toBe('THREAD_SURFACE_NOT_FOUND')
    expect(e.message).toContain('surface-x')
  })

  test('ThreadSurfaceRunNotFoundError', () => {
    const e = new ThreadSurfaceRunNotFoundError('surface-1', 'run-abc')
    expect(e.code).toBe('THREAD_SURFACE_RUN_NOT_FOUND')
    expect(e.message).toContain('surface-1')
    expect(e.message).toContain('run-abc')
  })

  test('ThreadSurfaceAlreadyExistsError', () => {
    const e = new ThreadSurfaceAlreadyExistsError('thread-root')
    expect(e.code).toBe('THREAD_SURFACE_ALREADY_EXISTS')
    expect(e.message).toContain('thread-root')
  })

  test('InvalidThreadSurfaceMergeError', () => {
    const e = new InvalidThreadSurfaceMergeError('Cannot merge into self')
    expect(e.code).toBe('INVALID_THREAD_SURFACE_MERGE')
    expect(e.message).toBe('Cannot merge into self')
  })

  test('ThreadSurfaceRunScopeNotFoundError', () => {
    const e = new ThreadSurfaceRunScopeNotFoundError('run-123')
    expect(e.code).toBe('THREAD_SURFACE_RUN_NOT_FOUND')
    expect(e.message).toContain('run-123')
  })

  test('InvalidLlmProviderError', () => {
    const e = new InvalidLlmProviderError('anthropic')
    expect(e.code).toBe('INVALID_LLM_PROVIDER')
    expect(e.message).toContain('anthropic')
  })

  test('MissingLlmProviderConfigError', () => {
    const e = new MissingLlmProviderConfigError('OPENAI_API_KEY', 'openai')
    expect(e.code).toBe('MISSING_LLM_PROVIDER_CONFIG')
    expect(e.message).toContain('OPENAI_API_KEY')
    expect(e.message).toContain('openai')
  })

  test('all errors are instanceof Error', () => {
    expect(new AgentNotFoundError('x')).toBeInstanceOf(Error)
    expect(new PromptNotFoundError('x', 'y')).toBeInstanceOf(Error)
    expect(new ThreadSurfaceNotFoundError('x')).toBeInstanceOf(Error)
    expect(new InvalidLlmProviderError('x')).toBeInstanceOf(Error)
    expect(new MissingLlmProviderConfigError('x', 'y')).toBeInstanceOf(Error)
  })
})
