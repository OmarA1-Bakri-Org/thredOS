import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { StepNotFoundError } from '../../errors'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

export async function groupCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  let result: { success: boolean; action: string; message?: string; error?: string; groups?: Record<string, string[]> }

  switch (subcommand) {
    case 'parallelize': {
      if (args.length < 2) {
        result = { success: false, action: 'parallelize', error: 'Usage: seqctl group parallelize <stepId1> <stepId2> [...]' }
        break
      }
      const sequence = await readSequence(basePath)
      const groupId = `group-${randomUUID().slice(0, 8)}`

      for (const stepId of args) {
        const step = sequence.steps.find(s => s.id === stepId)
        if (!step) {
          result = { success: false, action: 'parallelize', error: new StepNotFoundError(stepId).message }
          break
        }
        step.group_id = groupId
        step.type = 'p'
        step.kind = 'p'
      }
      // If we broke early due to error
      if (result!) break

      validateDAG(sequence)
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'parallelize', message: `Steps [${args.join(', ')}] grouped as '${groupId}' (parallel)` }
      break
    }

    case 'list': {
      const sequence = await readSequence(basePath)
      const groups: Record<string, string[]> = {}
      for (const step of sequence.steps) {
        if (step.group_id) {
          if (!groups[step.group_id]) groups[step.group_id] = []
          groups[step.group_id].push(step.id)
        }
      }
      if (options.json) {
        console.log(JSON.stringify({ success: true, action: 'list', groups }))
        return
      }
      if (Object.keys(groups).length === 0) {
        console.log('No groups found')
      } else {
        for (const [gid, steps] of Object.entries(groups)) {
          console.log(`${gid}: ${steps.join(', ')}`)
        }
      }
      return
    }

    default:
      result = { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl group parallelize|list' }
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
