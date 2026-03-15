import type { ProposedAction } from '@/lib/chat/validator'

export type OptimizationCategory =
  | 'parallelize'
  | 'add-gate'
  | 'remove-dep'
  | 'reorder'
  | 'reassign-agent'

export interface OptimizationSuggestion {
  id: string
  category: OptimizationCategory
  title: string
  description: string
  confidence: number // 0-1
  impact: 'low' | 'medium' | 'high'
  actions: ProposedAction[]
}

export interface OptimizationResult {
  analyzedAt: string
  suggestions: OptimizationSuggestion[]
  summary: string
}
