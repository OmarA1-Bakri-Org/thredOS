import type { Step, Gate } from '../sequence/schema'

export interface ChainedTemplateOptions {
  prefix?: string
  count?: number
  model?: 'claude-code' | 'codex' | 'gemini'
  gates?: boolean
}

export function generateChained(opts: ChainedTemplateOptions = {}): { steps: Step[]; gates: Gate[] } {
  const prefix = opts.prefix || 'chain'
  const count = opts.count || 3
  const model = opts.model || 'claude-code'
  const addGates = opts.gates ?? false

  const steps: Step[] = []
  const gates: Gate[] = []

  for (let i = 1; i <= count; i++) {
    const id = `${prefix}-${i}`
    const deps: string[] = []
    if (i > 1) {
      if (addGates) {
        deps.push(`${prefix}-gate-${i - 1}`)
      } else {
        deps.push(`${prefix}-${i - 1}`)
      }
    }
    steps.push({
      id,
      name: `${prefix} ${i}`,
      type: 'c',
      model,
      prompt_file: `.threados/prompts/${id}.md`,
      depends_on: deps,
      status: 'READY',
    })

    if (addGates && i < count) {
      const gateId = `${prefix}-gate-${i}`
      gates.push({
        id: gateId,
        name: `Gate after ${id}`,
        depends_on: [id],
        status: 'PENDING',
        cascade: false,
        childGateIds: [],
      })
    }
  }
  return { steps, gates }
}
