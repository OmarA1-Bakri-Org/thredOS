import { readSequence, writeSequence } from '../../sequence/parser'
import { MprocsClient } from '../../mprocs/client'
import { readMprocsMap } from '../../mprocs/state'
import { StepNotFoundError } from '../../errors'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

type ControlResult = { success: boolean; action: string; stepId: string; message?: string; error?: string }

interface ControlContext {
  mprocsClient: MprocsClient
  processIndex: number | undefined
  step: import('../../sequence/schema').Step
  stepId: string
  basePath: string
  sequence: import('../../sequence/schema').Sequence
}

async function handleStop(ctx: ControlContext): Promise<ControlResult> {
  if (ctx.processIndex !== undefined) {
    try { await ctx.mprocsClient.stopProcess(ctx.processIndex) } catch { /* mprocs may not be running */ }
  }
  ctx.step.status = 'FAILED'
  await writeSequence(ctx.basePath, ctx.sequence)
  return { success: true, action: 'stop', stepId: ctx.stepId, message: `Step '${ctx.stepId}' stopped` }
}

async function handleRestart(ctx: ControlContext): Promise<ControlResult> {
  if (ctx.processIndex !== undefined) {
    try { await ctx.mprocsClient.restartProcess(ctx.processIndex) } catch { /* mprocs may not be running */ }
  }
  ctx.step.status = 'RUNNING'
  await writeSequence(ctx.basePath, ctx.sequence)
  return { success: true, action: 'restart', stepId: ctx.stepId, message: `Step '${ctx.stepId}' restarted` }
}

type ControlHandler = (ctx: ControlContext) => Promise<ControlResult>

const controlHandlers: Record<string, ControlHandler> = {
  stop: handleStop,
  restart: handleRestart,
}

function outputControlResult(result: ControlResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(result.message)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
}

export async function controlCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()
  const stepId = args[0]

  if (!stepId) {
    const error = `Usage: seqctl ${subcommand} <stepId>`
    if (options.json) { console.log(JSON.stringify({ success: false, error })); } else { console.error(error); }
    process.exit(1)
  }

  const sequence = await readSequence(basePath)
  const step = sequence.steps.find(s => s.id === stepId)
  if (!step) {
    const error = new StepNotFoundError(stepId).message
    if (options.json) { console.log(JSON.stringify({ success: false, error })); } else { console.error(error); }
    process.exit(1)
  }

  const handler = subcommand ? controlHandlers[subcommand] : undefined
  if (!handler) {
    const result: ControlResult = { success: false, action: subcommand || 'unknown', stepId, error: 'Unknown subcommand. Usage: seqctl stop|restart <stepId>' }
    outputControlResult(result, options)
    return
  }

  const mprocsClient = new MprocsClient()
  const mprocsMap = await readMprocsMap(basePath)
  const processIndex = mprocsMap[stepId]
  const result = await handler({ mprocsClient, processIndex, step, stepId, basePath, sequence })
  outputControlResult(result, options)
}
