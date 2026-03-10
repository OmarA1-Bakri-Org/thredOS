'use client'

import { AlertTriangle, GitBranch, ShieldCheck, Wrench } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useThreadMerges, useThreadRuns, useThreadSurfaces } from '@/lib/ui/api'
import { StepForm } from './StepForm'
import { StepActions } from './StepActions'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ThreadSurfaceInspector } from './ThreadSurfaceInspector'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { contentCreatorWorkflow, resolveWorkflowReferenceStep } from '@/lib/workflows'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'

function EmptyInspectorState({ message }: { message: string }) {
  return (
    <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4 text-sm text-slate-200">
      {message}
    </div>
  )
}

export function StepInspector() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const { data: status, isLoading } = useStatus()
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: runs } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()

  const laneBoard = threadSurfaces && runs && mergeEvents
    ? createLaneBoardModel({
        threadSurfaces,
        runs,
        mergeEvents,
        runIds: runs.map(run => run.id),
      })
    : null
  const focusedThreadDetail = threadSurfaces && runs && mergeEvents && laneBoard
    ? resolveThreadSurfaceFocusedDetail({
        threadSurfaces,
        runs,
        mergeEvents,
        rows: laneBoard.rows,
        mergeGroups: laneBoard.mergeGroups,
        focusedThreadSurfaceId: selectedThreadSurfaceId,
        selectedRunId,
      })
    : null

  if (!selectedNodeId && focusedThreadDetail) {
    const workflowStep = resolveWorkflowReferenceStep(contentCreatorWorkflow, {
      selectedNodeId: null,
      threadSurfaceLabel: focusedThreadDetail.surfaceLabel,
      threadRole: focusedThreadDetail.role,
      runSummary: focusedThreadDetail.runSummary,
    })

    return <ThreadSurfaceInspector detail={focusedThreadDetail} workflowStep={workflowStep} />
  }

  if (!selectedNodeId) {
    return <EmptyInspectorState message="Select a thread surface, step, or gate to inspect." />
  }

  if (isLoading) return <LoadingSpinner message="Loading inspector..." />

  if (!status) {
    return <EmptyInspectorState message="Sequence status is unavailable." />
  }

  const step = status.steps.find(s => s.id === selectedNodeId)
  const gate = status.gates.find(g => g.id === selectedNodeId)
  const workflowStep = resolveWorkflowReferenceStep(contentCreatorWorkflow, {
    selectedNodeId,
    threadSurfaceLabel: step?.name ?? gate?.name ?? selectedNodeId,
    runSummary: step?.name ?? gate?.name ?? selectedNodeId,
  })

  if (!step && !gate) {
    return <EmptyInspectorState message="The selected node could not be resolved from the current sequence state." />
  }

  if (gate) {
    return (
      <div className="space-y-4">
        <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Gate</div>
          <div className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            {gate.id}
          </div>
          <p className="mt-2 text-sm text-slate-200">{gate.name}</p>
        </section>

        <section className="grid gap-3 xl:grid-cols-2">
          <div className="border border-slate-700 bg-slate-950/65 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">State</div>
            <div className="mt-3 text-sm text-slate-100">
              <div><strong className="text-white">Status:</strong> <span className="font-mono uppercase tracking-[0.14em] text-emerald-100">{gate.status}</span></div>
              <div className="mt-2"><strong className="text-white">Dependencies:</strong> {gate.dependsOn.length > 0 ? gate.dependsOn.join(', ') : 'None'}</div>
            </div>
          </div>
          <div className="border border-slate-700 bg-slate-950/65 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Control</div>
            <p className="mt-3 text-sm text-slate-300">
              Gates regulate downstream work. Approval allows progression; blocking keeps the dependency chain halted.
            </p>
          </div>
        </section>

      <section className="border border-slate-700 bg-[#0a101a] px-4 py-4">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Actions</div>
        <StepActions nodeId={gate.id} isGate />
      </section>

      {workflowStep ? (
        <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
      ) : null}
    </div>
  )
}

  return (
    <div className="space-y-4">
      <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Thread / Run detail</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{step!.id}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          <span className="rounded-full border border-sky-500/45 bg-sky-500/10 px-3 py-1 text-sky-100">{step!.type}</span>
          <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-slate-200">{step!.model}</span>
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-100">{step!.status}</span>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <div className="border border-slate-700 bg-slate-950/65 px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
            <Wrench className="h-3.5 w-3.5" />
            Thread context
          </div>
          <StepForm step={step!} />
        </div>

        <div className="space-y-3">
          <div className="border border-slate-700 bg-slate-950/65 px-4 py-4">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
              <GitBranch className="h-3.5 w-3.5" />
              Provenance
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div><strong className="text-white">Sequence:</strong> {status.name}</div>
              <div><strong className="text-white">Runtime status:</strong> {step!.status}</div>
              <div><strong className="text-white">Dependencies:</strong> {step!.dependsOn.length > 0 ? step!.dependsOn.join(', ') : 'None'}</div>
            </div>
          </div>

          <div className="border border-slate-700 bg-slate-950/65 px-4 py-4">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              Operational guidance
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Use restart for a clean rerun. Use stop only when you intend to interrupt active work and accept downstream impact.
            </p>
          </div>
        </div>
      </section>

      <section className="border border-slate-700 bg-[#0a101a] px-4 py-4">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Actions</div>
        <StepActions nodeId={step!.id} isGate={false} />
      </section>

      {workflowStep ? (
        <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
      ) : (
        <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
      )}
    </div>
  )
}
