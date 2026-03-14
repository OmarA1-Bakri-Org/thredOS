import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowLaneContext } from '@/lib/workflows'
import type { LaneBoardMergeGroup } from './useLaneBoard'

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
  mergeGroups?: LaneBoardMergeGroup[]
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
  mergeGroups = [],
  focusedThreadSurfaceId,
  selectedRunId: _selectedRunId,
  workflowByThreadSurfaceId: _workflowByThreadSurfaceId = {},
  onFocusThread,
  onBackToHierarchy,
  onToggleCollapse,
  focusedContent,
}: LaneBoardViewProps) {
  // Build lookup: which merge groups does each destination row participate in?
  const mergeGroupByDestination = new Map<string, LaneBoardMergeGroup[]>()
  const mergeSourceIds = new Set<string>()
  for (const mg of mergeGroups) {
    const existing = mergeGroupByDestination.get(mg.destinationThreadSurfaceId) ?? []
    existing.push(mg)
    mergeGroupByDestination.set(mg.destinationThreadSurfaceId, existing)
    for (const id of mg.orderedThreadSurfaceIds) {
      if (id !== mg.destinationThreadSurfaceId) mergeSourceIds.add(id)
    }
  }

  // Build row index lookup for merge connector positioning
  const rowIndexById = new Map<string, number>()
  rows.forEach((row, idx) => rowIndexById.set(row.threadSurfaceId, idx))
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
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {rows.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 py-8">
                <p className="font-mono text-[11px] text-slate-500">
                  No lanes yet — run a sequence to see execution lanes
                </p>
              </div>
            ) : (
            <div className="relative space-y-3">
              {/* Merge connector lines — CSS bracket/connector pattern */}
              {mergeGroups.map(mg => {
                const sourceIds = mg.orderedThreadSurfaceIds.filter(id => id !== mg.destinationThreadSurfaceId)
                if (sourceIds.length < 2) return null
                const sourceIndices = sourceIds.map(id => rowIndexById.get(id)).filter((idx): idx is number => idx != null)
                const destIndex = rowIndexById.get(mg.destinationThreadSurfaceId)
                if (sourceIndices.length < 2 || destIndex == null) return null
                const minIdx = Math.min(...sourceIndices)
                const maxIdx = Math.max(...sourceIndices)
                // Each row is ~56px tall + 12px gap (space-y-3), compute offsets
                const rowHeight = 68
                const topPx = minIdx * rowHeight + 28
                const heightPx = (maxIdx - minIdx) * rowHeight
                const destTopPx = destIndex * rowHeight + 28
                return (
                  <div
                    key={`merge-connector-${mg.mergeEventId}`}
                    data-testid={`merge-connector-${mg.mergeEventId}`}
                    className="pointer-events-none absolute left-0 z-10"
                    style={{ top: 0 }}
                  >
                    {/* Vertical line connecting source lanes */}
                    <div
                      className="absolute border-l-2 border-emerald-500/40"
                      style={{
                        left: 6,
                        top: topPx,
                        height: heightPx,
                      }}
                    />
                    {/* Horizontal tick marks for each source */}
                    {sourceIndices.map(idx => (
                      <div
                        key={`tick-${idx}`}
                        className="absolute border-t-2 border-emerald-500/40"
                        style={{
                          left: 6,
                          top: idx * rowHeight + 28,
                          width: 8,
                        }}
                      />
                    ))}
                    {/* Arrow pointing to destination */}
                    <div
                      className="absolute flex items-center"
                      style={{
                        left: 6,
                        top: destTopPx - 1,
                      }}
                    >
                      <div className="border-t-2 border-emerald-500/60" style={{ width: 10 }} />
                      <div
                        className="border-y-4 border-l-[6px] border-y-transparent border-l-emerald-500/60"
                      />
                    </div>
                  </div>
                )
              })}

              {rows.map((row, rowIndex) => {
                const isFocused = row.threadSurfaceId === focusedThreadSurfaceId
                const depth = row.depth ?? 0
                const isMerged = row.laneTerminalState === 'merged'
                const destinationMergeGroups = mergeGroupByDestination.get(row.threadSurfaceId) ?? []
                return (
                  <div key={`${row.threadSurfaceId}:${row.runId}`}>
                    {/* Gate diamond markers for merge groups targeting this destination */}
                    {destinationMergeGroups.map(mg => {
                      const sourceCount = mg.orderedThreadSurfaceIds.length - 1
                      const isPending = !isMerged && row.laneTerminalState !== 'successful'
                      return (
                        <div
                          key={`merge-diamond-${mg.mergeEventId}`}
                          data-testid={`merge-diamond-${mg.mergeEventId}`}
                          className="flex items-center justify-center gap-3 py-2"
                        >
                          {/* Diamond shape — matching GateNode rotate-45 pattern */}
                          <div
                            className="flex items-center justify-center"
                            style={{ width: 28, height: 28 }}
                          >
                            <div
                              className={cn(
                                'flex items-center justify-center',
                                isPending
                                  ? 'border-sky-500/60 shadow-[0_0_12px_rgba(14,165,233,0.1)]'
                                  : 'border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.1)]',
                              )}
                              style={{
                                width: 20,
                                height: 20,
                                transform: 'rotate(45deg)',
                                background: isPending
                                  ? 'linear-gradient(135deg, rgba(14,165,233,0.1), #0a101a 70%)'
                                  : 'linear-gradient(135deg, rgba(16,185,129,0.1), #0a101a 70%)',
                                border: `1.5px solid ${isPending ? 'rgba(14,165,233,0.6)' : 'rgba(16,185,129,0.6)'}`,
                              }}
                            >
                              <div style={{ transform: 'rotate(-45deg)' }}>
                                <div
                                  className={cn(
                                    'font-mono text-[7px] uppercase tracking-[0.08em] font-medium',
                                    isPending ? 'text-sky-400' : 'text-emerald-400',
                                  )}
                                >
                                  M
                                </div>
                              </div>
                            </div>
                          </div>
                          {/* Merge kind label */}
                          <div className="flex items-center gap-2">
                            <span
                              data-testid={`merge-kind-${mg.mergeEventId}`}
                              className={cn(
                                'font-mono text-[9px] uppercase tracking-[0.16em]',
                                isPending ? 'text-sky-500' : 'text-emerald-500',
                              )}
                            >
                              {mg.mergeKind}
                            </span>
                            {/* Count badge for block merges */}
                            {mg.mergeKind === 'block' && sourceCount > 1 && (
                              <span
                                data-testid={`merge-count-${mg.mergeEventId}`}
                                className={cn(
                                  'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] font-medium',
                                  isPending
                                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
                                )}
                              >
                                {sourceCount} &rarr; 1
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Row */}
                    <div
                      className={cn(
                        depth > 0 && 'border-l-2 border-slate-700/50',
                        isMerged && 'border-l-2 border-l-emerald-800/40',
                      )}
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
                          isMerged && 'opacity-50',
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
                        {/* Merged terminal state label */}
                        {isMerged && (
                          <div
                            data-testid={`lane-merged-label-${row.threadSurfaceId}`}
                            className="mt-1 ml-5 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-600"
                          >
                            Merged
                          </div>
                        )}
                      </button>
                      {row.isCollapsed && (row.childCount ?? 0) > 0 && (
                        <div className="mt-1 flex items-center gap-1.5 ml-5">
                          <span className="font-mono text-[9px] text-slate-600">
                            {row.childCount} child{(row.childCount ?? 0) > 1 ? 'ren' : ''} collapsed
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </div>
        </aside>

        <div data-testid="lane-board-surface" className="min-w-0 flex-1 overflow-hidden bg-[#050913]">
          {focusedContent}
        </div>
      </div>
    </div>
  )
}
