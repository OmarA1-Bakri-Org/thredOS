import { parseArgs } from 'util'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { StepNotFoundError } from '../../errors'
import { StepSchema, type Step, type StepType, type ModelType, type StepStatus } from '../../sequence/schema'
import { writePrompt, deletePrompt, validatePromptExists } from '../../prompts/manager'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

interface StepResult {
  success: boolean
  action: string
  stepId: string
  message?: string
  error?: string
}

/**
 * Parse step subcommand options
 */
function parseStepArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      name: { type: 'string', short: 'n' },
      type: { type: 'string', short: 't' },
      model: { type: 'string', short: 'm' },
      prompt: { type: 'string', short: 'p' },
      status: { type: 'string', short: 's' },
      cwd: { type: 'string' },
      'depends-on': { type: 'string', short: 'd' },
    },
    allowPositionals: true,
    strict: false,
  })

  return { values, positionals }
}

/**
 * Add a new step
 */
async function addStep(
  basePath: string,
  stepId: string,
  options: Record<string, unknown>
): Promise<StepResult> {
  const sequence = await readSequence(basePath)

  // Check if step already exists
  if (sequence.steps.some(s => s.id === stepId)) {
    return {
      success: false,
      action: 'add',
      stepId,
      error: `Step '${stepId}' already exists`,
    }
  }

  // Build step object
  const newStep: Step = {
    id: stepId,
    name: (options.name as string) || stepId,
    type: ((options.type as string) || 'base') as StepType,
    model: ((options.model as string) || 'claude-code') as ModelType,
    prompt_file: (options.prompt as string) || `.threados/prompts/${stepId}.md`,
    depends_on: options['depends-on']
      ? (options['depends-on'] as string).split(',').map(s => s.trim())
      : [],
    status: 'READY' as StepStatus,
    cwd: options.cwd ? (options.cwd as string) : undefined,
  }

  // Validate the step
  const validation = StepSchema.safeParse(newStep)
  if (!validation.success) {
    return {
      success: false,
      action: 'add',
      stepId,
      error: validation.error.issues.map(e => e.message).join(', '),
    }
  }

  sequence.steps.push(validation.data)

  // Validate DAG
  try {
    validateDAG(sequence)
  } catch (error) {
    return {
      success: false,
      action: 'add',
      stepId,
      error: error instanceof Error ? error.message : 'DAG validation failed',
    }
  }

  await writeSequence(basePath, sequence)

  // Create empty prompt file if it doesn't exist
  const promptExists = await validatePromptExists(basePath, stepId)
  if (!promptExists) {
    await writePrompt(basePath, stepId, `# ${newStep.name}\n\n<!-- Add your prompt here -->\n`)
  }

  return {
    success: true,
    action: 'add',
    stepId,
    message: `Step '${stepId}' added successfully`,
  }
}

/**
 * Edit an existing step
 */
async function editStep(
  basePath: string,
  stepId: string,
  options: Record<string, unknown>
): Promise<StepResult> {
  const sequence = await readSequence(basePath)

  const stepIndex = sequence.steps.findIndex(s => s.id === stepId)
  if (stepIndex === -1) {
    return {
      success: false,
      action: 'edit',
      stepId,
      error: new StepNotFoundError(stepId).message,
    }
  }

  const step = sequence.steps[stepIndex]

  // Update fields that were provided
  if (options.name) step.name = options.name as string
  if (options.type) step.type = options.type as StepType
  if (options.model) step.model = options.model as ModelType
  if (options.prompt) step.prompt_file = options.prompt as string
  if (options.status) step.status = options.status as StepStatus
  if (options.cwd) step.cwd = options.cwd as string
  if (options['depends-on']) {
    step.depends_on = (options['depends-on'] as string).split(',').map(s => s.trim())
  }

  // Validate the updated step
  const validation = StepSchema.safeParse(step)
  if (!validation.success) {
    return {
      success: false,
      action: 'edit',
      stepId,
      error: validation.error.issues.map(e => e.message).join(', '),
    }
  }

  sequence.steps[stepIndex] = validation.data

  // Validate DAG
  try {
    validateDAG(sequence)
  } catch (error) {
    return {
      success: false,
      action: 'edit',
      stepId,
      error: error instanceof Error ? error.message : 'DAG validation failed',
    }
  }

  await writeSequence(basePath, sequence)

  return {
    success: true,
    action: 'edit',
    stepId,
    message: `Step '${stepId}' updated successfully`,
  }
}

/**
 * Remove a step
 */
