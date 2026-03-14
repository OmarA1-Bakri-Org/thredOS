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
 * Assign gates to steps by ID pattern matching.
 * Returns a map of stepId -> gateIds[] and a set of assigned gate IDs.
 */
function assignGatesByPattern(
  steps: StepData[],
  gates: GateData[],
): { gateStepMap: Map<string, string[]>; assignedGates: Set<string> } {
  const gateStepMap = new Map<string, string[]>()
  const assignedGates = new Set<string>()

  for (const gate of gates) {
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

  return { gateStepMap, assignedGates }
}

/**
 * Assign remaining unmatched gates to steps without gates, by position.
 */
function assignRemainingGatesByPosition(
  steps: StepData[],
  gates: GateData[],
  gateStepMap: Map<string, string[]>,
  assignedGates: Set<string>,
) {
  const unassignedGates = gates.filter(g => !assignedGates.has(g.id))
  const stepsWithoutGates = steps.filter(s => !gateStepMap.has(s.id))
  const count = Math.min(unassignedGates.length, stepsWithoutGates.length)

  for (let i = 0; i < count; i++) {
    const existing = gateStepMap.get(stepsWithoutGates[i].id) ?? []
    existing.push(unassignedGates[i].id)
    gateStepMap.set(stepsWithoutGates[i].id, existing)
  }
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

  const { gateStepMap, assignedGates } = assignGatesByPattern(steps, gates)
  assignRemainingGatesByPosition(steps, gates, gateStepMap, assignedGates)

  const resolvedType = threadType ?? detectThreadType(steps)
  const phases: Phase[] = steps.map((step, index) => ({
    id: `phase-${step.id}`,
    label: step.name || step.id,
    order: index,
    stepIds: [step.id],
    gateIds: gateStepMap.get(step.id) ?? [],
    role: resolvePhaseRole(resolvedType, index, steps.length),
  }))

  return {
    phases,
    threadType: resolvedType,
    resolved: true,
  }
}

/**
 * Thread type detection rules — each returns the type string if matched, or null.
 * Order matters: more specific patterns checked first.
 */
interface DetectionRule {
  test: (steps: StepData[]) => boolean
  type: string
}

const DETECTION_RULES: DetectionRule[] = [
  {
    // Fusion: 2+ root steps and exactly 1 synthesis step depending on 2+
    test: (steps) => {
      const rootSteps = steps.filter(s => s.dependsOn.length === 0)
      const synthSteps = steps.filter(s => s.dependsOn.length >= 2)
      return rootSteps.length >= 2 && synthSteps.length === 1
    },
    type: 'f',
  },
  {
    // Parallel: no dependencies at all
    test: (steps) => !steps.some(s => s.dependsOn.length > 0),
    type: 'p',
  },
  {
    // Chained: has at least one dependency (default for multi-step with deps)
    test: (steps) => steps.some(s => s.dependsOn.length > 0),
    type: 'c',
  },
]

/**
 * Detect thread type from step structure when not explicitly set.
 * Falls back to 'base' for single steps, 'c' for sequential chains.
 */
function detectThreadType(steps: StepData[]): string {
  if (steps.length <= 1) return 'base'

  for (const rule of DETECTION_RULES) {
    if (rule.test(steps)) return rule.type
  }

  return 'c'
}

/** Phase role lookup table by thread type. */
const PHASE_ROLE_TABLE: Record<string, (index: number, total: number) => Phase['role']> = {
  base: () => 'primary',
  p: () => 'primary',
  c: () => 'primary',
  f: (index, total) => (index < total - 1 ? 'candidate' : 'synthesis'),
  b: () => 'handoff',
  l: (index) => (index === 0 ? 'primary' : 'watchdog'),
}

function resolvePhaseRole(
  threadType: string,
  index: number,
  total: number,
): Phase['role'] {
  const resolver = PHASE_ROLE_TABLE[threadType]
  return resolver ? resolver(index, total) : 'primary'
}

/** Get the phase that contains a given step ID */
export function findPhaseForStep(phases: Phase[], stepId: string): Phase | undefined {
  return phases.find(p => p.stepIds.includes(stepId))
}

/** Get the phase that contains a given gate ID */
export function findPhaseForGate(phases: Phase[], gateId: string): Phase | undefined {
  return phases.find(p => p.gateIds.includes(gateId))
}
