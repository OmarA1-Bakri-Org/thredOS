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

  const mprocsClient = new MprocsClient()
  const mprocsMap = await readMprocsMap(basePath)
  const processIndex = mprocsMap[stepId]

  let result: { success: boolean; action: string; stepId: string; message?: string; error?: string }

  if (subcommand === 'stop') {
    if (processIndex !== undefined) {
      try { await mprocsClient.stopProcess(processIndex) } catch { /* mprocs may not be running */ }
    }
    step.status = 'FAILED'
    await writeSequence(basePath, sequence)
    result = { success: true, action: 'stop', stepId, message: `Step '${stepId}' stopped` }
  } else if (subcommand === 'restart') {
    if (processIndex !== undefined) {
      try { await mprocsClient.restartProcess(processIndex) } catch { /* mprocs may not be running */ }
    }
    step.status = 'RUNNING'
    await writeSequence(basePath, sequence)
    result = { success: true, action: 'restart', stepId, message: `Step '${stepId}' restarted` }
  } else {
    result = { success: false, action: subcommand || 'unknown', stepId, error: 'Unknown subcommand. Usage: seqctl stop|restart <stepId>' }
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
