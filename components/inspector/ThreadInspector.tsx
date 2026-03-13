import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { SkillBadge } from '@/components/skills/SkillBadgeRow'
import { SkillInventoryPanel } from '@/components/skills/SkillInventoryPanel'

interface ThreadInspectorProps {
  detail: ThreadSurfaceFocusedDetail
  skills?: SkillBadge[]
  testIdPrefix?: string
}

export function ThreadInspector({
  detail,
  skills = [],
  testIdPrefix = 'thread-inspector',
}: ThreadInspectorProps) {
  return (
    <div data-testid={`${testIdPrefix}-inspector`} className="space-y-4">
      {/* ── Thread Identity ── */}
      <section
        data-testid={`${testIdPrefix}-identity`}
        className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread identity</div>
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

      {/* ── Run Context ── */}
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
          <div className="border border-[#16417C]/50 bg-[#16417C]/12 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Notes</div>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-100">{detail.runNotes ?? '—'}</div>
          </div>
          {detail.runDiscussion ? (
            <div className="border border-[#16417C]/50 bg-[#16417C]/12 px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Discussion</div>
              <div className="mt-1.5 text-sm leading-relaxed text-slate-100">{detail.runDiscussion}</div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Skills ── */}
      <section
        data-testid={`${testIdPrefix}-skills`}
        className="border border-slate-700 bg-slate-950/65 px-4 py-4"
      >
        <SkillInventoryPanel skills={skills} />
      </section>

      {/* ── Provenance ── */}
      <section
        data-testid={`${testIdPrefix}-provenance`}
        className="border border-slate-700 bg-slate-950/65 px-4 py-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
        <div className="mt-3 grid gap-3 text-sm text-slate-100 md:grid-cols-2">
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
              {`${detail.incomingMergeGroups.length} in · ${detail.outgoingMergeEvents.length} out`}
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
    </div>
  )
}
