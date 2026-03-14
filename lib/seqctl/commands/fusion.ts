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

export async function fusionCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  let result: { success: boolean; action: string; message?: string; error?: string }

  switch (subcommand) {
    case 'create': {
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
        result = { success: false, action: 'create', error: 'Usage: seqctl fusion create --candidates <id1,id2,...> --synth <synthId>' }
        break
      }

      const sequence = await readSequence(basePath)

      // Validate candidate steps exist
      for (const cid of candidateIds) {
        if (!sequence.steps.some(s => s.id === cid)) {
          result = { success: false, action: 'create', error: new StepNotFoundError(cid).message }
          break
        }
      }
      if (result!) break

      // Mark candidates
      for (const cid of candidateIds) {
        const step = sequence.steps.find(s => s.id === cid)!
        step.fusion_candidates = true
        step.type = 'f'
      }

      // Create synth step if it doesn't exist
      if (!sequence.steps.some(s => s.id === synthId)) {
        const synthStep: Step = {
          id: synthId,
          name: `Fusion synth: ${synthId}`,
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
        for (const cid of candidateIds) {
          if (!existing.depends_on.includes(cid)) existing.depends_on.push(cid)
        }
      }

      try {
        validateDAG(sequence)
      } catch (error) {
        result = { success: false, action: 'create', error: error instanceof Error ? error.message : 'DAG validation failed' }
        break
      }

      await writeSequence(basePath, sequence)
      result = { success: true, action: 'create', message: `Fusion created: candidates [${candidateIds.join(', ')}] → synth '${synthId}'` }
      break
    }

    default:
      result = { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl fusion create' }
  }

  if (options.json) {
    console.log(JSON.stringify(result!))
  } else {
    if (result!.success) {
      console.log(result!.message)
    } else {
      console.error(`Error: ${result!.error}`)
      process.exit(1)
    }
  }
}
