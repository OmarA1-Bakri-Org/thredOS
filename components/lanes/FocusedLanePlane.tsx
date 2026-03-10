import type { ReactNode } from 'react'
import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { WorkflowStep } from '@/lib/workflows'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { contentCreatorWorkflow } from '@/lib/workflows'

export function FocusedLanePlane({
  detail,
  workflowStep,
  sequenceView,
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
  sequenceView?: ReactNode
}) {
  return (
    <div data-testid="focused-lane-plane" className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-slate-800/80 bg-[#08101d] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-white">{detail.surfaceLabel}</h3>
          {detail.role ? (
            <span className="rounded-full border border-slate-700 bg-slate-950/65 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
              {detail.role}
            </span>
          ) : null}
          {detail.runStatus ? (
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-100">
              {detail.runStatus}
            </span>
          ) : null}
        </div>
        {detail.surfaceDescription ? (
          <p className="mt-2 text-sm text-slate-300">{detail.surfaceDescription}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
          <span>thread {detail.threadSurfaceId}</span>
          <span>run {detail.runId ?? 'none'}</span>
          <span>execIndex {detail.executionIndex ?? 'draft'}</span>
          {detail.laneTerminalState ? <span>{detail.laneTerminalState}</span> : null}
          {detail.mergedIntoThreadSurfaceId ? <span>merged into {detail.mergedIntoThreadSurfaceId}</span> : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div data-testid="focused-lane-primary" className="space-y-4">
          {workflowStep ? (
            <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
          ) : (
            <section className="border border-[#16417C]/70 bg-[#16417C]/18 p-4">
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Execution context
              </h4>
              <p className="mt-3 text-sm text-slate-100">
                {detail.runSummary ?? 'No workflow step is currently mapped to this lane.'}
              </p>
            </section>
          )}

          <section className="border border-slate-700 bg-slate-950/65 p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Run notes
            </h4>
            <p className="mt-3 text-sm text-slate-100">{detail.runNotes ?? 'No run notes recorded yet.'}</p>
            {detail.runDiscussion ? (
              <div className="mt-3 border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-300">
                {detail.runDiscussion}
              </div>
            ) : null}
          </section>

          {sequenceView ? (
            <section className="border border-slate-700 bg-slate-950/65 p-4">
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Sequence view
              </h4>
              <div className="mt-3 h-[28rem] overflow-hidden border border-slate-800">{sequenceView}</div>
            </section>
          ) : null}
        </div>

        <aside
          data-testid="focused-lane-context-column"
          className="space-y-4 border border-[#16417C]/70 bg-[#16417C]/18 p-4"
        >
          <section className="space-y-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Workflow context</div>
            <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
          </section>

          <section className="border border-slate-800 bg-[#0a101a] p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Incoming merges
            </h4>
            {detail.incomingMergeGroups.length > 0 ? (
              <div className="mt-3 space-y-3">
                {detail.incomingMergeGroups.map(group => (
                  <div
                    key={group.mergeEventId}
                    className="border border-slate-800/90 bg-[#08101d] px-3 py-3 text-sm text-slate-100"
                  >
                    <div className="font-medium text-white">
                      {group.mergeKind} merge at execIndex {group.executionIndex}
                    </div>
                    <div className="mt-1 text-slate-400">{group.orderedThreadSurfaceIds.join(' <- ')}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No inbound merges recorded for this thread.</p>
            )}
          </section>

          <section className="border border-slate-800 bg-[#0a101a] p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Outgoing merges
            </h4>
            {detail.outgoingMergeEvents.length > 0 ? (
              <div className="mt-3 space-y-3">
                {detail.outgoingMergeEvents.map(event => (
                  <div
                    key={event.id}
                    className="border border-slate-800/90 bg-[#08101d] px-3 py-3 text-sm text-slate-100"
                  >
                    <div className="font-medium text-white">
                      {event.mergeKind} merge into {event.destinationThreadSurfaceId}
                    </div>
                    <div className="mt-1 text-slate-400">
                      execIndex {event.executionIndex}
                      {event.summary ? ` | ${event.summary}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">This thread has not merged into another lane.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
