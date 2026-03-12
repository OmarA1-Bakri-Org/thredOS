'use client'

import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
import { contentCreatorWorkflow, resolveWorkflowReferenceStep } from '@/lib/workflows'

export function StructureContent() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const { data: status } = useStatus()

  const step = status?.steps.find(s => s.id === selectedNodeId)
  const gate = status?.gates.find(g => g.id === selectedNodeId)

  const workflowStep = resolveWorkflowReferenceStep(contentCreatorWorkflow, {
    selectedNodeId,
    threadSurfaceLabel: step?.name ?? gate?.name ?? selectedNodeId ?? '',
    runSummary: step?.name ?? gate?.name ?? selectedNodeId ?? '',
  })

  return (
    <div className="space-y-4">
      {workflowStep ? (
        <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowStep} />
      ) : null}
      <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
    </div>
  )
}
