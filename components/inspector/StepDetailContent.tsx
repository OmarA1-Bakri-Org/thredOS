'use client'

import { ShieldCheck } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { StepForm } from './StepForm'
import { StepActions } from './StepActions'
import { LoadingSpinner } from '@/components/LoadingSpinner'

export function StepDetailContent() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const { data: status, isLoading } = useStatus()

  if (!selectedNodeId) {
    return (
      <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4 text-sm text-slate-200">
        Select a step or gate to see details.
      </div>
    )
  }

  if (isLoading) return <LoadingSpinner message="Loading..." />
  if (!status) {
    return <div className="text-sm text-slate-500">Sequence status unavailable.</div>
  }

  const step = status.steps.find(s => s.id === selectedNodeId)
  const gate = status.gates.find(g => g.id === selectedNodeId)

  if (!step && !gate) {
    return <div className="text-sm text-slate-500">Node not found in sequence.</div>
  }

  if (gate) {
    return (
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            {gate.id}
          </div>
          <p className="mt-1 text-sm text-slate-200">{gate.name}</p>
          <div className="mt-2 text-sm text-slate-100">
            <span className="font-mono uppercase tracking-[0.14em] text-emerald-100">{gate.status}</span>
          </div>
        </div>
        <StepActions nodeId={gate.id} isGate />
      </div>
    )
  }

  // Step selected
  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold tracking-tight text-white">{step!.id}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          <button type="button" className="cursor-pointer border border-sky-500/45 bg-sky-500/10 px-3 py-1 text-sky-100 transition-all duration-150 hover:bg-sky-500/25 hover:border-sky-400/70 hover:shadow-[0_0_8px_rgba(56,189,248,0.25)] hover:text-sky-50">{step!.type}</button>
          <button type="button" className="cursor-pointer border border-slate-700 bg-slate-950/60 px-3 py-1 text-slate-200 transition-all duration-150 hover:bg-slate-800/80 hover:border-slate-500/70 hover:shadow-[0_0_8px_rgba(148,163,184,0.2)] hover:text-white">{step!.model}</button>
          <span className="border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-100">{step!.status}</span>
        </div>
      </div>
      <StepForm step={step!} />
      <StepActions nodeId={step!.id} isGate={false} />
    </div>
  )
}
