import OpenAI from 'openai'
import { MissingLlmProviderConfigError } from '@/lib/errors'
import type { EnvLike, LlmProvider, ThredOSTraceContext } from './types'

function buildThredOSHeaders(traceContext?: ThredOSTraceContext): Record<string, string> {
  return {
    ...(traceContext?.threadSurfaceId ? { 'X-ThredOS-Thread-Surface-Id': traceContext.threadSurfaceId } : {}),
    ...(traceContext?.runId ? { 'X-ThredOS-Run-Id': traceContext.runId } : {}),
    ...(traceContext?.stepId ? { 'X-ThredOS-Step-Id': traceContext.stepId } : {}),
    ...(traceContext?.threadSurfaceId ? { 'X-ThreadOS-Thread-Surface-Id': traceContext.threadSurfaceId } : {}),
    ...(traceContext?.runId ? { 'X-ThreadOS-Run-Id': traceContext.runId } : {}),
    ...(traceContext?.stepId ? { 'X-ThreadOS-Step-Id': traceContext.stepId } : {}),
  }
}

export function createOpenAIProvider(env: EnvLike, traceContext?: ThredOSTraceContext): LlmProvider {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    throw new MissingLlmProviderConfigError('OPENAI_API_KEY', 'openai')
  }

  const defaultHeaders = buildThredOSHeaders(traceContext)
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
