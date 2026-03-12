import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowLaneContext } from '@/lib/workflows'

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

interface LaneBoardRowView {
  threadSurfaceId: string
  surfaceLabel: string
  runId: string
  executionIndex?: number
  laneTerminalState?: string
}

interface LaneBoardViewProps {
  rows: LaneBoardRowView[]
  focusedThreadSurfaceId: string | null
  selectedRunId: string | null
  workflowByThreadSurfaceId?: Record<string, WorkflowLaneContext>
  onFocusThread: (threadSurfaceId: string, runId: string) => void
  onBackToHierarchy: () => void
  focusedContent?: ReactNode
}

export function LaneBoardView({
  rows,
  focusedThreadSurfaceId,
  selectedRunId: _selectedRunId,
  workflowByThreadSurfaceId = {},
  onFocusThread,
  onBackToHierarchy,
  focusedContent,
}: LaneBoardViewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#050913]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 bg-[#08101d] px-5 py-4">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Lane Board</h2>
        </div>
        <Button type="button" variant="outline" onClick={onBackToHierarchy}>
          Back To Hierarchy
        </Button>
      </div>

      <div className="min-h-0 flex flex-1 overflow-hidden">
        <aside
          data-testid="lane-board-roster"
          className="flex w-80 shrink-0 flex-col border-r border-slate-800/80 bg-[#08101d]"
        >
          <div className="shrink-0 border-b border-slate-800/80 px-5 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Roster</div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {rows.map(row => {
              const isFocused = row.threadSurfaceId === focusedThreadSurfaceId
              const workflowContext = workflowByThreadSurfaceId[row.threadSurfaceId]
              return (
                <button
                  key={`${row.threadSurfaceId}:${row.runId}`}
                  type="button"
                  data-thread-surface-id={row.threadSurfaceId}
                  aria-pressed={isFocused}
                  onClick={() => onFocusThread(row.threadSurfaceId, row.runId)}
                  className={cn(
                    'w-full text-left px-4 py-3 transition-colors',
                    isFocused
                      ? 'border border-emerald-500/40 border-l-2 border-l-emerald-500 bg-[#0c1525] text-white'
                      : 'border border-slate-800/60 bg-[#08101d] text-slate-300 hover:bg-[#0a1320]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tracking-tight">{row.surfaceLabel}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      #{row.executionIndex ?? '—'}
                    </span>
                  </div>
                  {workflowContext ? (
                    <div className="mt-1.5 text-xs text-slate-400">
                      {workflowContext.phaseLabel} · {workflowContext.executionLabel}
                      {workflowContext.hasCondition ? ' · conditional' : ''}
                    </div>
                  ) : null}
                  {row.laneTerminalState ? (
                    <div className="mt-1 text-[10px] font-mono uppercase tracking-wide text-amber-400/70">
                      {row.laneTerminalState}
                    </div>
                  ) : null}
                  <div className="mt-1.5 font-mono text-[10px] text-slate-600" title={row.runId}>
                    {truncateId(row.runId)}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <div data-testid="lane-board-surface" className="min-w-0 flex-1 overflow-hidden bg-[#050913]">
          {focusedContent}
        </div>
      </div>
    </div>
  )
}
