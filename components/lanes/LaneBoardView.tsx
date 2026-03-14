import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowLaneContext } from '@/lib/workflows'

interface LaneBoardRowView {
  threadSurfaceId: string
  surfaceLabel: string
  runId: string
  executionIndex?: number
  laneTerminalState?: string
  depth?: number
  childCount?: number
  isCollapsed?: boolean
  parentThreadSurfaceId?: string | null
}

function statusDotColor(state: string | undefined): string {
  switch (state) {
    case 'merged': return 'bg-emerald-400'
    case 'running': return 'bg-sky-400 animate-pulse'
    case 'successful': return 'bg-emerald-400'
    case 'failed': return 'bg-rose-400'
    case 'stopped': return 'bg-amber-400'
    default: return 'bg-slate-500'
  }
}

interface LaneBoardViewProps {
  rows: LaneBoardRowView[]
  focusedThreadSurfaceId: string | null
  selectedRunId: string | null
  workflowByThreadSurfaceId?: Record<string, WorkflowLaneContext>
  onFocusThread: (threadSurfaceId: string, runId: string) => void
  onBackToHierarchy: () => void
  onToggleCollapse?: (threadSurfaceId: string) => void
  focusedContent?: ReactNode
}

export function LaneBoardView({
  rows,
  focusedThreadSurfaceId,
  selectedRunId: _selectedRunId,
  workflowByThreadSurfaceId: _workflowByThreadSurfaceId = {},
  onFocusThread,
  onBackToHierarchy,
  onToggleCollapse,
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
              const depth = row.depth ?? 0
              return (
                <div
                  key={`${row.threadSurfaceId}:${row.runId}`}
                  className={cn(depth > 0 && 'border-l-2 border-slate-700/50')}
                  style={{ paddingLeft: `${16 + depth * 20}px` }}
                >
                  <button
                    type="button"
                    data-thread-surface-id={row.threadSurfaceId}
                    aria-pressed={isFocused}
                    aria-label={`Focus thread ${row.surfaceLabel}`}
                    onClick={() => onFocusThread(row.threadSurfaceId, row.runId)}
                    className={cn(
                      'w-full text-left px-5 py-3.5 transition-colors',
                      isFocused
                        ? 'border border-emerald-500/40 border-l-2 border-l-emerald-500 bg-[#0c1525] text-white'
                        : 'border border-slate-800/60 bg-[#08101d] text-slate-300 hover:bg-[#0a1320]',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {(row.childCount ?? 0) > 0 && (
                        <button
                          type="button"
                          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors text-[10px] w-4"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleCollapse?.(row.threadSurfaceId)
                          }}
                          aria-label={row.isCollapsed ? 'Expand children' : 'Collapse children'}
                        >
                          {row.isCollapsed ? '▶' : '▼'}
                        </button>
                      )}
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDotColor(row.laneTerminalState))} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{row.surfaceLabel}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-500">
                        #{row.executionIndex ?? '—'}
                      </span>
                    </div>
                  </button>
                  {row.isCollapsed && (row.childCount ?? 0) > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 ml-5">
                      <span className="font-mono text-[9px] text-slate-600">
                        {row.childCount} child{(row.childCount ?? 0) > 1 ? 'ren' : ''} collapsed
                      </span>
                    </div>
                  )}
                </div>
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
