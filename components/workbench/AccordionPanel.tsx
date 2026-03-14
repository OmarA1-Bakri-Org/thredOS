'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Info,
  Layers3,
  Workflow,
  Box,
  Bot,
  ShieldCheck,
  Play,
} from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { derivePhases, findPhaseForStep, findPhaseForGate } from '@/lib/ui/phases'
import type { LucideIcon } from 'lucide-react'
import { SequenceSection } from './sections/SequenceSection'
import { PhaseSection } from './sections/PhaseSection'
import { NodeSection } from './sections/NodeSection'
import { AgentSection } from './sections/AgentSection'
import { GateSection } from './sections/GateSection'
import { RunSection } from './sections/RunSection'

/**
 * Left rail section definition.
 * Follows the thread construction cadence:
 *   SEQUENCE → PHASE → NODE → AGENT → GATE → RUN
 */
interface AccordionSection {
  key: string
  label: string
  shortLabel: string
  icon: LucideIcon
  description: string
  /** Accent color classes for active state — each section has a subtle identity */
  accent: {
    border: string
    bg: string
    text: string
    iconActive: string
  }
}

const sections: AccordionSection[] = [
  {
    key: 'sequence',
    label: 'SEQUENCE',
    shortLabel: 'SEQ',
    icon: Layers3,
    description: 'Thread surface, type (base/p/c/f/b/l), templates, and phase overview.',
    accent: {
      border: 'border-sky-500/40',
      bg: 'bg-sky-500/8',
      text: 'text-sky-300',
      iconActive: 'text-sky-400',
    },
  },
  {
    key: 'phase',
    label: 'PHASE',
    shortLabel: 'PHS',
    icon: Workflow,
    description: 'Phase navigator — select, add, reorder. Each phase = node + agent + gate.',
    accent: {
      border: 'border-violet-500/40',
      bg: 'bg-violet-500/8',
      text: 'text-violet-300',
      iconActive: 'text-violet-400',
    },
  },
  {
    key: 'node',
    label: 'NODE',
    shortLabel: 'NODE',
    icon: Box,
    description: 'Node configuration scoped to selected phase. Add, edit, configure work units.',
    accent: {
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/8',
      text: 'text-amber-300',
      iconActive: 'text-amber-400',
    },
  },
  {
    key: 'agent',
    label: 'AGENT',
    shortLabel: 'AGT',
    icon: Bot,
    description: 'Build, register, assign agents. Workshop, roster, performance, and tool inventory.',
    accent: {
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-500/8',
      text: 'text-emerald-300',
      iconActive: 'text-emerald-400',
    },
  },
  {
    key: 'gate',
    label: 'GATE',
    shortLabel: 'GATE',
    icon: ShieldCheck,
    description: 'Quality checkpoint for selected phase. Pass/fail criteria, time/quality ratio.',
    accent: {
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/8',
      text: 'text-rose-300',
      iconActive: 'text-rose-400',
    },
  },
  {
    key: 'run',
    label: 'RUN',
    shortLabel: 'RUN',
    icon: Play,
    description: 'Execute, monitor, control the sequence. Status, history, provenance, notes.',
    accent: {
      border: 'border-cyan-500/40',
      bg: 'bg-cyan-500/8',
      text: 'text-cyan-300',
      iconActive: 'text-cyan-400',
    },
  },
]

