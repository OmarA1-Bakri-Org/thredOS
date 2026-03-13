'use client'

import { useState } from 'react'
import { Info, Layers3, ShieldCheck, GitBranch, Activity, Sparkles, BarChart3, Scan } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import type { LucideIcon } from 'lucide-react'
import { ThreadNavigatorContent } from './ThreadNavigatorContent'
import { SkillsContent } from './SkillsContent'
import { StepDetailContent } from '@/components/inspector/StepDetailContent'
import { DependenciesContent } from '@/components/inspector/DependenciesContent'
import { ThreadContextContent } from '@/components/inspector/ThreadContextContent'
import { StructureContent } from '@/components/inspector/StructureContent'
import { ThreadInspectorContent } from './ThreadInspectorContent'

interface AccordionSection {
  key: string
  label: string
  shortLabel: string
  icon: LucideIcon
  description: string
  content: React.ReactNode
}

const sections: AccordionSection[] = [
  {
    key: 'navigator',
    label: 'NAVIGATOR',
    shortLabel: 'NAV',
    icon: Layers3,
    description: 'Browse and select thread surfaces. Shows all sequences with depth and thread index.',
    content: <ThreadNavigatorContent />,
  },
  {
    key: 'step-detail',
    label: 'STEP / GATE DETAIL',
    shortLabel: 'DETAIL',
    icon: ShieldCheck,
    description: 'Inspect and edit the selected step or gate — name, type, model, status, dependencies, and actions.',
    content: <StepDetailContent />,
  },
  {
    key: 'dependencies',
    label: 'DEPENDENCIES',
    shortLabel: 'DEPS',
    icon: GitBranch,
    description: 'View upstream dependencies for the selected node. Add or remove dependency links.',
    content: <DependenciesContent />,
  },
  {
    key: 'thread-context',
    label: 'THREAD CONTEXT',
    shortLabel: 'CTX',
    icon: Activity,
    description: 'Run summary, provenance, notes, and discussion for the focused thread surface.',
    content: <ThreadContextContent />,
  },
  {
    key: 'skills',
    label: 'SKILLS',
    shortLabel: 'SKILLS',
    icon: Sparkles,
    description: 'Skill inventory available to this thread — shows registered capabilities and their status.',
    content: <SkillsContent />,
  },
  {
    key: 'thread-inspector',
    label: 'THREAD INSPECTOR',
    shortLabel: 'THREAD',
    icon: Scan,
    description: 'Unified thread/run inspector — identity, run context, skills, and provenance for the focused thread surface.',
    content: <ThreadInspectorContent />,
  },
  {
    key: 'structure',
    label: 'STRUCTURE',
    shortLabel: 'STRUCT',
    icon: BarChart3,
    description: 'Workflow blueprint and step context — phase breakdown, prerequisites, gates, and signals.',
    content: <StructureContent />,
  },
]

function InfoButton({ description }: { description: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="rounded-full p-0.5 text-slate-600 transition-colors hover:bg-slate-800 hover:text-slate-300"
        aria-label="Panel info"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => { e.stopPropagation(); setShow(v => !v) }}
      >
        <Info className="h-3 w-3" />
      </button>
      {show && (
        <div className="absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 border border-slate-700 bg-[#0a1220] px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-lg">
          {description}
        </div>
      )}
    </span>
  )
}

export function AccordionPanel() {
  const activeAccordionSections = useUIStore((s) => s.activeAccordionSections)
  const setActiveAccordionSections = useUIStore((s) => s.setActiveAccordionSections)

  const toggleSection = (key: string) => {
    if (activeAccordionSections.includes(key)) {
      setActiveAccordionSections(activeAccordionSections.filter(s => s !== key))
    } else {
      setActiveAccordionSections([...activeAccordionSections, key])
    }
  }

  const openCount = activeAccordionSections.length
  // Scale columns: 1 col up to 2 sections, 2 cols for 3-4, 3 cols for 5+
  const colCount = openCount <= 2 ? 1 : openCount <= 4 ? 2 : 3
  const panelWidth = colCount === 1
    ? 'w-[380px]'
    : colCount === 2
      ? 'w-[50vw] max-w-[760px]'
      : 'w-[65vw] max-w-[1100px]'

  return (
    <div className={`${panelWidth} shrink-0 border-r border-slate-800/80 bg-[#08101d] flex flex-col overflow-hidden transition-all duration-200`}>
      {/* Horizontal tab bar */}
      <div className="shrink-0 border-b border-slate-800/60 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {sections.map(({ key, shortLabel, icon: Icon, description }) => {
            const isActive = activeAccordionSections.includes(key)
            return (
              <div key={key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleSection(key)}
                  className={`group flex items-center gap-1.5 rounded-l-lg px-2 py-1.5 transition-all ${
                    isActive
                      ? 'bg-sky-500/12 border border-r-0 border-sky-500/40 text-sky-300'
                      : 'border border-r-0 border-transparent text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  }`}
                  aria-pressed={isActive}
                >
                  <Icon className={`h-3 w-3 ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em]">
                    {shortLabel}
                  </span>
                </button>
                <div className={`flex items-center rounded-r-lg py-1.5 pr-1 ${
                  isActive
                    ? 'bg-sky-500/12 border border-l-0 border-sky-500/40'
                    : 'border border-l-0 border-transparent'
                }`}>
                  <InfoButton description={description} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Content area — masonry column flow when multiple sections are open */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {openCount === 0 && (
          <div className="flex h-full items-center justify-center px-6 py-12 text-center">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">No panels open</div>
              <div className="mt-2 text-xs text-slate-500">Select a tab above to inspect your thread.</div>
            </div>
          </div>
        )}
        <div
          className={
            colCount === 3 ? 'columns-3 gap-3 p-3'
              : colCount === 2 ? 'columns-2 gap-3 p-3'
                : ''
          }
        >
          {sections
            .filter(({ key }) => activeAccordionSections.includes(key))
            .map(({ key, label, icon: Icon, description, content }) => (
              <div
                key={key}
                className={`break-inside-avoid ${
                  colCount > 1
                    ? 'mb-3 rounded border border-slate-700/50 bg-[#060e1a] shadow-md shadow-black/20'
                    : 'border-b border-slate-800/60'
                }`}
              >
                <div className={`flex items-center gap-2 px-4 py-2 ${
                  colCount > 1
                    ? 'rounded-t-lg border-b border-slate-700/40 bg-[#0a1428]'
                    : 'border-b border-slate-800/40 bg-[#060e1a]'
                }`}>
                  <Icon className="h-3 w-3 text-sky-400" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400">{label}</span>
                  <InfoButton description={description} />
                  <button
                    type="button"
                    onClick={() => toggleSection(key)}
                    className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600 transition-colors hover:text-slate-300"
                  >
                    close
                  </button>
                </div>
                <div className={`overflow-y-auto px-4 py-3 ${colCount > 1 ? 'max-h-[35vh]' : 'max-h-[40vh]'}`}>
                  {content}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
