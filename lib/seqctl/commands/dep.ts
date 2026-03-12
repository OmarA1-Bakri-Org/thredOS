import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { StepNotFoundError, DependencyNotFoundError } from '../../errors'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

export async function depCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  let result: { success: boolean; action: string; message?: string; error?: string }

  switch (subcommand) {
    case 'add': {
      const [stepId, depId] = args
      if (!stepId || !depId) {
        result = { success: false, action: 'add', error: 'Usage: seqctl dep add <stepId> <depId>' }
        break
      }
      const sequence = await readSequence(basePath)
      const step = sequence.steps.find(s => s.id === stepId)
      if (!step) {
        result = { success: false, action: 'add', error: new StepNotFoundError(stepId).message }
        break
      }
      // Verify depId exists as step or gate
      const depExists = sequence.steps.some(s => s.id === depId) || sequence.gates.some(g => g.id === depId)
      if (!depExists) {
        result = { success: false, action: 'add', error: `Node '${depId}' does not exist` }
        break
      }
      if (step.depends_on.includes(depId)) {
        result = { success: false, action: 'add', error: `Step '${stepId}' already depends on '${depId}'` }
        break
      }
      step.depends_on.push(depId)
      try {
        validateDAG(sequence)
      } catch (error) {
        step.depends_on.pop()
        result = { success: false, action: 'add', error: error instanceof Error ? error.message : 'DAG validation failed' }
        break
      }
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'add', message: `Added dependency '${depId}' to step '${stepId}'` }
      break
    }

    case 'rm': {
      const [stepId, depId] = args
      if (!stepId || !depId) {
        result = { success: false, action: 'rm', error: 'Usage: seqctl dep rm <stepId> <depId>' }
        break
      }
      const sequence = await readSequence(basePath)
      const step = sequence.steps.find(s => s.id === stepId)
      if (!step) {
        result = { success: false, action: 'rm', error: new StepNotFoundError(stepId).message }
        break
      }
      const idx = step.depends_on.indexOf(depId)
      if (idx === -1) {
        result = { success: false, action: 'rm', error: new DependencyNotFoundError(stepId, depId).message }
        break
      }
      step.depends_on.splice(idx, 1)
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'rm', message: `Removed dependency '${depId}' from step '${stepId}'` }
      break
    }

    default:
      result = { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl dep add|rm' }
  }

  if (options.json) {
    console.log(JSON.stringify(result))
  } else {
    if (result.success) {
      console.log(result.message)
    } else {
      console.error(`Error: ${result.error}`)
      process.exit(1)
    }
  }
}
