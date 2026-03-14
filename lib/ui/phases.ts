'use client'

/**
 * Phase derivation — maps flat steps/gates into logical phases
 * based on thread type patterns.
 *
 * A phase represents the atomic unit of thread construction:
 * each phase contains at minimum a node, an agent, and a gate.
 */

export interface Phase {
  id: string
  label: string
  /** Index in the phase sequence (0-based) */
  order: number
  /** Step IDs belonging to this phase */
  stepIds: string[]
  /** Gate IDs belonging to this phase */
  gateIds: string[]
  /** Phase role within the thread type pattern */
  role: 'primary' | 'candidate' | 'synthesis' | 'handoff' | 'watchdog'
}

export interface PhaseDerivation {
  phases: Phase[]
  threadType: string
  /** Whether the phase structure could be determined */
  resolved: boolean
}

interface StepData {
  id: string
  name: string
  type: string
  model: string
  status: string
  dependsOn: string[]
}

interface GateData {
  id: string
  name: string
  status: string
}

/**
 * Derive phases from steps and gates.
 *
 * Associates each gate with the step it directly depends on (gates
 * typically depend on a single step). Steps without a gate still
 * form their own phase — the gate is just missing.
 */
export function derivePhases(
  steps: StepData[],
  gates: GateData[],
  threadType?: string,
): PhaseDerivation {
  if (steps.length === 0) {
    return { phases: [], threadType: threadType ?? 'base', resolved: false }
  }

  // Build a lookup of gate → which step it guards
  // Convention: gate ID often starts with "gate-" prefix of a step,
  // or gates reference step IDs in a naming pattern.
  // For now, pair gates with steps by dependency order:
  // gates that have no dependsOn go to the first step,
  // otherwise match by position.
  const gateStepMap = new Map<string, string[]>()
  const assignedGates = new Set<string>()

  // First pass: try to match gates to steps by ID pattern
  for (const gate of gates) {
    // Common pattern: gate ID contains step ID (e.g., "gate-step-1" guards "step-1")
    const matchingStep = steps.find(
      s => gate.id.includes(s.id) || gate.name.includes(s.name)
    )
    if (matchingStep) {
      const existing = gateStepMap.get(matchingStep.id) ?? []
      existing.push(gate.id)
      gateStepMap.set(matchingStep.id, existing)
      assignedGates.add(gate.id)
    }
  }

  // Second pass: assign remaining gates by position
  const unassignedGates = gates.filter(g => !assignedGates.has(g.id))
  const stepsWithoutGates = steps.filter(s => !gateStepMap.has(s.id))
  for (let i = 0; i < Math.min(unassignedGates.length, stepsWithoutGates.length); i++) {
    const existing = gateStepMap.get(stepsWithoutGates[i].id) ?? []
    existing.push(unassignedGates[i].id)
    gateStepMap.set(stepsWithoutGates[i].id, existing)
  }

  // Determine phase roles based on thread type
  const resolvedType = threadType ?? detectThreadType(steps)
  const phases: Phase[] = steps.map((step, index) => {
    const role = resolvePhaseRole(resolvedType, index, steps.length)
    return {
      id: `phase-${step.id}`,
      label: step.name || step.id,
      order: index,
      stepIds: [step.id],
      gateIds: gateStepMap.get(step.id) ?? [],
      role,
    }
  })

  return {
    phases,
    threadType: resolvedType,
    resolved: true,
  }
}

/**
 * Detect thread type from step structure when not explicitly set.
 * Falls back to 'base' for single steps, 'c' for sequential chains.
 */
function detectThreadType(steps: StepData[]): string {
  if (steps.length <= 1) return 'base'

  // Check if steps form a chain (each depends on the previous)
  const hasChain = steps.some(s => s.dependsOn.length > 0)
  if (!hasChain) return 'p' // No dependencies = parallel

  // Check for fusion pattern: multiple steps without deps + one with deps on all
  const rootSteps = steps.filter(s => s.dependsOn.length === 0)
  const synthSteps = steps.filter(s => s.dependsOn.length >= 2)
  if (rootSteps.length >= 2 && synthSteps.length === 1) return 'f'

  return 'c' // Default to chained
}

function resolvePhaseRole(
  threadType: string,
  index: number,
  total: number,
): Phase['role'] {
  switch (threadType) {
    case 'base':
      return 'primary'
    case 'p':
      return 'primary'
    case 'c':
      return 'primary'
    case 'f':
      return index < total - 1 ? 'candidate' : 'synthesis'
    case 'b':
      return 'handoff'
    case 'l':
      return index === 0 ? 'primary' : 'watchdog'
    default:
      return 'primary'
  }
}

/** Get the phase that contains a given step ID */
export function findPhaseForStep(phases: Phase[], stepId: string): Phase | undefined {
  return phases.find(p => p.stepIds.includes(stepId))
}

/** Get the phase that contains a given gate ID */
export function findPhaseForGate(phases: Phase[], gateId: string): Phase | undefined {
  return phases.find(p => p.gateIds.includes(gateId))
}
