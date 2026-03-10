import type { ReactNode } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowLaneContext } from '@/lib/workflows'

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
  selectedRunId,
  workflowByThreadSurfaceId = {},
  onFocusThread,
  onBackToHierarchy,
  focusedContent,
}: LaneBoardViewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#050913]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 bg-[#08101d] px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Lane Board</h2>
          <p className="mt-2 text-sm text-slate-300">
            Execution lanes remain ordered by run truth. Focus follows the selected thread surface and preserves merge context.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onBackToHierarchy}>
          Back To Hierarchy
        </Button>
      </div>

      <div className="min-h-0 flex flex-1 overflow-hidden">
        <aside
          data-testid="lane-board-roster"
          className="w-[22rem] shrink-0 border-r border-slate-800/80 bg-[#08101d]"
        >
          <div className="border-b border-slate-800/80 px-5 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Lane roster</div>
            <p className="mt-2 text-sm text-slate-300">
              Each lane remains persistent. Focus a thread to inspect its execution plane without collapsing merge truth.
            </p>
          </div>
          <div className="flex max-h-full flex-col gap-3 overflow-y-auto px-4 py-4">
            {rows.map(row => {
              const isFocused = row.threadSurfaceId === focusedThreadSurfaceId
              const workflowContext = workflowByThreadSurfaceId[row.threadSurfaceId]
              return (
                <button
                  key={row.threadSurfaceId}
                  type="button"
                  data-thread-surface-id={row.threadSurfaceId}
                  aria-pressed={isFocused}
                  onClick={() => onFocusThread(row.threadSurfaceId, row.runId)}
                  className={cn(
                    buttonVariants({ variant: isFocused ? 'secondary' : 'outline' }),
                    'h-auto w-full items-start justify-start whitespace-normal px-4 py-4 text-left normal-case tracking-normal',
                    isFocused ? 'border-sky-500/50 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.15)]' : 'text-slate-300',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold tracking-tight">{row.surfaceLabel}</div>
                    <span className="border border-slate-700 bg-slate-950/65 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">
                      {row.executionIndex ?? 'draft'}
                    </span>
                  </div>
                  {workflowContext ? (
                    <div className="mt-3 space-y-2">
                      <div data-testid="lane-workflow-step-name" className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        {workflowContext.stepName}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]">
                        <span data-testid="lane-workflow-badge" className="rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1 text-sky-100">
                          {workflowContext.phaseLabel}
                        </span>
                        <span data-testid="lane-workflow-badge" className="rounded-full border border-slate-700 bg-slate-950/65 px-3 py-1 text-slate-300">
                          {workflowContext.executionLabel}
                        </span>
                        {workflowContext.hasCondition ? (
                          <span data-testid="lane-workflow-condition-flag" className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-100">
                            conditional
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]">
                    {row.laneTerminalState ? (
                      <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-100">
                        {row.laneTerminalState}
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full border px-3 py-1 ${selectedRunId === row.runId
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                        : 'border-slate-700 bg-slate-950/65 text-slate-400'}`}
                    >
                      {selectedRunId === row.runId ? 'Selected run' : row.runId}
                    </span>
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
