import { memo } from 'react'
import { Button } from '@/components/ui/button'
import type { ProposedAction } from '@/lib/chat/validator'

interface ActionCardProps {
  actions: ProposedAction[]
  applying?: boolean
  onApply: (actions: ProposedAction[]) => void
  onDiscard: () => void
}

function formatArgs(args: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(args)
  if (entries.length === 0) return null
  return (
    <div className="mt-2 space-y-1 pl-3 text-[12px] text-slate-400">
      {entries.map(([key, val]) => (
        <div key={key}>
          <span className="text-slate-500">{key}:</span>{' '}
          <span className="text-slate-300">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
        </div>
      ))}
    </div>
  )
}

export const ActionCard = memo(function ActionCard({ actions, applying, onApply, onDiscard }: ActionCardProps) {
  if (actions.length === 0) return null

  return (
    <div data-testid="chat-action-card" className="my-3 border border-[#16417C]/70 bg-[#16417C]/14 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Proposed Actions ({actions.length})
        </div>
        <span
          data-testid="chat-action-card-pill"
          className="rounded-full border border-[#16417C]/70 bg-[#08101d] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300"
        >
          Review required
        </span>
      </div>
      <ul className="mb-4 space-y-2">
        {actions.map((action, i) => (
          <li key={i} className="border border-slate-800/90 bg-[#050c17] px-3 py-3 font-mono text-sm text-slate-200">
            <span className="text-sky-300">{action.command}</span>
            {action.args && typeof action.args === 'object'
              ? formatArgs(action.args as Record<string, unknown>)
              : action.args != null
                ? <span className="ml-2 text-slate-400">{String(action.args)}</span>
                : null}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="default" size="sm" onClick={() => onApply(actions)} disabled={applying}>
          {applying ? 'Applying...' : 'Apply'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={applying}>
          Discard
        </Button>
      </div>
    </div>
  )
})
