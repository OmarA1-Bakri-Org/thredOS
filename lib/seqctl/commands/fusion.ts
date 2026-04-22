import { parseArgs } from 'util'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { StepNotFoundError } from '../../errors'
import type { Step } from '../../sequence/schema'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

type FusionResult = { success: boolean; action: string; message?: string; error?: string }

async function handleFusionCreate(basePath: string, args: string[]): Promise<FusionResult> {
  const { values } = parseArgs({
    args,
    options: {
      candidates: { type: 'string', short: 'c' },
      synth: { type: 'string', short: 's' },
    },
    allowPositionals: true,
    strict: false,
  })

  const candidateIds = values.candidates ? (values.candidates as string).split(',').map(s => s.trim()) : []
  const synthId = values.synth as string | undefined

  if (candidateIds.length < 2 || !synthId) {
    return { success: false, action: 'create', error: 'Usage: seqctl fusion create --candidates <id1,id2,...> --synth <synthId>' }
  }

  const sequence = await readSequence(basePath)

  // Validate candidate steps exist
  for (const cid of candidateIds) {
    if (!sequence.steps.some(s => s.id === cid)) {
      return { success: false, action: 'create', error: new StepNotFoundError(cid).message }
    }
  }

  // Mark candidates
  for (const cid of candidateIds) {
    const step = sequence.steps.find(s => s.id === cid)!
    step.fusion_candidates = true
    step.type = 'f'
    step.kind = 'f'
  }

  // Create or update synth step
  if (!sequence.steps.some(s => s.id === synthId)) {
    const synthStep: Step = {
      id: synthId,
      name: `Fusion synth: ${synthId}`,
      kind: 'f',
      type: 'f',
      model: 'claude-code',
      prompt_file: `.threados/prompts/${synthId}.md`,
      depends_on: [...candidateIds],
      status: 'READY',
      fusion_synth: true,
    }
    sequence.steps.push(synthStep)
  } else {
    const existing = sequence.steps.find(s => s.id === synthId)!
    existing.fusion_synth = true
    existing.type = 'f'
    existing.kind = 'f'
    for (const cid of candidateIds) {
      if (!existing.depends_on.includes(cid)) existing.depends_on.push(cid)
    }
  }

  try {
    validateDAG(sequence)
  } catch (error) {
    return { success: false, action: 'create', error: error instanceof Error ? error.message : 'DAG validation failed' }
  }

  await writeSequence(basePath, sequence)
  return { success: true, action: 'create', message: `Fusion created: candidates [${candidateIds.join(', ')}] → synth '${synthId}'` }
}

type FusionHandler = (basePath: string, args: string[]) => Promise<FusionResult>

const fusionHandlers: Record<string, FusionHandler> = {
  create: handleFusionCreate,
}

function outputFusionResult(result: FusionResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(result.message)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
}

export async function fusionCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  const handler = subcommand ? fusionHandlers[subcommand] : undefined
  const result = handler
    ? await handler(basePath, args)
    : { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl fusion create' }

  outputFusionResult(result, options)
}
