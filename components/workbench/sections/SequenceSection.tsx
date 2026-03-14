'use client'

import { useState, useRef } from 'react'
import { Layers3, FileStack, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThreadSurfaces, useStatus } from '@/lib/ui/api'
import { useUIStore, selectCurrentDepthSurfaceId } from '@/lib/ui/store'
import { derivePhases } from '@/lib/ui/phases'

const THREAD_TYPES = [
  { value: 'base', label: 'Base', description: 'Single agent, single task' },
  { value: 'p', label: 'Parallel', description: 'Multiple agents simultaneously' },
  { value: 'c', label: 'Chained', description: 'Sequential pipeline with gates' },
  { value: 'f', label: 'Fusion', description: 'Candidates → synthesis' },
  { value: 'b', label: 'Baton', description: 'Agent hand-off chain' },
  { value: 'l', label: 'Long', description: 'Extended autonomous operation' },
] as const

export function SequenceSection() {
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: status } = useStatus()
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const setSelectedThreadSurfaceId = useUIStore(s => s.setSelectedThreadSurfaceId)
  const currentDepthSurfaceId = useUIStore(selectCurrentDepthSurfaceId)

  const autoDerivation = status
    ? derivePhases(status.steps, status.gates)
    : null

  const [selectedType, setSelectedType] = useState<string | null>(null)

  // Sync auto-detected type as default when it first resolves (ref avoids setState in effect)
  const hasSyncedAutoTypeRef = useRef(false)
  if (!hasSyncedAutoTypeRef.current && autoDerivation?.threadType && selectedType === null) {
    hasSyncedAutoTypeRef.current = true
    setSelectedType(autoDerivation.threadType)
  }

  // Re-derive phases with the user-selected thread type override
  const phaseDerivation = status
    ? derivePhases(status.steps, status.gates, selectedType ?? undefined)
    : null

  return (
    <div className="space-y-4" data-testid="sequence-section">
      {/* Thread Type Identification */}
      {phaseDerivation && (
        <div className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Thread type</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {THREAD_TYPES.map(t => {
              const isActive = (selectedType ?? phaseDerivation.threadType) === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSelectedType(t.value)}
                  className={`cursor-pointer px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-all ${
                    isActive
                      ? 'border border-sky-500/50 bg-sky-500/12 text-sky-200 shadow-[0_0_8px_rgba(56,189,248,0.15)]'
                      : 'border border-slate-800 text-slate-600 hover:border-slate-600 hover:text-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {THREAD_TYPES.find(t => t.value === (selectedType ?? phaseDerivation.threadType))?.description}
          </div>
        </div>
      )}

      {/* Phase Overview */}
      {phaseDerivation && phaseDerivation.phases.length > 0 && (
        <div className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Phase overview</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight text-white">{phaseDerivation.phases.length}</span>
            <span className="text-sm text-slate-400">
              {phaseDerivation.phases.length === 1 ? 'phase' : 'phases'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {phaseDerivation.phases.map((phase, i) => (
              <span key={phase.id} className="flex items-center gap-0.5">
                <span className="border border-slate-700/50 bg-slate-950/40 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                  {phase.role === 'primary' ? `P${i + 1}` : phase.role.charAt(0).toUpperCase()}
                </span>
                {i < phaseDerivation.phases.length - 1 && (
                  <ChevronRight className="h-2.5 w-2.5 text-slate-700" />
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sequence Identity */}
      {status && (
        <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Sequence</div>
          <div className="mt-2 text-sm font-medium text-white">{status.name}</div>
          <div className="mt-1 flex gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span className="text-emerald-300">{status.summary.ready} ready</span>
            <span className="text-sky-300">{status.summary.running} active</span>
            <span className="text-slate-400">{status.summary.done} done</span>
            {status.summary.failed > 0 && (
              <span className="text-rose-300">{status.summary.failed} failed</span>
            )}
          </div>
        </div>
      )}

      {/* Thread Surface Browser */}
      <div>
        <div className="flex items-center gap-2 pb-2">
          <Layers3 className="h-3 w-3 text-slate-500" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {currentDepthSurfaceId ? 'Scoped surfaces' : 'Thread surfaces'}
          </div>
        </div>
        <div className="space-y-1.5">
          {threadSurfaces && threadSurfaces.length > 0 ? threadSurfaces
            .filter(surface => {
              // When at root depth, show all surfaces
              if (!currentDepthSurfaceId) return true
              // When at a specific depth, show the focused surface and its direct children
              return surface.id === currentDepthSurfaceId || surface.parentSurfaceId === currentDepthSurfaceId
            })
            .map(surface => {
            const selected = selectedThreadSurfaceId === surface.id
            return (
              <Button
                key={surface.id}
                type="button"
                variant={selected ? 'secondary' : 'outline'}
                size="default"
                onClick={() => setSelectedThreadSurfaceId(surface.id)}
                className={`flex h-auto w-full items-start justify-between px-3 py-2.5 text-left normal-case tracking-normal ${
                  selected
                    ? 'border-sky-500/50 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.15)]'
                    : 'text-slate-300'
                }`}
              >
                <span>
                  <span className="block text-sm font-medium">{surface.surfaceLabel}</span>
                  <span className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    depth {surface.depth} · {surface.role ?? 'thread'}
                  </span>
                </span>
                {surface.childSurfaceIds.length > 0 && (
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {surface.childSurfaceIds.length}
                  </span>
                )}
              </Button>
            )
          }) : (
            <div className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">
              No registered thread surfaces yet.
            </div>
          )}
        </div>
      </div>

      {/* Template Picker */}
      <div className="border-t border-slate-800/60 pt-3">
        <div className="flex items-center gap-2 pb-2">
          <FileStack className="h-3 w-3 text-slate-500" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Templates</div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {THREAD_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              className="group border border-slate-800 bg-[#0a101a] px-2.5 py-2 text-left transition-all hover:border-sky-500/30 hover:bg-sky-500/5"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-300 group-hover:text-sky-200">
                {t.label}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-600 group-hover:text-slate-400">
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
