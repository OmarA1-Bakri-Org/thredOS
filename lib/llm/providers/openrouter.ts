import OpenAI from 'openai'
import { MissingLlmProviderConfigError } from '@/lib/errors'
import type { EnvLike, LlmProvider, ThredOSTraceContext } from './types'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

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

export function createOpenRouterProvider(env: EnvLike, traceContext?: ThredOSTraceContext): LlmProvider {
  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new MissingLlmProviderConfigError('OPENROUTER_API_KEY', 'openrouter')
  }

  const defaultHeaders = {
    ...(env.OPENROUTER_APP_URL ? { 'HTTP-Referer': env.OPENROUTER_APP_URL } : {}),
    ...(env.OPENROUTER_APP_TITLE ? { 'X-Title': env.OPENROUTER_APP_TITLE } : {}),
    ...buildThredOSHeaders(traceContext),
  }

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders,
  })

  return {
    provider: 'openrouter',
    client,
    defaultModel: env.OPENROUTER_MODEL,
    config: {
      provider: 'openrouter',
      apiKeyEnvVar: 'OPENROUTER_API_KEY',
      baseURL: OPENROUTER_BASE_URL,
      defaultModel: env.OPENROUTER_MODEL,
      defaultHeaders,
      tracing: {
        threadosProvenance: 'required',
        externalTracing: traceContext?.providerMetadata?.openAiAgentsTracing ? 'openai-agents' : 'none',
      },
    },
  }
}
