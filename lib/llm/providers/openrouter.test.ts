import { describe, expect, mock, test } from 'bun:test'

class MockOpenAI {
  apiKey: string
  baseURL?: string
  defaultHeaders: Record<string, string>
  constructor(opts: { apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string> }) {
    this.apiKey = opts.apiKey
    this.baseURL = opts.baseURL
    this.defaultHeaders = opts.defaultHeaders ?? {}
  }
}

mock.module('openai', () => ({
  default: MockOpenAI,
}))

const { createProviderFromEnv } = await import('./index')

describe('OpenRouter provider', () => {
  test('constructs an OpenAI-compatible client with OpenRouter base URL and attribution headers', () => {
    const provider = createProviderFromEnv('openrouter', {
      THREADOS_LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'openrouter-test-key',
      OPENROUTER_MODEL: 'openai/gpt-5-mini',
      OPENROUTER_APP_URL: 'https://thredos.ai',
      OPENROUTER_APP_TITLE: 'thredOS',
    }, {
      threadSurfaceId: 'thread-master',
      runId: 'run-009',
    })

    expect(provider.provider).toBe('openrouter')
    expect(provider.client).toBeInstanceOf(MockOpenAI)
    expect(provider.defaultModel).toBe('openai/gpt-5-mini')
    expect(provider.config.apiKeyEnvVar).toBe('OPENROUTER_API_KEY')
    expect(provider.config.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(provider.config.defaultHeaders).toMatchObject({
      'HTTP-Referer': 'https://thredos.ai',
      'X-Title': 'thredOS',
      'X-ThredOS-Thread-Surface-Id': 'thread-master',
      'X-ThredOS-Run-Id': 'run-009',
      'X-ThreadOS-Thread-Surface-Id': 'thread-master',
      'X-ThreadOS-Run-Id': 'run-009',
    })
  })

  test('preserves threados-native provenance while attaching provider metadata', () => {
    const provider = createProviderFromEnv('openrouter', {
      OPENROUTER_API_KEY: 'openrouter-test-key',
    }, {
      threadSurfaceId: 'thread-master',
      runId: 'run-010',
      providerMetadata: {
        openAiAgentsTracing: true,
      },
    })

    expect(provider.config.tracing.threadosProvenance).toBe('required')
    expect(provider.config.tracing.externalTracing).toBe('openai-agents')
    expect(provider.config.defaultHeaders).toMatchObject({
      'X-ThredOS-Thread-Surface-Id': 'thread-master',
      'X-ThredOS-Run-Id': 'run-010',
      'X-ThreadOS-Thread-Surface-Id': 'thread-master',
      'X-ThreadOS-Run-Id': 'run-010',
    })
  })
})
