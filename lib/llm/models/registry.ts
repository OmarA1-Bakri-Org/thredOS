/**
 * Model Registry — the model-centric entry point for LLM usage.
 *
 * Users pick models by ID ("gpt-4o", "claude-sonnet-4-20250514", "meta-llama/llama-3.1-70b").
 * The registry resolves each model to a backend adapter (direct OpenAI, OpenRouter relay, etc.)
 * without exposing provider names in the user-facing layer.
 *
 * OpenRouter acts as a universal relay — any model not directly supported by an installed
 * API key gets routed through OpenRouter automatically.
 */

import type { EnvLike } from '../providers/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal backend identifier — NOT user-facing. */
export type BackendId = 'openai' | 'openrouter'

export interface ModelEntry {
  /** Canonical model ID (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
  modelId: string
  /** Human-readable display name */
  displayName: string
  /** Which backend to use for direct API access (when the key is available) */
  preferredBackend: BackendId
  /** Env var that must be set for the preferred backend */
  apiKeyEnvVar: string
  /** Prefix patterns that identify this model family */
  prefixPatterns: string[]
}

export interface ResolvedModel {
  /** The model ID to pass to the API */
  modelId: string
  /** The backend that will serve the request */
  backend: BackendId
  /** Whether this is going through a relay (OpenRouter) vs direct API */
  isRelayed: boolean
}

// ---------------------------------------------------------------------------
// Known model families
// ---------------------------------------------------------------------------

/**
 * Known model families with their preferred direct backends.
 * Order matters — first match wins during prefix resolution.
 */
const MODEL_FAMILIES: ModelEntry[] = [
  {
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    preferredBackend: 'openai',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    prefixPatterns: ['gpt-', 'o1-', 'o3-', 'o4-'],
  },
  {
    modelId: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    preferredBackend: 'openrouter', // Anthropic direct adapter not yet wired — relay through OpenRouter
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    prefixPatterns: ['claude-'],
  },
  {
    modelId: 'meta-llama/llama-3.1-70b',
    displayName: 'Llama 3.1 70B',
    preferredBackend: 'openrouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    prefixPatterns: ['meta-llama/', 'llama-'],
  },
  {
    modelId: 'google/gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    preferredBackend: 'openrouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    prefixPatterns: ['google/', 'gemini-'],
  },
  {
    modelId: 'mistralai/mistral-large',
    displayName: 'Mistral Large',
    preferredBackend: 'openrouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    prefixPatterns: ['mistralai/', 'mistral-'],
  },
]

// ---------------------------------------------------------------------------
// Resolution logic
// ---------------------------------------------------------------------------

/**
 * Find the model family that matches a given model ID by prefix.
 */
export function findModelFamily(modelId: string): ModelEntry | null {
  for (const family of MODEL_FAMILIES) {
    if (family.modelId === modelId) return family
    for (const prefix of family.prefixPatterns) {
      if (modelId.startsWith(prefix)) return family
    }
  }
  return null
}

/**
 * Resolve a model ID to a backend.
 *
 * Rules:
 * 1. If the model matches a known family AND the preferred backend's API key is set → use direct.
 * 2. If OPENROUTER_API_KEY is set → relay through OpenRouter (universal fallback).
 * 3. If OPENAI_API_KEY is set and model looks like an OpenAI model → use OpenAI direct.
 * 4. Otherwise → throw (no backend available).
 */
export function resolveModelBackend(modelId: string, env: EnvLike): ResolvedModel {
  const family = findModelFamily(modelId)

  // Rule 1: Known family with direct key available
  if (family && env[family.apiKeyEnvVar]) {
    return {
      modelId,
      backend: family.preferredBackend,
      isRelayed: family.preferredBackend === 'openrouter',
    }
  }

  // Rule 2: OpenRouter as universal relay
  if (env.OPENROUTER_API_KEY) {
    return {
      modelId,
      backend: 'openrouter',
      isRelayed: true,
    }
  }

  // Rule 3: OpenAI direct (if model looks like OpenAI)
  if (env.OPENAI_API_KEY && family?.preferredBackend === 'openai') {
    return {
      modelId,
      backend: 'openai',
      isRelayed: false,
    }
  }

  throw new Error(
    `No backend available for model "${modelId}". ` +
    'Set OPENROUTER_API_KEY (universal) or a provider-specific key.'
  )
}

// ---------------------------------------------------------------------------
// Default model resolution
// ---------------------------------------------------------------------------

/**
 * Get the configured model ID from environment.
 *
 * Priority:
 * 1. THREADOS_MODEL (new model-centric config)
 * 2. Legacy: OPENAI_MODEL / OPENROUTER_MODEL based on THREADOS_LLM_PROVIDER
 * 3. Fallback: "gpt-4o"
 */
export function getConfiguredModel(env: EnvLike): string {
  // New model-centric config
  if (env.THREADOS_MODEL) {
    return env.THREADOS_MODEL
  }

  // Legacy backward compatibility
  const legacyProvider = env.THREADOS_LLM_PROVIDER
  if (legacyProvider === 'openrouter' && env.OPENROUTER_MODEL) {
    return env.OPENROUTER_MODEL
  }
  if (env.OPENAI_MODEL) {
    return env.OPENAI_MODEL
  }

  return 'gpt-4o'
}

/**
 * Get all known model families for UI display.
 */
export function listModelFamilies(): ModelEntry[] {
  return [...MODEL_FAMILIES]
}
