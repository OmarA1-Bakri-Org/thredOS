'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import type { ProposedAction } from '@/lib/chat/validator'

interface ActionCardProps {
  actions: ProposedAction[]
  onApply: (actions: ProposedAction[]) => void
  onDiscard: () => void
}

export const ActionCard = memo(function ActionCard({ actions, onApply, onDiscard }: ActionCardProps) {
  if (actions.length === 0) return null

  return (
    <div className="my-3 border border-[#16417C]/70 bg-[#16417C]/14 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Proposed Actions ({actions.length})
        </div>
        <span className="rounded-full border border-[#16417C]/70 bg-[#08101d] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
          Review required
        </span>
      </div>
      <ul className="mb-4 space-y-2">
        {actions.map((action, i) => (
          <li key={i} className="border border-slate-800/90 bg-[#08101d] px-3 py-3 font-mono text-sm text-slate-200">
            {action.command} {JSON.stringify(action.args)}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="default" size="sm" onClick={() => onApply(actions)}>
          Apply
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  )
})