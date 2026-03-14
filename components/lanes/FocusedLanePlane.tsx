import type { ReactNode } from 'react'
import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { WorkflowStep, WorkflowDefinition } from '@/lib/workflows'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { contentCreatorWorkflow } from '@/lib/workflows'

export function FocusedLanePlane({
  detail,
  workflowStep,
  workflow,
  sequenceView,
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
  workflow?: WorkflowDefinition
  sequenceView?: ReactNode
}) {
  const compactStepSummary = workflowStep
    ? {
        phase: `Phase ${workflowStep.phase}`,
        execution: workflowStep.execution.replace('_', ' '),
        dependencies: workflowStep.dependsOn.length > 0 ? workflowStep.dependsOn.join(', ') : 'None',
        outputs: workflowStep.outputKeys.length,
        gates: workflowStep.gateCount,
        condition: workflowStep.condition,
      }
    : null

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
        {detail.surfaceDescription ? <p className="mt-2 text-sm text-slate-300">{detail.surfaceDescription}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <span>{detail.threadSurfaceId}</span>
          <span>·</span>
          <span>{detail.runId ?? '—'}</span>
          <span>·</span>
          <span>idx {detail.executionIndex ?? '—'}</span>
          {detail.laneTerminalState ? <><span>·</span><span>{detail.laneTerminalState}</span></> : null}
          {detail.mergedIntoThreadSurfaceId ? <><span>·</span><span>→ {detail.mergedIntoThreadSurfaceId}</span></> : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div data-testid="focused-lane-primary" className="space-y-4">
          <section data-testid="lane-execution-brief" className="border border-[#16417C]/70 bg-[#16417C]/18 p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Execution brief</h4>
            <p className="mt-3 text-sm text-slate-100">
              {detail.runSummary ?? '—'}
            </p>
            {compactStepSummary ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Phase</div>
                  <div className="mt-2 text-sm font-medium text-white">{compactStepSummary.phase}</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Execution</div>
                  <div className="mt-2 text-sm font-medium text-white">{compactStepSummary.execution}</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Outputs</div>
                  <div className="mt-2 text-sm font-medium text-white">{compactStepSummary.outputs}</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Dependencies</div>
                  <div className="mt-2 text-sm text-slate-100">{compactStepSummary.dependencies}</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Gate refs</div>
                  <div className="mt-2 text-sm font-medium text-white">{compactStepSummary.gates}</div>
                </div>
                {compactStepSummary.condition ? (
                  <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3 md:col-span-2 xl:col-span-1">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Condition</div>
                    <div className="mt-2 text-sm text-slate-100">{compactStepSummary.condition}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="border border-slate-700 bg-slate-950/65 p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Run notes</h4>
            <p className="mt-3 text-sm text-slate-100">{detail.runNotes ?? '—'}</p>
            {detail.runDiscussion ? (
              <div className="mt-3 border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-300">
                {detail.runDiscussion}
              </div>
            ) : null}
          </section>

          {sequenceView ? (
            <section className="border border-slate-700 bg-slate-950/65 p-4">
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Sequence view</h4>
              <div className="mt-3 h-112 overflow-hidden border border-slate-800">{sequenceView}</div>
            </section>
          ) : null}
        </div>

        <aside data-testid="focused-lane-context-column" className="space-y-4 border border-[#16417C]/70 bg-[#16417C]/18 p-4">
          <section data-testid="focused-lane-blueprint" className="space-y-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Workflow context</div>
            <WorkflowBlueprintPanel workflow={workflow ?? contentCreatorWorkflow} />
          </section>

          <section className="border border-slate-800 bg-[#0a101a] p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incoming merges</h4>
            {detail.incomingMergeGroups.length > 0 ? (
              <div className="mt-3 space-y-3">
                {detail.incomingMergeGroups.map(group => (
                  <div key={group.mergeEventId} className="border border-slate-800/90 bg-[#08101d] px-3 py-3 text-sm text-slate-100">
                    <div className="font-medium text-white">{group.mergeKind} merge at execIndex {group.executionIndex}</div>
                    <div className="mt-1 text-slate-400">{group.orderedThreadSurfaceIds.join(' <- ')}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">—</p>
            )}
          </section>

          <section className="border border-slate-800 bg-[#0a101a] p-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Outgoing merges</h4>
            {detail.outgoingMergeEvents.length > 0 ? (
              <div className="mt-3 space-y-3">
                {detail.outgoingMergeEvents.map(event => (
                  <div key={event.id} className="border border-slate-800/90 bg-[#08101d] px-3 py-3 text-sm text-slate-100">
                    <div className="font-medium text-white">{event.mergeKind} merge into {event.destinationThreadSurfaceId}</div>
                    <div className="mt-1 text-slate-400">execIndex {event.executionIndex}{event.summary ? ` | ${event.summary}` : ''}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">—</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
