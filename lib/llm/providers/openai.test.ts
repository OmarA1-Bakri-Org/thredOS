import { describe, expect, test } from 'bun:test'
import OpenAI from 'openai'
import { createProviderFromEnv } from './index'

describe('OpenAI provider', () => {
  test('constructs an OpenAI-backed client from environment configuration', () => {
    const provider = createProviderFromEnv('openai', {
      THREADOS_LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'openai-test-key',
      OPENAI_MODEL: 'gpt-5-mini',
    }, {
      threadSurfaceId: 'thread-master',
      runId: 'run-001',
      stepId: 'step-compile',
    })

    expect(provider.provider).toBe('openai')
    expect(provider.client).toBeInstanceOf(OpenAI)
    expect(provider.defaultModel).toBe('gpt-5-mini')
    expect(provider.config.apiKeyEnvVar).toBe('OPENAI_API_KEY')
    expect(provider.config.baseURL).toBeUndefined()
    expect(provider.config.tracing.threadosProvenance).toBe('required')
    expect(provider.config.tracing.externalTracing).toBe('none')
    expect(provider.config.defaultHeaders).toMatchObject({
      'X-ThreadOS-Thread-Surface-Id': 'thread-master',
      'X-ThreadOS-Run-Id': 'run-001',
      'X-ThreadOS-Step-Id': 'step-compile',
    })
  })
})
