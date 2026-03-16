'use client'

import { Sparkles, Loader2, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useOptimizeWorkflow } from '@/lib/ui/api'
import type { OptimizationSuggestion } from '@/lib/autoresearch/types'

const IMPACT_COLOR: Record<string, string> = {
  low: 'text-slate-400 border-slate-600 bg-slate-800',
  medium: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  high: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
}

const CATEGORY_LABEL: Record<string, string> = {
  parallelize: 'Parallelize',
  'add-gate': 'Add Gate',
  'remove-dep': 'Remove Dep',
  reorder: 'Reorder',
  'reassign-agent': 'Reassign Agent',
}

function SuggestionCard({ suggestion }: { suggestion: OptimizationSuggestion }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      data-testid={`suggestion-${suggestion.id}`}
      className="border border-slate-800 bg-[#0a101a] px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono text-[11px] text-slate-200">{suggestion.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase ${IMPACT_COLOR[suggestion.impact]}`}>
            {suggestion.impact}
          </span>
          <span className="font-mono text-[9px] text-slate-500">
            {Math.round(suggestion.confidence * 100)}%
          </span>
          {expanded ? <ChevronUp className="h-3 w-3 text-slate-600" /> : <ChevronDown className="h-3 w-3 text-slate-600" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-800/50 pt-3">
          <div className="flex items-center gap-2">
            <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[8px] uppercase text-slate-400">
              {CATEGORY_LABEL[suggestion.category] ?? suggestion.category}
            </span>
          </div>
          <p className="text-xs leading-5 text-slate-400">{suggestion.description}</p>
          {suggestion.actions.length > 0 && (
            <div className="rounded border border-slate-800 bg-[#060a12] p-2">
              <div className="font-mono text-[9px] text-slate-600">
                {suggestion.actions.length} action{suggestion.actions.length !== 1 ? 's' : ''}: {suggestion.actions.map(a => a.command).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function OptimizeButton() {
  const optimize = useOptimizeWorkflow()
  const [showResults, setShowResults] = useState(false)

  const handleOptimize = () => {
    optimize.mutate(undefined, {
      onSuccess: () => setShowResults(true),
    })
  }

  return (
    <div data-testid="optimize-workflow">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={optimize.isPending}
        onClick={handleOptimize}
        className="gap-1.5"
      >
        {optimize.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {optimize.isPending ? 'Analyzing...' : 'Optimize Workflow'}
        </span>
      </Button>

      {showResults && optimize.data && (
        <div className="mt-3 space-y-3">
          {optimize.data.summary && (
            <p className="text-xs text-slate-400">{optimize.data.summary}</p>
          )}
          {optimize.data.suggestions.length === 0 && (
            <div className="text-center text-xs text-slate-500">No optimizations found.</div>
          )}
          {optimize.data.suggestions.map(s => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))}
        </div>
      )}
    </div>
  )
}
