'use client'

import { useState } from 'react'
import { Play, Square, RotateCcw, Activity, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useRunRunnable, useThreadRuns, useThreadSurfaces, useThreadMerges, useTraces, useApprovals } from '@/lib/ui/api'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import { resolveDefaultDisplayRun } from '@/lib/thread-surfaces/projections'

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null
  return (
    <div className={`border bg-transparent px-2.5 py-1.5 ${color}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white">{count}</div>
    </div>
  )
}

export function RunSection() {
  const runRunnable = useRunRunnable()
  const [confirmRun, setConfirmRun] = useState(false)
  const { data: status } = useStatus()
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: runs } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()

  // Resolve focused thread detail for provenance/notes
  const laneBoard = threadSurfaces && runs && mergeEvents
    ? createLaneBoardModel({
        threadSurfaces,
        runs,
        mergeEvents,
        runIds: runs.map(run => run.id),
      })
    : null

  const focusedDetail = threadSurfaces && runs && mergeEvents && laneBoard
    ? resolveThreadSurfaceFocusedDetail({
        threadSurfaces,
        runs,
        mergeEvents,
        rows: laneBoard.rows,
        mergeGroups: laneBoard.mergeGroups,
        focusedThreadSurfaceId: selectedThreadSurfaceId,
        selectedRunId,
      })
    : null

  const activeRunId = selectedRunId
    ?? focusedDetail?.runId
    ?? (runs ? resolveDefaultDisplayRun(runs)?.id ?? null : null)
  const { data: traceEvents } = useTraces(activeRunId)
  const { data: approvals } = useApprovals(activeRunId)
  const recentRuns = runs ? [...runs].reverse().slice(0, 5) : []

  return (
    <div className="space-y-4" data-testid="run-section">
      {/* Run Controls */}
      <div className="space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Controls</div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="default"
            onClick={() => setConfirmRun(true)}
            disabled={runRunnable.isPending}
            className="gap-1.5"
          >
            <Play className="h-4 w-4" />
            {runRunnable.isPending ? 'Running...' : 'Run all'}
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" disabled>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" disabled>
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
        </div>
      </div>

      {/* Status Overview */}
      {status && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Status</div>
          <div className="grid grid-cols-4 gap-1.5">
            <StatusBadge label="Ready" count={status.summary.ready} color="border-slate-700 text-slate-400" />
            <StatusBadge label="Active" count={status.summary.running} color="border-sky-500/30 text-sky-300" />
            <StatusBadge label="Done" count={status.summary.done} color="border-emerald-500/30 text-emerald-300" />
            <StatusBadge label="Failed" count={status.summary.failed} color="border-rose-500/30 text-rose-300" />
          </div>
        </div>
      )}

      {activeRunId && (
        <div data-testid="run-control-plane" className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Control plane</div>
          <div className="grid grid-cols-2 gap-2">
            <div data-testid="run-trace-summary" className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Trace events</div>
              <div data-testid="run-trace-count" className="mt-2 text-lg font-semibold text-white">
                {traceEvents?.length ?? 0}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Latest: {traceEvents && traceEvents.length > 0
                  ? String((traceEvents[traceEvents.length - 1] as { event_type?: string }).event_type ?? 'unknown')
                  : 'No events recorded'}
              </div>
            </div>
            <div data-testid="run-approval-summary" className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Approvals</div>
              <div data-testid="run-approval-count" className="mt-2 text-lg font-semibold text-white">
                {approvals?.length ?? 0}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Latest: {approvals && approvals.length > 0
                  ? String((approvals[approvals.length - 1] as { status?: string }).status ?? 'unknown')
                  : 'No approvals recorded'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Run Provenance */}
      {focusedDetail && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Provenance</div>
          <div className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
            <div className="space-y-2 text-sm text-slate-100">
              <div>
                <strong className="text-white">Surface:</strong> {focusedDetail.threadSurfaceId}
              </div>
              <div>
                <strong className="text-white">Run:</strong> {focusedDetail.runId ?? 'No run selected'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Run Summary */}
      {focusedDetail && (
        <div className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run summary</div>
          <div className="mt-2 text-sm text-slate-100">
            {focusedDetail.runSummary ?? 'No run summary recorded yet.'}
          </div>
        </div>
      )}

      {/* Run Notes */}
      {focusedDetail && (
        <div className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Notes</div>
          <div className="mt-2 text-sm text-slate-100">
            {focusedDetail.runNotes ?? 'No run notes recorded yet.'}
          </div>
        </div>
      )}

      {/* Run Discussion */}
      {focusedDetail?.runDiscussion && (
        <div className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Discussion</div>
          <div className="mt-2 text-sm text-slate-100">{focusedDetail.runDiscussion}</div>
        </div>
      )}

      {/* Run History */}
      {recentRuns.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run history</div>
          <div className="space-y-1">
            {recentRuns.map((run: { id: string; status?: string; runStatus?: string; startedAt?: string }) => {
              const runStatus = run.runStatus ?? run.status ?? 'pending'
              return (
                <div key={run.id} className="flex items-center justify-between border border-slate-800 bg-[#0a101a] px-3 py-2">
                  <div className="flex items-center gap-2">
                    {runStatus === 'successful' ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    ) : runStatus === 'failed' || runStatus === 'cancelled' ? (
                      <XCircle className="h-3 w-3 text-rose-400" />
                    ) : (
                      <Activity className="h-3 w-3 text-sky-400" />
                    )}
                    <span className="font-mono text-[10px] text-slate-300">{run.id}</span>
                  </div>
                  {run.startedAt && (
                    <span className="flex items-center gap-1 font-mono text-[9px] text-slate-600">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRun}
        title="Run runnable frontier?"
        description="This dispatches the current runnable steps and acknowledges SAFE mode confirmation before hosted execution."
        confirmLabel="Run all"
        tone="default"
        onCancel={() => setConfirmRun(false)}
        onConfirm={() => {
          setConfirmRun(false)
          runRunnable.mutate({ confirmPolicy: true })
        }}
      />
    </div>
  )
}
