import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { WorkflowStep } from '@/lib/workflows'
import type { HierarchyViewNode } from '@/components/hierarchy/HierarchyView'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { ThreadFlowPlane } from '@/components/hierarchy/ThreadFlowPlane'
import { contentCreatorWorkflow } from '@/lib/workflows'

function formatScopeList(scopes?: string[]): string {
  return scopes && scopes.length > 0 ? scopes.join(', ') : '—'
}

export function ThreadSurfaceInspector({
  detail,
  workflowStep,
  hierarchyNodes = [],
  hierarchyEdges = [],
  selectedThreadSurfaceId = null,
  onSelectNode,
  testIdPrefix = 'thread-surface',
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
  hierarchyNodes?: HierarchyViewNode[]
  hierarchyEdges?: { source: string; target: string }[]
  selectedThreadSurfaceId?: string | null
  onSelectNode?: (threadSurfaceId: string, runId: string | null) => void
  testIdPrefix?: string
}) {
  return (
    <div data-testid={`${testIdPrefix}-inspector`} className="space-y-4">
      <section
        data-testid={`${testIdPrefix}-summary`}
        className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread surface</div>
        <div className="mt-2 text-xl font-semibold tracking-tight text-white">{detail.surfaceLabel}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          {detail.role ? (
            <span className="border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-200">
              {detail.role}
            </span>
          ) : null}
          {detail.runStatus ? (
            <span className="border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-100">
              {detail.runStatus}
            </span>
          ) : null}
          {detail.executionIndex != null ? (
            <span className="border border-sky-500/35 bg-sky-500/10 px-2.5 py-0.5 text-sky-100">
              idx {detail.executionIndex}
            </span>
          ) : null}
        </div>
        {detail.surfaceDescription ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-200">{detail.surfaceDescription}</p>
        ) : null}
      </section>

      <section
        data-testid={`${testIdPrefix}-surface-policy`}
        className="border border-slate-700 bg-slate-950/65 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Surface policy</div>
        <div className="mt-3 grid gap-3 text-sm text-slate-100 md:grid-cols-2">
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Class</div>
            <div className="mt-1.5 text-white">{detail.surfaceClass ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Visibility</div>
            <div className="mt-1.5 text-white">{detail.visibility ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Reveal state</div>
            <div className="mt-1.5 text-white">{detail.revealState ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Isolation</div>
            <div className="mt-1.5 text-white">{detail.isolationLabel ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Read scopes</div>
            <div className="mt-1.5 break-words text-white">{formatScopeList(detail.allowedReadScopes)}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Write scopes</div>
            <div className="mt-1.5 break-words text-white">{formatScopeList(detail.allowedWriteScopes)}</div>
          </div>
        </div>
      </section>

      {hierarchyNodes.length > 0 && onSelectNode ? (
        <section
          data-testid={`${testIdPrefix}-flow-plane`}
          className="border border-slate-700/60 bg-[#0a101a]/80 px-4 py-4"
        >
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread flow</div>
          <ThreadFlowPlane
            nodes={hierarchyNodes}
            edges={hierarchyEdges}
            selectedThreadSurfaceId={selectedThreadSurfaceId}
            onSelectNode={onSelectNode}
          />
        </section>
      ) : null}

      <section
        data-testid={`${testIdPrefix}-thread-context`}
        className="border border-slate-700 bg-slate-950/65 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
        <div data-testid={`${testIdPrefix}-provenance`} className="mt-3 grid gap-3 text-sm text-slate-100 md:grid-cols-2">
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Surface</div>
            <div className="mt-1.5 break-all text-xs font-medium text-white">{detail.threadSurfaceId}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Run</div>
            <div className="mt-1.5 break-all text-xs font-medium text-white">{detail.runId ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</div>
            <div className="mt-1.5 text-white">{detail.role ?? '—'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Merges</div>
            <div className="mt-1.5 text-white">
              {detail.incomingMergeGroups.length} in · {detail.outgoingMergeEvents.length} out
            </div>
          </div>
          {detail.laneTerminalState ? (
            <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Terminal</div>
              <div className="mt-1.5 text-white">{detail.laneTerminalState}</div>
            </div>
          ) : null}
          {detail.mergedIntoThreadSurfaceId ? (
            <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Merged into</div>
              <div className="mt-1.5 break-all text-white">{detail.mergedIntoThreadSurfaceId}</div>
            </div>
          ) : null}
        </div>
      </section>

      <section
        data-testid={`${testIdPrefix}-run-context`}
        className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Run context</div>
        <div className="mt-3 space-y-3">
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Summary</div>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-100">{detail.runSummary ?? '—'}</div>
          </div>
          <div data-testid={`${testIdPrefix}-run-notes`} className="border border-[#16417C]/50 bg-[#16417C]/12 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Notes</div>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-100">{detail.runNotes ?? '—'}</div>
          </div>
          {detail.runDiscussion ? (
            <div data-testid={`${testIdPrefix}-run-discussion`} className="border border-[#16417C]/50 bg-[#16417C]/12 px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Discussion</div>
              <div className="mt-1.5 text-sm leading-relaxed text-slate-100">{detail.runDiscussion}</div>
            </div>
          ) : null}
        </div>
      </section>

      {detail.incomingMergeGroups.length > 0 || detail.outgoingMergeEvents.length > 0 ? (
        <section
          data-testid={`${testIdPrefix}-merge-detail`}
          className="border border-slate-700 bg-slate-950/65 px-4 py-4"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Merge topology</div>
          <div className="mt-3 space-y-3">
            {detail.incomingMergeGroups.map(group => (
              <div key={group.mergeEventId} className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5 text-sm text-slate-100">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-400">in</span>
                <span className="ml-2">{group.mergeKind} at idx {group.executionIndex}</span>
                <div className="mt-1 text-xs text-slate-400">{group.orderedThreadSurfaceIds.join(' → ')}</div>
              </div>
            ))}
            {detail.outgoingMergeEvents.map(event => (
              <div key={event.id} className="border border-slate-800/90 bg-[#08101d] px-3 py-2.5 text-sm text-slate-100">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400">out</span>
                <span className="ml-2">{event.mergeKind} → {event.destinationThreadSurfaceId}</span>
                <div className="mt-1 text-xs text-slate-400">idx {event.executionIndex}{event.summary ? ` · ${event.summary}` : ''}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div data-testid={`${testIdPrefix}-workflow-context`} className="space-y-4">
        {workflowStep ? (
          <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
            <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
          </section>
        ) : null}

        <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
          <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
        </section>
      </div>
    </div>
  )
}
