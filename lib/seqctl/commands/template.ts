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

interface TemplateGenResult {
  steps: Step[]
  gates: Gate[]
}

type TemplateGenerator = (commonOpts: Record<string, unknown>, values: Record<string, unknown>) => TemplateGenResult

const templateGenerators: Record<string, TemplateGenerator> = {
  base: (opts) => ({ steps: generateBase(opts), gates: [] }),
  parallel: (opts) => ({ steps: generateParallel(opts), gates: [] }),
  chained: (opts, values) => {
    const result = generateChained({ ...opts, gates: values.gates as boolean | undefined })
    return { steps: result.steps, gates: result.gates }
  },
  fusion: (opts) => ({ steps: generateFusion({ ...opts, candidateCount: opts.count as number | undefined }), gates: [] }),
  orchestrated: (opts) => ({ steps: generateOrchestrated({ ...opts, workerCount: opts.count as number | undefined }), gates: [] }),
  'long-autonomy': (opts, values) => ({
    steps: generateLongAutonomy({
      ...opts,
      timeoutMs: values['timeout-ms'] ? parseInt(values['timeout-ms'] as string) : undefined,
    }),
    gates: [],
  }),
}

function exitTemplateError(error: string, json: boolean): never {
  if (json) { console.log(JSON.stringify({ success: false, error })) } else { console.error(error) }
  process.exit(1)
}

export async function templateCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  if (subcommand !== 'apply') {
    return exitTemplateError(`Unknown subcommand. Usage: seqctl template apply <type> [options]\nTypes: ${TEMPLATE_TYPES.join(', ')}`, options.json)
  }

  const templateType = args[0]
  if (!templateType || !(TEMPLATE_TYPES as readonly string[]).includes(templateType)) {
    return exitTemplateError(
      new InvalidTemplateError(templateType || '(none)').message + `. Available: ${TEMPLATE_TYPES.join(', ')}`,
      options.json,
    )
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

  const generator = templateGenerators[templateType]
  const { steps: newSteps, gates: newGates } = generator(commonOpts, values)

  const sequence = await readSequence(basePath)
  sequence.steps.push(...newSteps)
  sequence.gates.push(...newGates)

  try {
    validateDAG(sequence)
  } catch (error) {
    return exitTemplateError(error instanceof Error ? error.message : 'DAG validation failed', options.json)
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
