import { join } from 'path'
import { readSequence } from '../../sequence/parser'
import { generateMprocsConfig } from '../../mprocs/config'
import { readMprocsMap } from '../../mprocs/state'
import { MprocsClient } from '../../mprocs/client'
import { writeFileAtomic } from '../../fs/atomic'
import { StepNotFoundError } from '../../errors'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

type MprocsResult = { success: boolean; action: string; message?: string; error?: string }

async function handleMprocsOpen(basePath: string, _args: string[]): Promise<MprocsResult> {
  const sequence = await readSequence(basePath)
  const configYaml = generateMprocsConfig(sequence)
  const configPath = join(basePath, '.threados/mprocs.yaml')
  await writeFileAtomic(configPath, configYaml)

  const mprocsPath = process.env.THREADOS_MPROCS_PATH || 'mprocs'
  try {
    Bun.spawn([mprocsPath, '--config', configPath], {
      cwd: basePath,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
  } catch {
    // mprocs may not be installed
  }

  return { success: true, action: 'open', message: `mprocs config written to ${configPath} and launched` }
}

async function handleMprocsSelect(basePath: string, args: string[]): Promise<MprocsResult> {
  const stepId = args[0]
  if (!stepId) return { success: false, action: 'select', error: 'Usage: seqctl mprocs select <stepId>' }

  const mprocsMap = await readMprocsMap(basePath)
  const processIndex = mprocsMap[stepId]
  if (processIndex === undefined) {
    return { success: false, action: 'select', error: new StepNotFoundError(stepId).message }
  }

  const client = new MprocsClient()
  await client.sendCommand({ c: 'select-proc', index: processIndex })
  return { success: true, action: 'select', message: `Selected step '${stepId}' in mprocs (index ${processIndex})` }
}

type MprocsHandler = (basePath: string, args: string[]) => Promise<MprocsResult>

const mprocsHandlers: Record<string, MprocsHandler> = {
  open: handleMprocsOpen,
  select: handleMprocsSelect,
}

function outputMprocsResult(result: MprocsResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(result.message)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
}

export async function mprocsCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  const handler = subcommand ? mprocsHandlers[subcommand] : undefined
  const result = handler
    ? await handler(basePath, args)
    : { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl mprocs open|select' }

  outputMprocsResult(result, options)
}
