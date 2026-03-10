import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { WorkflowStep } from '@/lib/workflows'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { contentCreatorWorkflow } from '@/lib/workflows'

export function ThreadSurfaceInspector({
  detail,
  workflowStep,
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
}) {
  return (
    <div data-testid="thread-surface-inspector" className="space-y-4">
      <section
        data-testid="thread-surface-summary"
        className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Thread / run detail</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{detail.surfaceLabel}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          {detail.role ? (
            <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-slate-200">
              {detail.role}
            </span>
          ) : null}
          {detail.runStatus ? (
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-100">
              {detail.runStatus}
            </span>
          ) : null}
          {detail.executionIndex != null ? (
            <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1 text-sky-100">
              execIndex {detail.executionIndex}
            </span>
          ) : null}
        </div>
        {detail.surfaceDescription ? (
          <p className="mt-3 text-sm text-slate-200">{detail.surfaceDescription}</p>
        ) : null}
      </section>

      <section
        data-testid="thread-surface-provenance"
        className="border border-slate-700 bg-slate-950/65 px-4 py-4"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
        <div className="mt-3 space-y-2 text-sm text-slate-100">
          <div><strong className="text-white">Thread surface:</strong> {detail.threadSurfaceId}</div>
          <div><strong className="text-white">Run:</strong> {detail.runId ?? 'No run selected'}</div>
          <div><strong className="text-white">Summary:</strong> {detail.runSummary ?? 'No run summary recorded yet.'}</div>
          <div><strong className="text-white">Notes:</strong> {detail.runNotes ?? 'No run notes recorded yet.'}</div>
          <div><strong className="text-white">Discussion:</strong> {detail.runDiscussion ?? 'No run discussion recorded yet.'}</div>
          {detail.laneTerminalState ? (
            <div><strong className="text-white">Terminal state:</strong> {detail.laneTerminalState}</div>
          ) : null}
          {detail.mergedIntoThreadSurfaceId ? (
            <div><strong className="text-white">Merged into:</strong> {detail.mergedIntoThreadSurfaceId}</div>
          ) : null}
        </div>
      </section>

      {workflowStep ? (
        <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
      ) : null}

      <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
    </div>
  )
}
