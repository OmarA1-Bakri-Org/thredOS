'use client'

import { useCallback } from 'react'
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react'
import { X, Box, Bot, Folder, Globe, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useAgentProfile } from '@/lib/ui/api'
import { deriveStepThreadSurfaceId } from '@/lib/thread-surfaces/constants'
import type { ThreadRubricMetric } from '@/components/hierarchy/FocusedThreadCard'
import type { ThreadSkillBadge } from '@/lib/thread-surfaces/types'

/* ── Skill icon map (shared with FocusedThreadCard) ───────────────── */

const skillIcons = {
  search: Search,
  browser: Globe,
  files: Folder,
  tools: Wrench,
  model: Bot,
  review: ShieldCheck,
  orchestration: Sparkles,
} as const

function SkillIcon({ skill }: { skill: ThreadSkillBadge }) {
  const Icon = skillIcons[skill.id as keyof typeof skillIcons] ?? Box
  return (
    <div
      className={`grid h-6 w-6 place-items-center border ${
        skill.inherited
          ? 'border-slate-800 bg-slate-950/70 text-slate-500'
          : 'border-slate-700 bg-slate-900 text-slate-200'
      }`}
      title={skill.label}
    >
      <Icon className="h-3 w-3" />
    </div>
  )
}

/* ── Stat bar — 10-segment rubric bar ─────────────────────────────── */

function segmentColor(_index: number, total: number): string {
  if (total <= 3) return 'border-rose-400/25 bg-rose-400/60'
  if (total <= 5) return 'border-amber-400/25 bg-amber-400/60'
  if (total <= 7) return 'border-sky-400/25 bg-sky-400/60'
  return 'border-emerald-400/25 bg-emerald-400/60'
}

function StatBar({ value }: { value: number }) {
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 border ${
            i < value ? segmentColor(i, value) : 'border-slate-900 bg-slate-900/80'
          }`}
        />
      ))}
    </div>
  )
}

/* ── Agent Detail Card ────────────────────────────────────────────── */

/**
 * Trading-card-style agent profile card rendered ON the canvas.
 * Positioned ABOVE the selected node — mirrors FocusedThreadCard's
 * visual language: division/classification badges, Thread Power + Weight
 * score boxes, Skill Inventory icon grid, Rubric stat bars, and
 * builder/pack provenance.
 *
 * Only renders when an agent profile exists for the selected node.
 * Falls back to nothing (the NodeDetailCard below handles step data).
 */
export function AgentDetailCard() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)

  // Derive the thread surface ID from the selected node
  const threadSurfaceId = selectedNodeId ? deriveStepThreadSurfaceId(selectedNodeId) : null
  const { data: profile } = useAgentProfile(threadSurfaceId)

  const { getNode } = useReactFlow()
  const transform = useFlowStore(s => s.transform) // [tx, ty, zoom]

  const dismiss = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId])

  if (!selectedNodeId || !profile) return null

  const flowNode = getNode(selectedNodeId)
  if (!flowNode) return null

  // ── Positioning: centered above the node ──────────────────────────
  const nodeWidth = flowNode.measured?.width ?? (flowNode.type === 'gateNode' ? 96 : 220)
  const zoom = transform[2]
  const tx = transform[0]
  const ty = transform[1]
  const cardHalfW = 160 // half of 320px card width
  const cardX = (flowNode.position.x + nodeWidth / 2 - cardHalfW) * zoom + tx
  // Position at node top edge minus 16 canvas-px gap; card grows upward via translateY(-100%)
  const cardY = (flowNode.position.y - 16) * zoom + ty

  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left: cardX,
        top: cardY,
        zIndex: 999,
        transformOrigin: '0 100%',
        transform: `translateY(-100%) scale(${zoom})`,
      }}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <article
        data-testid="agent-detail-card"
        className="relative w-[320px] overflow-hidden border border-slate-700/80 bg-[#0a101a] shadow-[0_28px_80px_rgba(0,0,0,0.54)]"
      >
        {/* ── HUD corner brackets ────────────────────────────────── */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-[1.5px] border-l-[1.5px] border-sky-400/50" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-[1.5px] border-r-[1.5px] border-sky-400/50" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-[1.5px] border-l-[1.5px] border-sky-400/50" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-[1.5px] border-r-[1.5px] border-sky-400/50" />

        {/* ── Top accent gradient bar ────────────────────────────── */}
        <div
          className="h-[2px] w-full"
          style={{ background: 'linear-gradient(90deg, #38bdf8cc, #38bdf815)' }}
        />

        {/* ── Left edge agent indicator ──────────────────────────── */}
        <div
          className="absolute left-0 top-[2px] bottom-0 w-[2px]"
          style={{ background: 'linear-gradient(180deg, #818cf8, #818cf830)' }}
        />

        {/* ── Division / Classification / Placement badges ───────── */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 px-4 pt-3 pb-2.5">
          <div className="flex flex-wrap gap-1.5 flex-1">
            <span className="rounded-full border border-sky-500/40 bg-sky-500/8 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-sky-100">
              {profile.division}
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/8 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              {profile.classification}
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100">
              {profile.placement}
            </span>
            {profile.verified && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100 shadow-[0_0_18px_rgba(83,245,138,0.14)]">
                Verified
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close agent card"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Pack label + Agent name ─────────────────────────────── */}
        <div className="px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            {profile.pack}
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-white truncate leading-tight">
            {profile.builder}
          </h3>
        </div>

        {/* ── Thread Power + Weight score boxes ───────────────────── */}
        <div className="grid grid-cols-2 gap-3 px-4 pb-3">
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread Power</div>
            <div className="mt-1 text-xl font-semibold text-white">{profile.threadPower.toFixed(1)}</div>
            <div className="mt-0.5 text-[10px] text-emerald-300">{profile.delta}</div>
          </div>
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Weight</div>
            <div className="mt-1 text-xl font-semibold text-white">{profile.weight.toFixed(1)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{profile.division.toLowerCase()} division</div>
          </div>
        </div>

        {/* ── Skill Inventory ─────────────────────────────────────── */}
        {profile.skills.length > 0 && (
          <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Skill Inventory</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.skills.map(skill => (
                <SkillIcon key={`${skill.id}-${skill.label}`} skill={skill} />
              ))}
            </div>
          </section>
        )}

        {/* ── Rubric stat bars ────────────────────────────────────── */}
        {profile.rubric.length > 0 && (
          <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
            <div className="space-y-1.5">
              {profile.rubric.map((metric: ThreadRubricMetric) => (
                <div key={metric.label} className="grid grid-cols-[5rem_minmax(0,1fr)_1.5rem] items-center gap-2">
                  <div className="font-mono text-[10px] text-slate-300 truncate">{metric.label}</div>
                  <StatBar value={metric.value} />
                  <div className="font-mono text-[10px] text-slate-400 text-right">{metric.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Builder / Pack provenance ───────────────────────────── */}
        <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
          <div className="mt-2 space-y-1 font-mono text-xs text-slate-300">
            <div><strong className="text-white">Builder:</strong> {profile.builder}</div>
            <div><strong className="text-white">Pack:</strong> {profile.pack}</div>
            <div><strong className="text-white">Title Track:</strong> {profile.classification}</div>
            <div><strong className="text-white">Surface:</strong> {threadSurfaceId}</div>
            <div><strong className="text-white">Source:</strong> {profile.verified ? 'Verified VM run' : 'ThreadOS local run'}</div>
          </div>
        </section>
      </article>
    </div>
  )
}
