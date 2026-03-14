import type { Step, Gate } from '../sequence/schema'

export interface ChainedTemplateOptions {
  prefix?: string
  count?: number
  model?: 'claude-code' | 'codex' | 'gemini'
  gates?: boolean
}

function buildStepDependency(prefix: string, index: number, addGates: boolean): string[] {
  if (index <= 1) return []
  const depId = addGates ? `${prefix}-gate-${index - 1}` : `${prefix}-${index - 1}`
  return [depId]
}

function buildStep(prefix: string, index: number, model: string, deps: string[]): Step {
  const id = `${prefix}-${index}`
  return {
    id,
    name: `${prefix} ${index}`,
    type: 'c',
    model,
    prompt_file: `.threados/prompts/${id}.md`,
    depends_on: deps,
    status: 'READY',
  }
}

function buildGate(prefix: string, index: number): Gate {
  const stepId = `${prefix}-${index}`
  const gateId = `${prefix}-gate-${index}`
  return {
    id: gateId,
    name: `Gate after ${stepId}`,
    depends_on: [stepId],
    status: 'PENDING',
    cascade: false,
    childGateIds: [],
  }
}

export function generateChained(opts: ChainedTemplateOptions = {}): { steps: Step[]; gates: Gate[] } {
  const prefix = opts.prefix || 'chain'
  const count = opts.count || 3
  const model = opts.model || 'claude-code'
  const addGates = opts.gates ?? false

  const steps: Step[] = []
  const gates: Gate[] = []

  for (let i = 1; i <= count; i++) {
    const deps = buildStepDependency(prefix, i, addGates)
    steps.push(buildStep(prefix, i, model, deps))

    if (addGates && i < count) {
      gates.push(buildGate(prefix, i))
    }
  }
  return { steps, gates }
}
