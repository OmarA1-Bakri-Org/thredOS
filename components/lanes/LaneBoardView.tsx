import type { ReactNode } from 'react'

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
  onFocusThread: (threadSurfaceId: string, runId: string) => void
  onBackToHierarchy: () => void
  focusedContent?: ReactNode
}

export function LaneBoardView({
  rows,
  focusedThreadSurfaceId,
  selectedRunId,
  onFocusThread,
  onBackToHierarchy,
  focusedContent,
}: LaneBoardViewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Lane Board</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Execution lanes stay ordered by run truth. Focus follows the selected thread.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToHierarchy}
          className="rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/60"
        >
          Back To Hierarchy
        </button>
      </div>
      <div className="border-b px-4 py-3">
        <div className="flex gap-3 overflow-x-auto pb-2">
          {rows.map(row => {
            const isFocused = row.threadSurfaceId === focusedThreadSurfaceId
            return (
              <button
                key={row.threadSurfaceId}
                type="button"
                data-thread-surface-id={row.threadSurfaceId}
                aria-pressed={isFocused}
                onClick={() => onFocusThread(row.threadSurfaceId, row.runId)}
                className={[
                  'min-w-64 rounded-xl border px-4 py-3 text-left transition-colors',
                  isFocused ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/60',
                ].join(' ')}
              >
                <div className="text-sm font-medium">{row.surfaceLabel}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  execIndex {row.executionIndex ?? 'draft'}
                  {row.laneTerminalState ? ` | ${row.laneTerminalState}` : ''}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {selectedRunId === row.runId ? 'Selected run' : row.runId}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">{focusedContent}</div>
    </div>
  )
}
