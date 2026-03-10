import OpenAI from 'openai'

export type LlmProviderName = 'openai' | 'openrouter'
export type ExternalTracingMode = 'none' | 'openai-agents'

export interface ProviderMetadata {
  openAiAgentsTracing?: boolean
}

export interface ThreadOSTraceContext {
  threadSurfaceId?: string
  runId?: string
  stepId?: string
  providerMetadata?: ProviderMetadata
}

export interface LlmProviderConfig {
  provider: LlmProviderName
  apiKeyEnvVar: string
  baseURL?: string
  defaultModel?: string
  defaultHeaders: Record<string, string>
  tracing: {
    threadosProvenance: 'required'
    externalTracing: ExternalTracingMode
  }
}

export interface LlmProvider {
  provider: LlmProviderName
  client: OpenAI
  defaultModel?: string
  config: LlmProviderConfig
}

export type EnvLike = Record<string, string | undefined>
