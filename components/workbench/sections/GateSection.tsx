'use client'

import { useState, useCallback } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle2, Plus, X } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useUpdateGate, useGateMetrics, useGateDecisions } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import { StepActions } from '@/components/inspector/StepActions'

function GateStatusIndicator({ status }: { status: string }) {
  const normalizedStatus = typeof status === 'string' ? status.toUpperCase() : 'UNKNOWN'
  switch (normalizedStatus) {
    case 'APPROVED':
      return (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approved
        </span>
      )
    case 'BLOCKED':
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
          {normalizedStatus.replace(/_/g, ' ')}
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
    <div className="border border-cyan-300/18 bg-cyan-950/10 px-3 py-3 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100/60">Pass criteria</div>
      <div>
        <label className="block font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/46 mb-1">Description</label>
        <textarea
          className="w-full resize-none border border-cyan-300/18 bg-[#060e1a] px-2 py-1.5 text-[12px] text-cyan-50/86 placeholder:text-cyan-100/28 focus:border-cyan-200/55 focus:outline-none"
          rows={2}
          placeholder="Gate purpose or quality checkpoint description..."
          value={localDescription}
          onChange={e => setLocalDescription(e.target.value)}
          onBlur={handleDescriptionBlur}
        />
      </div>
      <div>
        <label className="block font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/46 mb-1">Acceptance conditions</label>
        {(acceptanceConditions ?? []).length > 0 && (
          <ul className="space-y-1 mb-2">
            {(acceptanceConditions ?? []).map((condition, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px] text-cyan-50/84">
                <span className="flex-1">{condition}</span>
                <button type="button" onClick={() => handleRemoveCondition(i)} className="text-cyan-100/36 hover:text-rose-400 transition-colors" aria-label={`Remove condition: ${condition}`}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1">
          <input
            type="text"
            className="flex-1 border border-cyan-300/18 bg-[#060e1a] px-2 py-1 text-[12px] text-cyan-50/86 placeholder:text-cyan-100/28 focus:border-cyan-200/55 focus:outline-none"
            placeholder="Add condition..."
            value={newCondition}
            onChange={e => setNewCondition(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddCondition() }}
          />
          <button type="button" onClick={handleAddCondition} disabled={!newCondition.trim()} className="border border-cyan-300/18 bg-[#060e1a] px-1.5 text-cyan-100/40 hover:text-cyan-100 hover:border-cyan-200/55 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" aria-label="Add condition">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={requiredReview ?? false} onChange={handleToggleRequiredReview} className="h-3.5 w-3.5 rounded border-cyan-300/24 bg-[#060e1a] text-cyan-300 focus:ring-cyan-200/30" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-100/54">Require review before approval</span>
      </label>
    </div>
  )
}

function GateMetricsCards({ gateId }: { gateId: string }) {
  const { data: metrics } = useGateMetrics(gateId)
  const formatTime = (ms: number) => {
    if (ms === 0) return '—'
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="border border-cyan-300/18 bg-cyan-950/10 px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/46">Time/quality</div>
        <div className="mt-1 text-sm font-semibold text-cyan-50">{metrics ? formatTime(metrics.avgTimeToApprovalMs) : '—'}</div>
      </div>
      <div className="border border-cyan-300/18 bg-cyan-950/10 px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/46">Pass rate</div>
        <div className="mt-1 text-sm font-semibold text-cyan-50">{metrics && metrics.totalAttempts > 0 ? `${metrics.approvalRate}%` : '—'}</div>
      </div>
    </div>
  )
}

function GateDecisionPanel({ runId, subjectRefs }: { runId: string | null; subjectRefs: string[] }) {
  const { data: decisions = [] } = useGateDecisions(runId)
  const relevantDecisions = decisions.filter((decision) => {
    const subjectRef = (decision as { subject_ref?: string }).subject_ref
    return typeof subjectRef === 'string' && subjectRefs.includes(subjectRef)
  }) as Array<{ id: string; subject_ref: string; gate_type: string; status: string; reason_codes: string[] }>

  return (
    <div className="border border-cyan-300/18 bg-cyan-950/10 px-3 py-3 space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100/60">Deterministic decisions</div>
      {!runId ? (
        <div className="text-[12px] text-cyan-100/46">Select a run to inspect gate decisions.</div>
      ) : relevantDecisions.length === 0 ? (
        <div className="text-[12px] text-cyan-100/46">No persisted decisions yet for this phase.</div>
      ) : (
        <div className="space-y-2">
          {relevantDecisions.map((decision) => (
            <div key={decision.id} className="border border-cyan-300/14 bg-[#060e1a] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-100/50">{decision.subject_ref} · {decision.gate_type}</div>
                <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${decision.status === 'PASS' ? 'text-cyan-200' : decision.status === 'NEEDS_APPROVAL' ? 'text-amber-300' : 'text-rose-300'}`}>
                  {decision.status}
                </span>
              </div>
              {decision.reason_codes.length > 0 ? (
                <div className="mt-1 text-[11px] text-cyan-50/82">{decision.reason_codes.join(', ')}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function GateSection() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const { data: status } = useStatus()

  const phaseDerivation = status ? derivePhases(status.steps, status.gates) : null
  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)
  const phaseGates = selectedPhase ? status?.gates.filter(g => selectedPhase.gateIds.includes(g.id)) ?? [] : []

  if (!selectedPhaseId) {
    return (
      <div className="space-y-3" data-testid="gate-section">
        <div className="border border-dashed border-cyan-300/18 px-3 py-4 text-center">
          <ShieldCheck className="mx-auto h-5 w-5 text-cyan-100/34" />
          <div className="mt-2 text-sm text-cyan-100/54">Select a phase first.</div>
          <div className="mt-1 text-[11px] text-cyan-100/36">Choose a phase in the PHASE section to see its gates.</div>
        </div>
      </div>
    )
  }

  if (phaseGates.length === 0) {
    return (
      <div className="space-y-3" data-testid="gate-section">
        <div className="flex items-center gap-2 border-b border-cyan-300/18 pb-2">
          <div className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/62">{selectedPhase?.label}</span>
        </div>
        <div className="border border-dashed border-cyan-300/18 px-3 py-4 text-center">
          <div className="text-sm text-cyan-100/54">No gates in this phase.</div>
          <div className="mt-1 text-[11px] text-cyan-100/36">Insert a gate to add a quality checkpoint.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="gate-section">
      <div className="flex items-center gap-2 border-b border-cyan-300/18 pb-2">
        <div className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/62">{selectedPhase?.label}</span>
      </div>

      <GateDecisionPanel runId={selectedRunId} subjectRefs={selectedPhase?.stepIds ?? []} />

      {phaseGates.map(gate => (
        <div key={gate.id} className="space-y-3">
          <div className="border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(9,20,39,0.95),rgba(5,12,25,0.98))] px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-200" />
                <span className="text-sm font-semibold text-cyan-50">{gate.id}</span>
              </div>
              <GateStatusIndicator status={gate.status} />
            </div>
            {gate.name && gate.name !== gate.id && <div className="mt-1.5 text-sm text-cyan-50/76">{gate.name}</div>}
          </div>
          <GateCriteriaEditor gateId={gate.id} description={gate.description} acceptanceConditions={gate.acceptance_conditions} requiredReview={gate.required_review} />
          <GateMetricsCards gateId={gate.id} />
          <StepActions nodeId={gate.id} isGate acceptanceConditions={gate.acceptance_conditions} requiredReview={gate.required_review} />
        </div>
      ))}
    </div>
  )
}
