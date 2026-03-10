'use client'

import { Box, Bot, Folder, Globe, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import type { HierarchyViewNode } from './HierarchyView'

export interface ThreadSkillBadge {
  id: string
  label: string
  inherited: boolean
}

export interface ThreadRubricMetric {
  label: string
  value: number
}

export interface ThreadCardProfile {
  builder: string
  pack: string
  division: string
  classification: string
  placement: string
  verified: boolean
  threadPower: number
  weight: number
  delta: string
  rubric: ThreadRubricMetric[]
  skills: ThreadSkillBadge[]
}

interface FocusedThreadCardProps {
  node: HierarchyViewNode
  profile: ThreadCardProfile
  onOpenLane: (threadSurfaceId: string, runId: string | null) => void
}

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
      className={`grid h-8 w-8 place-items-center border ${skill.inherited ? 'border-slate-800 bg-slate-950/70 text-slate-500' : 'border-slate-700 bg-slate-900 text-slate-200'}`}
      title={skill.label}
    >
      <Icon className="h-4 w-4" />
    </div>
  )
}

function StatBar({ value }: { value: number }) {
  return (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          className={index < value
            ? 'h-3 border border-emerald-300/20 bg-gradient-to-r from-sky-300 to-emerald-300 shadow-[0_0_14px_rgba(83,245,138,0.14)]'
            : 'h-3 border border-slate-900 bg-slate-900/80'}
        />
      ))}
    </div>
  )
}

export function FocusedThreadCard({ node, profile, onOpenLane }: FocusedThreadCardProps) {
  return (
    <article data-testid="focused-thread-card" className="mx-auto flex w-full max-w-5xl flex-col border border-slate-700/80 bg-[#0a101a] shadow-[0_28px_80px_rgba(0,0,0,0.54)]">
      <div data-testid="thread-badges" className="flex flex-wrap gap-3 border-b border-slate-800/80 px-6 py-5">
        <span className="rounded-full border border-sky-500/40 bg-sky-500/8 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-100">{profile.division}</span>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/8 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-100">{profile.classification}</span>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-emerald-100">{profile.placement}</span>
        {profile.verified ? (
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-emerald-100 shadow-[0_0_18px_rgba(83,245,138,0.14)]">Verified VM</span>
        ) : null}
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">{profile.pack}</div>
              <h2 className="mt-2 font-['Inter'] text-5xl leading-[0.95] font-light tracking-[-0.06em] text-white">{node.surfaceLabel}</h2>
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                <div>Builder: {profile.builder}</div>
                <div>{node.surfaceDescription ?? 'Registered thread surface inside ThreadOS.'}</div>
                <div>{node.role ? `Role: ${node.role}` : 'Highest status shown only. Pack stays inside ThreadOS.'}</div>
              </div>
            </div>

            <div className="flex gap-4">
              <div data-testid="score-thread-power" className="min-w-[9rem] border border-slate-700 bg-slate-900/80 px-4 py-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Thread Power</div>
                <div className="mt-2 text-4xl font-semibold text-white">{profile.threadPower.toFixed(1)}</div>
                <div className="mt-1 text-sm text-emerald-300">{profile.delta}</div>
              </div>
              <div data-testid="score-weight" className="min-w-[9rem] border border-slate-700 bg-slate-900/80 px-4 py-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Weight</div>
                <div className="mt-2 text-4xl font-semibold text-white">{profile.weight.toFixed(1)}</div>
                <div className="mt-1 text-sm text-slate-400">{profile.division.toLowerCase()} division</div>
              </div>
            </div>
          </div>

          <section className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Skill Inventory</div>
            <div data-testid="skill-inventory" className="mt-3 flex flex-wrap gap-2">
              {profile.skills.map(skill => (
                <SkillIcon key={`${skill.id}-${skill.label}`} skill={skill} />
              ))}
            </div>
          </section>

          <section data-testid="rubric-block" className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="space-y-3">
              {profile.rubric.map(metric => (
                <div key={metric.label} className="grid grid-cols-[8rem_minmax(0,1fr)_2rem] items-center gap-3">
                  <div className="font-mono text-sm text-slate-300">{metric.label}</div>
                  <StatBar value={metric.value} />
                  <div className="font-mono text-sm text-slate-400">{metric.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-wrap gap-4 border border-slate-700 bg-slate-950/55 px-4 py-4 font-mono text-sm text-slate-300">
            <span><strong className="text-white">Children:</strong> {node.childCount}</span>
            <span><strong className="text-white">Run:</strong> {node.clickTarget.runId ?? 'none'}</span>
            <span><strong className="text-white">Status:</strong> {node.runStatus ?? 'unscored'}</span>
            <span><strong className="text-white">Summary:</strong> {node.runSummary ?? 'No summary yet'}</span>
          </section>
        </div>

        <div className="space-y-4">
          <section className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Status Ladder</div>
            <div className="mt-3 text-sm text-slate-200">{profile.pack}</div>
            <p className="mt-2 text-sm text-slate-400">Only the highest status is surfaced at primary card level.</p>
          </section>
          <section className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Pack / Builder</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div><strong className="text-white">Asset:</strong> {profile.pack}</div>
              <div><strong className="text-white">Builder:</strong> {profile.builder}</div>
              <div><strong className="text-white">Title Track:</strong> {profile.classification}</div>
            </div>
          </section>
          <section className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div><strong className="text-white">Registered Agent:</strong> {node.id}</div>
              <div><strong className="text-white">Created By:</strong> {node.clickTarget.runId ?? 'draft'} / ThreadOS</div>
              <div><strong className="text-white">Source:</strong> {profile.verified ? 'Verified VM run' : 'ThreadOS local run'}</div>
            </div>
          </section>
          <section className="border border-slate-700 bg-slate-950/55 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Why This Card Works</div>
            <p className="mt-3 text-sm leading-6 text-slate-400">The layout combines a premium central object, icon-first inventory, fixed comparative bars, and explicit provenance. It is designed to feel serious enough for engineering use while remaining comparable and shareable.</p>
          </section>
          <button
            type="button"
            data-thread-surface-id={node.clickTarget.threadSurfaceId}
            aria-current="page"
            onClick={() => onOpenLane(node.clickTarget.threadSurfaceId, node.clickTarget.runId)}
            className="w-full border border-sky-500/40 bg-sky-500/10 px-4 py-3 font-mono text-xs uppercase tracking-[0.22em] text-sky-100 transition hover:border-sky-400 hover:bg-sky-500/15"
          >
            Open lane view
          </button>
        </div>
      </div>
    </article>
  )
}
