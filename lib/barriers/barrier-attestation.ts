import type { BarrierAttestation } from '@/lib/contracts/schemas'

interface CreateAttestationInput {
  surfaceId: string
  runId: string
  isolationLabel: 'NONE' | 'THREADOS_SCOPED' | 'HOST_ENFORCED'
  revealState: 'sealed' | 'revealed'
  contaminationEvents?: string[]
}

export function createBarrierAttestation(input: CreateAttestationInput): BarrierAttestation {
  const isSealed = input.revealState === 'sealed'
  return {
    surface_id: input.surfaceId,
    run_id: input.runId,
    isolation_label: input.isolationLabel,
    cross_surface_reads_denied: isSealed,
    shared_semantic_projection: !isSealed,
    reveal_state: input.revealState,
    contamination_events: input.contaminationEvents ?? [],
  }
}