/** Section content renderer — mounts the right component per key */
function SectionContent({ sectionKey }: { sectionKey: string }) {
  switch (sectionKey) {
    case 'sequence':
      return <SequenceSection />
    case 'phase':
      return <PhaseSection />
    case 'node':
      return <NodeSection />
    case 'agent':
      return <AgentSection />
    case 'gate':
      return <GateSection />
    case 'run':
      return <RunSection />
    default:
      return null
  }
}

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
  const selectedPhaseId = useUIStore((s) => s.selectedPhaseId)
  const selectedNodeId = useUIStore((s) => s.selectedNodeId)
  const setSelectedPhaseId = useUIStore((s) => s.setSelectedPhaseId)
  const expandAccordionSection = useUIStore((s) => s.expandAccordionSection)
  const { data: status } = useStatus()

  // ── Canvas → Panel sync ──────────────────────────────────────────────
  // When a node is clicked on the canvas, derive which phase owns it
  // and auto-select that phase + expand the relevant section.
  const prevNodeIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedNodeId || !status || selectedNodeId === prevNodeIdRef.current) return
    prevNodeIdRef.current = selectedNodeId

    const derivation = derivePhases(status.steps, status.gates)
    const phase =
      findPhaseForStep(derivation.phases, selectedNodeId) ??
      findPhaseForGate(derivation.phases, selectedNodeId)

    if (phase) {
      setSelectedPhaseId(phase.id)
      const isGate = status.gates.some(g => g.id === selectedNodeId)
      expandAccordionSection(isGate ? 'gate' : 'node')
    }
  }, [selectedNodeId, status, setSelectedPhaseId, expandAccordionSection])

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

  // ── Resize handle ─────────────────────────────────────────────────
  const MIN_WIDTH = 300
  const MAX_WIDTH = 1200
  const defaultWidth = colCount === 1 ? 380 : colCount === 2 ? 640 : 920
  const [panelWidthPx, setPanelWidthPx] = useState(defaultWidth)
  const isResizingRef = useRef(false)

  // Sync default width when colCount changes (user opens/closes sections)
  const prevColCountRef = useRef(colCount)
  useEffect(() => {
    if (colCount !== prevColCountRef.current) {
      prevColCountRef.current = colCount
      setPanelWidthPx(colCount === 1 ? 380 : colCount === 2 ? 640 : 920)
    }
  }, [colCount])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    const startX = e.clientX
    const startWidth = panelWidthPx

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = moveEvent.clientX - startX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
      setPanelWidthPx(newWidth)
    }

    const onMouseUp = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [panelWidthPx])

  /** Phase-scoped sections show a scope indicator */
  const phaseScopedSections = useMemo(() => new Set(['node', 'agent', 'gate']), [])

  return (
    <div
      className="relative shrink-0 border-r border-slate-800/80 bg-[#08101d] flex flex-col overflow-hidden"
      style={{ width: panelWidthPx }}
    >
      {/* Section navigation tabs */}
      <div className="shrink-0 border-b border-slate-800/60 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {sections.map(({ key, shortLabel, icon: Icon, description, accent }) => {
            const isActive = activeAccordionSections.includes(key)
            const isPhaseScoped = phaseScopedSections.has(key)
            const hasPhaseContext = isPhaseScoped && !!selectedPhaseId

            return (
              <div key={key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleSection(key)}
                  className={`group flex items-center gap-1.5 rounded-l-lg px-2 py-1.5 transition-all ${
                    isActive
                      ? `${accent.bg} border ${accent.border} border-r-0 ${accent.text}`
                      : 'border border-r-0 border-transparent text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  }`}
                  aria-pressed={isActive}
                >
                  <Icon className={`h-3 w-3 ${isActive ? accent.iconActive : 'text-slate-500 group-hover:text-slate-400'}`} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em]">
                    {shortLabel}
                  </span>
                  {/* Phase scope dot for NODE/AGENT/GATE when phase is selected */}
                  {hasPhaseContext && (
                    <span className="h-1 w-1 rounded-full bg-emerald-400" />
                  )}
                </button>
                <div className={`flex items-center rounded-r-lg py-1.5 pr-1 ${
                  isActive
                    ? `${accent.bg} border ${accent.border} border-l-0`
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
              <div className="mt-2 text-xs text-slate-500">Select a section above to begin building your thread.</div>
              <div className="mt-4 flex flex-col gap-1 text-[10px] text-slate-600">
                <span>SEQUENCE → PHASE → NODE → AGENT → GATE → RUN</span>
              </div>
            </div>
          </div>
        )}
        <div
          className={
            colCount === 3 ? 'grid grid-cols-3 gap-3 p-3'
              : colCount === 2 ? 'grid grid-cols-2 gap-3 p-3'
                : ''
          }
        >
          {sections
            .filter(({ key }) => activeAccordionSections.includes(key))
            .map(({ key, label, icon: Icon, description, accent }) => (
              <div
                key={key}
                className={`${
                  colCount > 1
                    ? `rounded border ${accent.border} bg-[#060e1a] shadow-md shadow-black/20`
                    : `border-b ${accent.border}`
                }`}
              >
                <div className={`flex items-center gap-2 px-4 py-2 ${
                  colCount > 1
                    ? `rounded-t-lg border-b ${accent.border} bg-[#0a1428]`
                    : `border-b ${accent.border} bg-[#060e1a]`
                }`}>
                  <Icon className={`h-3 w-3 ${accent.iconActive}`} />
                  <span className={`font-mono text-[9px] uppercase tracking-[0.18em] ${accent.text}`}>{label}</span>
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
                  <SectionContent sectionKey={key} />
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Resize handle — drag to widen/narrow the panel */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 z-30 h-full w-1.5 cursor-col-resize group"
      >
        <div className="h-full w-full transition-colors group-hover:bg-sky-500/25 group-active:bg-sky-500/40" />
      </div>
    </div>
  )
}
