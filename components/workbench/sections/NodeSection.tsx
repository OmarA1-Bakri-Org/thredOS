'use client'

import { Box } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import { StepForm } from '@/components/inspector/StepForm'
import { StepActions } from '@/components/inspector/StepActions'

export function NodeSection() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const { data: status } = useStatus()

  const phaseDerivation = status
    ? derivePhases(status.steps, status.gates)
    : null

  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)

  // Get the steps belonging to the selected phase
  const phaseSteps = selectedPhase
    ? status?.steps.filter(s => selectedPhase.stepIds.includes(s.id)) ?? []
    : []

  // If a specific node is selected and belongs to this phase, show its detail
  const focusedStep = selectedNodeId
    ? phaseSteps.find(s => s.id === selectedNodeId)
    : phaseSteps[0] ?? null

  if (!selectedPhaseId) {
    return (
      <div className="space-y-3" data-testid="node-section">
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <Box className="mx-auto h-5 w-5 text-slate-600" />
          <div className="mt-2 text-sm text-slate-500">Select a phase first.</div>
          <div className="mt-1 text-[11px] text-slate-600">
            Choose a phase in the PHASE section to configure its nodes.
          </div>
        </div>
      </div>
    )
  }

  if (phaseSteps.length === 0) {
    return (
      <div className="space-y-3" data-testid="node-section">
        {/* Phase scope indicator */}
        <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
            {selectedPhase?.label}
          </span>
        </div>
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">
          No nodes in this phase.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="node-section">
      {/* Phase scope indicator */}
      <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
          {selectedPhase?.label}
        </span>
      </div>

      {/* Node selector when phase has multiple steps */}
      {phaseSteps.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {phaseSteps.map(step => (
            <button
              key={step.id}
              type="button"
              onClick={() => setSelectedNodeId(step.id)}
              className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-all ${
                focusedStep?.id === step.id
                  ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              {step.id}
            </button>
          ))}
        </div>
      )}

      {/* Focused node detail */}
      {focusedStep && (
        <div className="space-y-3">
          {/* Node header */}
          <div>
            <div className="text-base font-semibold tracking-tight text-white">{focusedStep.id}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.18em]">
              <span className="border border-sky-500/45 bg-sky-500/10 px-2.5 py-0.5 text-sky-100">{focusedStep.type}</span>
              <span className="border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-200">{focusedStep.model}</span>
              <span className="border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-100">{focusedStep.status}</span>
            </div>
          </div>

          {/* Step form (name, type, model editing) */}
          <StepForm step={focusedStep} />

          {/* Step actions (run, stop, restart, clone, delete) */}
          <StepActions nodeId={focusedStep.id} isGate={false} />
        </div>
      )}
    </div>
  )
}
