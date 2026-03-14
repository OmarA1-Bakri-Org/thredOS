import { InvalidLlmProviderError } from '@/lib/errors'
import { resolveModelBackend, getConfiguredModel } from '../models/registry'
import type { BackendId } from '../models/registry'
import { createOpenAIProvider } from './openai'
import { createOpenRouterProvider } from './openrouter'
import type { EnvLike, LlmProvider, LlmProviderName, ThreadOSTraceContext } from './types'

export * from './types'
export { createOpenAIProvider } from './openai'
export { createOpenRouterProvider } from './openrouter'

// Re-export model registry for convenience
export { resolveModelBackend, getConfiguredModel, findModelFamily, listModelFamilies } from '../models/registry'
export type { BackendId, ModelEntry, ResolvedModel } from '../models/registry'

// ---------------------------------------------------------------------------
// Legacy provider-centric API (kept for backward compatibility)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model-centric API (preferred)
// ---------------------------------------------------------------------------

/**
 * Create an LLM provider for a specific model.
 *
 * This is the preferred entry point. Users specify a model ID
 * (e.g. "gpt-4o", "claude-sonnet-4-20250514", "meta-llama/llama-3.1-70b")
 * and the system routes to the correct backend automatically.
 */
export function createProviderForModel(
  modelId: string,
  env: EnvLike = process.env,
  traceContext?: ThreadOSTraceContext,
): LlmProvider {
  const resolved = resolveModelBackend(modelId, env)
  const provider = createProviderFromBackend(resolved.backend, env, traceContext)

  // Override the default model to the requested one
  return {
    ...provider,
    defaultModel: modelId,
    config: {
      ...provider.config,
      defaultModel: modelId,
    },
  }
}

/**
 * Create an LLM provider using the configured default model.
 *
 * Reads THREADOS_MODEL (preferred) or falls back to legacy env vars.
 */
export function createConfiguredProvider(
  env: EnvLike = process.env,
  traceContext?: ThreadOSTraceContext,
): LlmProvider {
  const modelId = getConfiguredModel(env)
  return createProviderForModel(modelId, env, traceContext)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function createProviderFromBackend(
  backend: BackendId,
  env: EnvLike,
  traceContext?: ThreadOSTraceContext,
): LlmProvider {
  if (backend === 'openai') {
    return createOpenAIProvider(env, traceContext)
  }
  if (backend === 'openrouter') {
    return createOpenRouterProvider(env, traceContext)
  }
  throw new InvalidLlmProviderError(backend)
}
