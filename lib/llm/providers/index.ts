import { InvalidLlmProviderError } from '@/lib/errors'
import { createOpenAIProvider } from './openai'
import { createOpenRouterProvider } from './openrouter'
import type { EnvLike, LlmProvider, LlmProviderName, ThreadOSTraceContext } from './types'

export * from './types'
export { createOpenAIProvider } from './openai'
export { createOpenRouterProvider } from './openrouter'

export function isLlmProviderName(value: string): value is LlmProviderName {
  return value === 'openai' || value === 'openrouter'
}

export function getDefaultLlmProvider(env: EnvLike): LlmProviderName {
  const configuredProvider = env.THREADOS_LLM_PROVIDER
  if (!configuredProvider) {
    return 'openai'
  }

  if (!isLlmProviderName(configuredProvider)) {
    throw new InvalidLlmProviderError(configuredProvider)
  }

  return configuredProvider
}

export function createProviderFromEnv(
  provider: LlmProviderName,
  env: EnvLike = process.env,
  traceContext?: ThreadOSTraceContext
): LlmProvider {
  if (provider === 'openai') {
    return createOpenAIProvider(env, traceContext)
  }

  if (provider === 'openrouter') {
    return createOpenRouterProvider(env, traceContext)
  }

  throw new InvalidLlmProviderError(provider)
}

export function createDefaultProvider(
  env: EnvLike = process.env,
  traceContext?: ThreadOSTraceContext
): LlmProvider {
  return createProviderFromEnv(getDefaultLlmProvider(env), env, traceContext)
}
