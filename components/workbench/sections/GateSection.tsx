'use client'

import { useState, useCallback } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle2, Plus, X } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useUpdateGate } from '@/lib/ui/api'
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

function GateCriteriaEditor({
  gateId,
  description,
  acceptanceConditions,
  requiredReview,
}: {
  gateId: string
  description?: string
  acceptanceConditions?: string[]
  requiredReview?: boolean
}) {
  const updateGate = useUpdateGate()
  const [localDescription, setLocalDescription] = useState(description ?? '')
  const [newCondition, setNewCondition] = useState('')

  const handleDescriptionBlur = useCallback(() => {
    if (localDescription !== (description ?? '')) {
      updateGate.mutate({ gateId, description: localDescription })
    }
  }, [gateId, localDescription, description, updateGate])

  const handleAddCondition = useCallback(() => {
    const trimmed = newCondition.trim()
    if (!trimmed) return
    const updated = [...(acceptanceConditions ?? []), trimmed]
    updateGate.mutate({ gateId, acceptance_conditions: updated })
    setNewCondition('')
  }, [gateId, newCondition, acceptanceConditions, updateGate])

  const handleRemoveCondition = useCallback((index: number) => {
    const updated = (acceptanceConditions ?? []).filter((_, i) => i !== index)
    updateGate.mutate({ gateId, acceptance_conditions: updated })
  }, [gateId, acceptanceConditions, updateGate])

  const handleToggleRequiredReview = useCallback(() => {
    updateGate.mutate({ gateId, required_review: !requiredReview })
  }, [gateId, requiredReview, updateGate])

  return (
    <div className="border border-slate-800 bg-[#0a101a] px-3 py-3 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Pass criteria</div>

      {/* Description */}
      <div>
        <label className="block font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600 mb-1">
          Description
        </label>
        <textarea
          className="w-full resize-none border border-slate-700 bg-[#060e1a] px-2 py-1.5 text-[12px] text-slate-300 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
          rows={2}
          placeholder="Gate purpose or quality checkpoint description..."
          value={localDescription}
          onChange={e => setLocalDescription(e.target.value)}
          onBlur={handleDescriptionBlur}
        />
      </div>

      {/* Acceptance conditions */}
      <div>
        <label className="block font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600 mb-1">
          Acceptance conditions
        </label>
        {(acceptanceConditions ?? []).length > 0 && (
          <ul className="space-y-1 mb-2">
            {(acceptanceConditions ?? []).map((condition, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px] text-slate-300">
                <span className="flex-1">{condition}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCondition(i)}
                  className="text-slate-600 hover:text-rose-400 transition-colors"
                  aria-label={`Remove condition: ${condition}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1">
          <input
            type="text"
            className="flex-1 border border-slate-700 bg-[#060e1a] px-2 py-1 text-[12px] text-slate-300 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
            placeholder="Add condition..."
            value={newCondition}
            onChange={e => setNewCondition(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddCondition() }}
          />
          <button
            type="button"
            onClick={handleAddCondition}
            disabled={!newCondition.trim()}
            className="border border-slate-700 bg-[#060e1a] px-1.5 text-slate-500 hover:text-emerald-400 hover:border-emerald-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Add condition"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Required review toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={requiredReview ?? false}
          onChange={handleToggleRequiredReview}
          className="h-3.5 w-3.5 rounded border-slate-600 bg-[#060e1a] text-emerald-500 focus:ring-emerald-500/30"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
          Require review before approval
        </span>
      </label>
    </div>
  )
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

          {/* Gate criteria editing */}
          <GateCriteriaEditor gateId={gate.id} description={gate.description} acceptanceConditions={gate.acceptance_conditions} requiredReview={gate.required_review} />

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
          <StepActions
            nodeId={gate.id}
            isGate
            acceptanceConditions={gate.acceptance_conditions}
            requiredReview={gate.required_review}
          />
        </div>
      ))}
    </div>
  )
}
