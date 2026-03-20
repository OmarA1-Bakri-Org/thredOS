'use client'

import { Workflow, Plus, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { derivePhases, type Phase } from '@/lib/ui/phases'

function PhaseRoleBadge({ role }: { role: Phase['role'] }) {
  const styles: Record<Phase['role'], string> = {
    primary: 'border-slate-700 text-slate-400',
    candidate: 'border-amber-500/30 text-amber-300',
    synthesis: 'border-violet-500/30 text-violet-300',
    handoff: 'border-sky-500/30 text-sky-300',
    watchdog: 'border-rose-500/30 text-rose-300',
  }
  return (
    <span className={`border bg-transparent px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.16em] ${styles[role]}`}>
      {role}
    </span>
  )
}

export function PhaseSection() {
  const { data: status } = useStatus()
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const setSelectedPhaseId = useUIStore(s => s.setSelectedPhaseId)
  const expandAccordionSection = useUIStore(s => s.expandAccordionSection)

  const phaseDerivation = status
    ? derivePhases(status.steps, status.gates)
    : null

  const handleSelectPhase = (phaseId: string) => {
    setSelectedPhaseId(phaseId)
    // Auto-expand node section when selecting a phase
    expandAccordionSection('node')
  }

  if (!phaseDerivation || phaseDerivation.phases.length === 0) {
    return (
      <div className="space-y-3" data-testid="phase-section">
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <Workflow className="mx-auto h-5 w-5 text-slate-400" />
          <div className="mt-2 text-sm text-slate-400">No phases detected.</div>
          <div className="mt-1 text-[11px] text-slate-400">Add steps to your sequence to create phases.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="phase-section">
      {/* Phase count header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-white">{phaseDerivation.phases.length}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
            {phaseDerivation.phases.length === 1 ? 'phase' : 'phases'}
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 font-mono text-[9px] uppercase tracking-[0.12em]">
          <Plus className="h-3 w-3" />
          Phase
        </Button>
      </div>

      {/* Phase List */}
      <div className="space-y-1">
        {phaseDerivation.phases.map((phase, i) => {
          const isSelected = selectedPhaseId === phase.id
          const stepCount = phase.stepIds.length
          const gateCount = phase.gateIds.length

          return (
            <button
              key={phase.id}
              type="button"
              onClick={() => handleSelectPhase(phase.id)}
              data-testid={`phase-option-${phase.id}`}
              className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all ${
                isSelected
                  ? 'border border-emerald-500/40 bg-emerald-500/8 shadow-[0_0_12px_rgba(52,211,153,0.08)]'
                  : 'border border-transparent hover:border-slate-700/50 hover:bg-slate-800/30'
              }`}
            >
              {/* Phase number */}
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center font-mono text-[11px] font-medium ${
                isSelected
                  ? 'border border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border border-slate-700 bg-slate-950/60 text-slate-300 group-hover:text-white'
              }`}>
                {i + 1}
              </div>

              {/* Phase info */}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>
                  {phase.label}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
                    {stepCount} {stepCount === 1 ? 'node' : 'nodes'}
                  </span>
                  {gateCount > 0 && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
                      {gateCount} {gateCount === 1 ? 'gate' : 'gates'}
                    </span>
                  )}
                  <PhaseRoleBadge role={phase.role} />
                </div>
              </div>

              {/* Arrow indicator */}
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-all ${
                isSelected ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
              }`} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
