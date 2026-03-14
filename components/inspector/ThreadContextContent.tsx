'use client'

import { useUIStore } from '@/lib/ui/store'
import { useStatus, useThreadSurfaces, useThreadRuns, useThreadMerges } from '@/lib/ui/api'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'

export function ThreadContextContent() {
  const _selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const { data: status } = useStatus()
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: runs } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()

  const laneBoard = threadSurfaces && runs && mergeEvents
    ? createLaneBoardModel({
        threadSurfaces,
        runs,
        mergeEvents,
        runIds: runs.map(run => run.id),
      })
    : null

  const focusedThreadDetail = threadSurfaces && runs && mergeEvents && laneBoard
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

  if (!focusedThreadDetail) {
    return <div className="text-sm text-slate-500">No thread context available.</div>
  }

  return (
    <div className="space-y-3">
      <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run summary</div>
        <div className="mt-2 text-sm text-slate-100">
          {focusedThreadDetail.runSummary ?? 'No run summary recorded yet.'}
        </div>
      </div>
      <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Thread provenance</div>
        <div className="mt-2 space-y-2 text-sm text-slate-100">
          <div><strong className="text-white">Thread surface:</strong> {focusedThreadDetail.threadSurfaceId}</div>
          <div><strong className="text-white">Run:</strong> {focusedThreadDetail.runId ?? 'No run selected'}</div>
        </div>
      </div>
      <div className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run notes</div>
        <div className="mt-2 text-sm text-slate-100">
          {focusedThreadDetail.runNotes ?? 'No run notes recorded yet.'}
        </div>
      </div>
      {focusedThreadDetail.runDiscussion ? (
        <div className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run discussion</div>
          <div className="mt-2 text-sm text-slate-100">{focusedThreadDetail.runDiscussion}</div>
        </div>
      ) : null}
      {status ? (
        <div className="border border-slate-700 bg-slate-950/65 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Sequence</div>
          <div className="mt-2 text-sm text-slate-100">{status.name}</div>
        </div>
      ) : null}
    </div>
  )
}
