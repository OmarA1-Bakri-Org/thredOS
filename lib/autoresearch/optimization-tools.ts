import type { OptimizationSuggestion, OptimizationResult, OptimizationCategory } from './types'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

const VALID_CATEGORIES: OptimizationCategory[] = ['parallelize', 'add-gate', 'remove-dep', 'reorder', 'reassign-agent']

export const OPTIMIZATION_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_optimizations',
      description: 'Propose structural optimizations for the current thredOS sequence',
      parameters: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: VALID_CATEGORIES },
                title: { type: 'string' },
                description: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                impact: { type: 'string', enum: ['low', 'medium', 'high'] },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      command: { type: 'string' },
                      args: { type: 'object' },
                    },
                    required: ['command', 'args'],
                  },
                },
              },
              required: ['category', 'title', 'description', 'confidence', 'impact', 'actions'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['suggestions', 'summary'],
      },
    },
  },
]

function isValidSuggestion(obj: unknown): obj is OptimizationSuggestion {
  if (typeof obj !== 'object' || obj === null) return false
  const s = obj as Record<string, unknown>
  return (
    typeof s.category === 'string' &&
    VALID_CATEGORIES.includes(s.category as OptimizationCategory) &&
    typeof s.title === 'string' &&
    typeof s.description === 'string' &&
    typeof s.confidence === 'number' &&
    typeof s.impact === 'string' &&
    Array.isArray(s.actions)
  )
}

export function parseOptimizationToolCall(argsJson: string): OptimizationResult {
  try {
    const parsed = JSON.parse(argsJson)
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter(isValidSuggestion).map((s: OptimizationSuggestion, i: number) => ({
          ...s,
          id: `opt-${i}`,
        }))
      : []
    return {
      analyzedAt: new Date().toISOString(),
      suggestions,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    }
  } catch {
    return { analyzedAt: new Date().toISOString(), suggestions: [], summary: '' }
  }
}