async function removeStep(
  basePath: string,
  stepId: string
): Promise<StepResult> {
  const sequence = await readSequence(basePath)

  const stepIndex = sequence.steps.findIndex(s => s.id === stepId)
  if (stepIndex === -1) {
    return {
      success: false,
      action: 'rm',
      stepId,
      error: new StepNotFoundError(stepId).message,
    }
  }

  // Check if any other steps depend on this one
  const dependents = sequence.steps.filter(s => s.depends_on.includes(stepId))
  if (dependents.length > 0) {
    return {
      success: false,
      action: 'rm',
      stepId,
      error: `Cannot remove: steps [${dependents.map(s => s.id).join(', ')}] depend on '${stepId}'`,
    }
  }

  // Remove the step
  sequence.steps.splice(stepIndex, 1)
  await writeSequence(basePath, sequence)

  // Optionally delete the prompt file
  try {
    await deletePrompt(basePath, stepId)
  } catch {
    // Ignore if prompt file doesn't exist
  }

  return {
    success: true,
    action: 'rm',
    stepId,
    message: `Step '${stepId}' removed successfully`,
  }
}

/**
 * Clone a step
 */
async function cloneStep(
  basePath: string,
  sourceId: string,
  newId: string
): Promise<StepResult> {
  const sequence = await readSequence(basePath)

  const sourceStep = sequence.steps.find(s => s.id === sourceId)
  if (!sourceStep) {
    return {
      success: false,
      action: 'clone',
      stepId: newId,
      error: new StepNotFoundError(sourceId).message,
    }
  }

  // Check if new ID already exists
  if (sequence.steps.some(s => s.id === newId)) {
    return {
      success: false,
      action: 'clone',
      stepId: newId,
      error: `Step '${newId}' already exists`,
    }
  }

  // Clone the step
  const clonedStep: Step = {
    ...sourceStep,
    id: newId,
    name: `${sourceStep.name} (copy)`,
    prompt_file: `.threados/prompts/${newId}.md`,
    status: 'READY',
  }

  const validation = StepSchema.safeParse(clonedStep)
  if (!validation.success) {
    return {
      success: false,
      action: 'clone',
      stepId: newId,
      error: validation.error.issues.map(e => e.message).join(', '),
    }
  }

  const updatedSteps = [...sequence.steps, validation.data]

  try {
    validateDAG({ ...sequence, steps: updatedSteps })
  } catch (error) {
    return {
      success: false,
      action: 'clone',
      stepId: newId,
      error: error instanceof Error ? error.message : 'DAG validation failed',
    }
  }

  sequence.steps = updatedSteps
  await writeSequence(basePath, sequence)

  // Create the prompt file for the clone
  await writePrompt(basePath, newId, `# ${clonedStep.name}\n\n<!-- Add your prompt here -->\n`)

  return {
    success: true,
    action: 'clone',
    stepId: newId,
    message: `Step '${sourceId}' cloned to '${newId}'`,
  }
}

type StepSubHandler = (basePath: string, positionals: string[], values: Record<string, unknown>) => Promise<StepResult>

function requireStepId(action: string, errorMsg: string): (basePath: string, positionals: string[], values: Record<string, unknown>) => Promise<StepResult> {
  return async (basePath, positionals, values) => {
    const stepId = positionals[0]
    if (!stepId) return { success: false, action, stepId: '', error: errorMsg }
    if (action === 'add') return addStep(basePath, stepId, values)
    if (action === 'edit') return editStep(basePath, stepId, values)
    return removeStep(basePath, stepId)
  }
}

const stepSubHandlers: Record<string, StepSubHandler> = {
  add: requireStepId('add', 'Step ID required: seqctl step add <stepId> [options]'),
  edit: requireStepId('edit', 'Step ID required: seqctl step edit <stepId> [options]'),
  rm: requireStepId('rm', 'Step ID required: seqctl step rm <stepId>'),
  clone: async (basePath, positionals) => {
    const sourceId = positionals[0]
    const newId = positionals[1]
    if (!sourceId || !newId) return { success: false, action: 'clone', stepId: '', error: 'Usage: seqctl step clone <sourceId> <newId>' }
    return cloneStep(basePath, sourceId, newId)
  },
}

function outputStepResult(result: StepResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(result.message)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
}

/**
 * Step command handler
 */
export async function stepCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()
  const { values, positionals } = parseStepArgs(args)

  const handler = subcommand ? stepSubHandlers[subcommand] : undefined
  const result = handler
    ? await handler(basePath, positionals, values)
    : { success: false, action: subcommand || 'unknown', stepId: '', error: 'Unknown subcommand. Usage: seqctl step add|edit|rm|clone' }

  outputStepResult(result, options)
}
