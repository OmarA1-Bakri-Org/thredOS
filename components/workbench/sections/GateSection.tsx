'use client'

import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle2 } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import { StepActions } from '@/components/inspector/StepActions'

function GateStatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approved
        </span>
      )
    case 'blocked':
      return (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-rose-300">
          <ShieldX className="h-3.5 w-3.5" />
          Blocked
        </span>
      )
    default:
      return (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
          <ShieldAlert className="h-3.5 w-3.5" />
          {status}
        </span>
      )
  }
}

export function GateSection() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const { data: status } = useStatus()

  const phaseDerivation = status
    ? derivePhases(status.steps, status.gates)
    : null

  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)

  // Get the gates belonging to the selected phase
  const phaseGates = selectedPhase
    ? status?.gates.filter(g => selectedPhase.gateIds.includes(g.id)) ?? []
    : []

  if (!selectedPhaseId) {
    return (
      <div className="space-y-3" data-testid="gate-section">
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <ShieldCheck className="mx-auto h-5 w-5 text-slate-600" />
          <div className="mt-2 text-sm text-slate-500">Select a phase first.</div>
          <div className="mt-1 text-[11px] text-slate-600">
            Choose a phase in the PHASE section to see its gates.
          </div>
        </div>
      </div>
    )
  }

  if (phaseGates.length === 0) {
    return (
      <div className="space-y-3" data-testid="gate-section">
        {/* Phase scope indicator */}
        <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
            {selectedPhase?.label}
          </span>
        </div>
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <div className="text-sm text-slate-500">No gates in this phase.</div>
          <div className="mt-1 text-[11px] text-slate-600">
            Insert a gate to add a quality checkpoint.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="gate-section">
      {/* Phase scope indicator */}
      <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
          {selectedPhase?.label}
        </span>
      </div>

      {/* Gate list */}
      {phaseGates.map(gate => (
        <div key={gate.id} className="space-y-3">
          {/* Gate header */}
          <div className="border border-slate-800/90 bg-[#060e1a] px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <span className="text-sm font-semibold text-white">{gate.id}</span>
              </div>
              <GateStatusIndicator status={gate.status} />
            </div>
            {gate.name && gate.name !== gate.id && (
              <div className="mt-1.5 text-sm text-slate-300">{gate.name}</div>
            )}
          </div>

          {/* Gate criteria placeholder */}
          <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Pass criteria</div>
            <div className="mt-2 text-[11px] text-slate-400">
              Gate criteria configuration coming soon. Currently using approve/block manual flow.
            </div>
          </div>

          {/* Gate quality metrics placeholder */}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Time/quality</div>
              <div className="mt-1 text-sm font-semibold text-white">—</div>
            </div>
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Pass rate</div>
              <div className="mt-1 text-sm font-semibold text-white">—</div>
            </div>
          </div>

          {/* Gate actions (approve/block) */}
          <StepActions nodeId={gate.id} isGate />
        </div>
      ))}
    </div>
  )
}
