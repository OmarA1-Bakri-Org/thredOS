import OpenAI from 'openai'
import { MissingLlmProviderConfigError } from '@/lib/errors'
import type { EnvLike, LlmProvider, ThreadOSTraceContext } from './types'

function buildThreadOSHeaders(traceContext?: ThreadOSTraceContext): Record<string, string> {
  return {
    ...(traceContext?.threadSurfaceId ? { 'X-ThreadOS-Thread-Surface-Id': traceContext.threadSurfaceId } : {}),
    ...(traceContext?.runId ? { 'X-ThreadOS-Run-Id': traceContext.runId } : {}),
    ...(traceContext?.stepId ? { 'X-ThreadOS-Step-Id': traceContext.stepId } : {}),
  }
}

export function createOpenAIProvider(env: EnvLike, traceContext?: ThreadOSTraceContext): LlmProvider {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    throw new MissingLlmProviderConfigError('OPENAI_API_KEY', 'openai')
  }

  const defaultHeaders = buildThreadOSHeaders(traceContext)
  const client = new OpenAI({
    apiKey,
    defaultHeaders,
  })

  return {
    provider: 'openai',
    client,
    defaultModel: env.OPENAI_MODEL,
    config: {
      provider: 'openai',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      defaultModel: env.OPENAI_MODEL,
      defaultHeaders,
      tracing: {
        threadosProvenance: 'required',
        externalTracing: traceContext?.providerMetadata?.openAiAgentsTracing ? 'openai-agents' : 'none',
      },
    },
  }
}
