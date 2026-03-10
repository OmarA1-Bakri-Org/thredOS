import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { WorkflowStep } from '@/lib/workflows'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { contentCreatorWorkflow } from '@/lib/workflows'

export function ThreadSurfaceInspector({
  detail,
  workflowStep,
  testIdPrefix = 'thread-surface',
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
  testIdPrefix?: string
}) {
  return (
    <div data-testid={`${testIdPrefix}-inspector`} className="space-y-4">
      <section
        data-testid={`${testIdPrefix}-summary`}
        className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Thread / run detail</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{detail.surfaceLabel}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          {detail.role ? (
            <span className="border border-slate-700 bg-slate-950/60 px-3 py-1 text-slate-200">
              {detail.role}
            </span>
          ) : null}
          {detail.runStatus ? (
            <span className="border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-100">
              {detail.runStatus}
            </span>
          ) : null}
          {detail.executionIndex != null ? (
            <span className="border border-sky-500/35 bg-sky-500/10 px-3 py-1 text-sky-100">
              execIndex {detail.executionIndex}
            </span>
          ) : null}
        </div>
        {detail.surfaceDescription ? (
          <p className="mt-3 text-sm text-slate-200">{detail.surfaceDescription}</p>
        ) : null}
      </section>

      <div data-testid={`${testIdPrefix}-thread-context`} className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-4">
          <section
            data-testid={`${testIdPrefix}-thread-context-panel`}
            className="border border-slate-700 bg-slate-950/65 px-4 py-4"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Thread context</div>
            <div className="mt-3 grid gap-3 text-sm text-slate-100 md:grid-cols-2">
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Thread surface</div>
                <div className="mt-2 break-all font-medium text-white">{detail.threadSurfaceId}</div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</div>
                <div className="mt-2 text-white">{detail.role ?? 'No role assigned'}</div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3 md:col-span-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Thread brief</div>
                <div className="mt-2 text-slate-200">
                  {detail.surfaceDescription ?? 'No thread context recorded yet.'}
                </div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Incoming merges</div>
                <div className="mt-2 text-white">
                  {detail.incomingMergeGroups.length > 0
                    ? `${detail.incomingMergeGroups.length} merge group${detail.incomingMergeGroups.length === 1 ? '' : 's'} active`
                    : 'No inbound merges selected.'}
                </div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Outgoing merges</div>
                <div className="mt-2 text-white">
                  {detail.outgoingMergeEvents.length > 0
                    ? `${detail.outgoingMergeEvents.length} downstream merge event${detail.outgoingMergeEvents.length === 1 ? '' : 's'}`
                    : 'No downstream merges recorded.'}
                </div>
              </div>
            </div>
          </section>

          <section
            data-testid={`${testIdPrefix}-provenance`}
            className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
            <div className="mt-3 grid gap-3 text-sm text-slate-100 md:grid-cols-2">
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Thread surface</div>
                <div className="mt-2 break-all font-medium text-white">{detail.threadSurfaceId}</div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run</div>
                <div className="mt-2 break-all font-medium text-white">{detail.runId ?? 'No run selected'}</div>
              </div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3 md:col-span-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Summary</div>
                <div className="mt-2 text-slate-200">{detail.runSummary ?? 'No run summary recorded yet.'}</div>
              </div>
              {detail.laneTerminalState ? (
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Terminal state</div>
                  <div className="mt-2 text-white">{detail.laneTerminalState}</div>
                </div>
              ) : null}
              {detail.mergedIntoThreadSurfaceId ? (
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Merged into</div>
                  <div className="mt-2 break-all text-white">{detail.mergedIntoThreadSurfaceId}</div>
                </div>
              ) : null}
            </div>
          </section>

          <section
            data-testid={`${testIdPrefix}-run-context`}
            className="border border-slate-700 bg-slate-950/65 px-4 py-4"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Run context</div>
            <div className="mt-3 space-y-3">
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected run</div>
                <div className="mt-2 break-all text-sm text-white">{detail.runId ?? 'No run selected'}</div>
              </div>
              <div
                data-testid={`${testIdPrefix}-run-notes`}
                className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Notes</div>
                <div className="mt-2 text-sm text-slate-100">{detail.runNotes ?? 'No run notes recorded yet.'}</div>
              </div>
              <div
                data-testid={`${testIdPrefix}-run-discussion`}
                className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Discussion</div>
                <div className="mt-2 text-sm text-slate-100">
                  {detail.runDiscussion ?? 'No run discussion recorded yet.'}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          {workflowStep ? (
            <section
              data-testid={`${testIdPrefix}-workflow-detail`}
              className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
            >
              <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
            </section>
          ) : null}

          <section
            data-testid={`${testIdPrefix}-workflow-blueprint`}
            className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
          >
            <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
          </section>
        </div>
      </div>
    </div>
  )
}
