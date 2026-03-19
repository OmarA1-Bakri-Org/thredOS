import { describe, expect, mock, test } from 'bun:test'

class MockOpenAI {
  apiKey: string
  defaultHeaders: Record<string, string>
  constructor(opts: { apiKey: string; defaultHeaders?: Record<string, string> }) {
    this.apiKey = opts.apiKey
    this.defaultHeaders = opts.defaultHeaders ?? {}
  }
}

mock.module('openai', () => ({
  default: MockOpenAI,
}))

const { createProviderFromEnv } = await import('./index')

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
    expect(provider.client).toBeInstanceOf(MockOpenAI)
    expect(provider.defaultModel).toBe('gpt-5-mini')
    expect(provider.config.apiKeyEnvVar).toBe('OPENAI_API_KEY')
    expect(provider.config.baseURL).toBeUndefined()
    expect(provider.config.tracing.threadosProvenance).toBe('required')
    expect(provider.config.tracing.externalTracing).toBe('none')
    expect(provider.config.defaultHeaders).toMatchObject({
      'X-ThredOS-Thread-Surface-Id': 'thread-master',
      'X-ThredOS-Run-Id': 'run-001',
      'X-ThredOS-Step-Id': 'step-compile',
      'X-ThreadOS-Thread-Surface-Id': 'thread-master',
      'X-ThreadOS-Run-Id': 'run-001',
      'X-ThreadOS-Step-Id': 'step-compile',
    })
  })
})
