import { parseArgs } from 'util'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { InvalidTemplateError } from '../../errors'
import {
  TEMPLATE_TYPES,
  generateBase,
  generateParallel,
  generateChained,
  generateFusion,
  generateOrchestrated,
  generateLongAutonomy,
} from '../../templates'
import type { Step, Gate } from '../../sequence/schema'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

export async function templateCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  if (subcommand !== 'apply') {
    const error = `Unknown subcommand. Usage: seqctl template apply <type> [options]\nTypes: ${TEMPLATE_TYPES.join(', ')}`
    if (options.json) { console.log(JSON.stringify({ success: false, error })) } else { console.error(error) }
    process.exit(1)
  }

  const templateType = args[0]
  if (!templateType || !(TEMPLATE_TYPES as readonly string[]).includes(templateType)) {
    const error = new InvalidTemplateError(templateType || '(none)').message + `. Available: ${TEMPLATE_TYPES.join(', ')}`
    if (options.json) { console.log(JSON.stringify({ success: false, error })) } else { console.error(error) }
    process.exit(1)
  }

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      prefix: { type: 'string' },
      count: { type: 'string' },
      model: { type: 'string' },
      gates: { type: 'boolean' },
      'timeout-ms': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  })

  const commonOpts = {
    prefix: values.prefix as string | undefined,
    count: values.count ? parseInt(values.count as string) : undefined,
    model: (values.model as 'claude-code' | 'codex' | 'gemini') || undefined,
  }

  let newSteps: Step[] = []
  let newGates: Gate[] = []

  switch (templateType) {
    case 'base':
      newSteps = generateBase(commonOpts)
      break
    case 'parallel':
      newSteps = generateParallel(commonOpts)
      break
    case 'chained': {
      const result = generateChained({ ...commonOpts, gates: values.gates as boolean | undefined })
      newSteps = result.steps
      newGates = result.gates
      break
    }
    case 'fusion':
      newSteps = generateFusion({ ...commonOpts, candidateCount: commonOpts.count })
      break
    case 'orchestrated':
      newSteps = generateOrchestrated({ ...commonOpts, workerCount: commonOpts.count })
      break
    case 'long-autonomy':
      newSteps = generateLongAutonomy({
        ...commonOpts,
        timeoutMs: values['timeout-ms'] ? parseInt(values['timeout-ms'] as string) : undefined,
      })
      break
  }

  const sequence = await readSequence(basePath)
  sequence.steps.push(...newSteps)
  sequence.gates.push(...newGates)

  try {
    validateDAG(sequence)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'DAG validation failed'
    if (options.json) { console.log(JSON.stringify({ success: false, error: msg })) } else { console.error(msg) }
    process.exit(1)
  }

  await writeSequence(basePath, sequence)

  const result = {
    success: true,
    action: 'apply',
    template: templateType,
    stepsAdded: newSteps.map(s => s.id),
    gatesAdded: newGates.map(g => g.id),
    message: `Template '${templateType}' applied: ${newSteps.length} step(s), ${newGates.length} gate(s) added`,
  }

  if (options.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(result.message)
  }
}
