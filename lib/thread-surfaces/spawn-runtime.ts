import type { Sequence, Step } from '@/lib/sequence/schema'

export type SpawnKind = 'orchestrator' | 'watchdog' | 'fanout'

export interface SpawnSpec {
  parentThreadSurfaceId: string
  childThreadSurfaceId: string
  parentAgentNodeId: string
  childAgentNodeId: string
  childSurfaceLabel: string
  spawnKind: SpawnKind
  order: number
}

interface DeriveSpawnSpecsForStepArgs {
  sequence: Sequence
  step: Step
}

export function deriveSpawnSpecsForStep({ sequence, step }: DeriveSpawnSpecsForStepArgs): SpawnSpec[] {
  const orchestratedChildren = sequence.steps
    .filter(candidate => candidate.id !== step.id && candidate.orchestrator === step.id)
    .map((childStep, index) => ({
      parentThreadSurfaceId: deriveThreadSurfaceId(step.id),
      childThreadSurfaceId: deriveThreadSurfaceId(childStep.id),
      parentAgentNodeId: step.id,
      childAgentNodeId: childStep.id,
      childSurfaceLabel: childStep.name,
      spawnKind: 'orchestrator' as const,
      order: index + 1,
    }))

  if (orchestratedChildren.length > 0) {
    return orchestratedChildren
  }

  if (step.watchdog_for) {
    return [{
      parentThreadSurfaceId: deriveThreadSurfaceId(step.watchdog_for),
      childThreadSurfaceId: deriveThreadSurfaceId(step.id),
      parentAgentNodeId: step.watchdog_for,
      childAgentNodeId: step.id,
      childSurfaceLabel: step.name,
      spawnKind: 'watchdog',
      order: 1,
    }]
  }

  if (step.fanout && step.fanout > 0) {
    return Array.from({ length: step.fanout }, (_, index) => {
      const childAgentNodeId = `${step.id}-fanout-${index + 1}`
      return {
        parentThreadSurfaceId: deriveThreadSurfaceId(step.id),
        childThreadSurfaceId: deriveThreadSurfaceId(childAgentNodeId),
        parentAgentNodeId: step.id,
        childAgentNodeId,
        childSurfaceLabel: `${step.name} fanout ${index + 1}`,
        spawnKind: 'fanout' as const,
        order: index + 1,
      }
    })
  }

  return []
}

function deriveThreadSurfaceId(stepId: string): string {
  return `thread-${stepId}`
}
