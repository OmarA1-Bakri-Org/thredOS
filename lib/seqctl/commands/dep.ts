import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { StepNotFoundError, DependencyNotFoundError } from '../../errors'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

type DepResult = { success: boolean; action: string; message?: string; error?: string }

async function handleDepAdd(basePath: string, args: string[]): Promise<DepResult> {
  const [stepId, depId] = args
  if (!stepId || !depId) {
    return { success: false, action: 'add', error: 'Usage: seqctl dep add <stepId> <depId>' }
  }

  const sequence = await readSequence(basePath)
  const step = sequence.steps.find(s => s.id === stepId)
  if (!step) {
    return { success: false, action: 'add', error: new StepNotFoundError(stepId).message }
  }

  const depExists = sequence.steps.some(s => s.id === depId) || sequence.gates.some(g => g.id === depId)
  if (!depExists) {
    return { success: false, action: 'add', error: `Node '${depId}' does not exist` }
  }
  if (step.depends_on.includes(depId)) {
    return { success: false, action: 'add', error: `Step '${stepId}' already depends on '${depId}'` }
  }

  step.depends_on.push(depId)
  try {
    validateDAG(sequence)
  } catch (error) {
    step.depends_on.pop()
    return { success: false, action: 'add', error: error instanceof Error ? error.message : 'DAG validation failed' }
  }

  await writeSequence(basePath, sequence)
  return { success: true, action: 'add', message: `Added dependency '${depId}' to step '${stepId}'` }
}

async function handleDepRm(basePath: string, args: string[]): Promise<DepResult> {
  const [stepId, depId] = args
  if (!stepId || !depId) {
    return { success: false, action: 'rm', error: 'Usage: seqctl dep rm <stepId> <depId>' }
  }

  const sequence = await readSequence(basePath)
  const step = sequence.steps.find(s => s.id === stepId)
  if (!step) {
    return { success: false, action: 'rm', error: new StepNotFoundError(stepId).message }
  }

  const idx = step.depends_on.indexOf(depId)
  if (idx === -1) {
    return { success: false, action: 'rm', error: new DependencyNotFoundError(stepId, depId).message }
  }

  step.depends_on.splice(idx, 1)
  await writeSequence(basePath, sequence)
  return { success: true, action: 'rm', message: `Removed dependency '${depId}' from step '${stepId}'` }
}

type DepHandler = (basePath: string, args: string[]) => Promise<DepResult>

const depHandlers: Record<string, DepHandler> = {
  add: handleDepAdd,
  rm: handleDepRm,
}

function outputDepResult(result: DepResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(result.message)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
}

export async function depCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  const handler = subcommand ? depHandlers[subcommand] : undefined
  const result = handler
    ? await handler(basePath, args)
    : { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl dep add|rm' }

  outputDepResult(result, options)
}
