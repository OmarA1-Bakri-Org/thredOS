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

export async function mprocsCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  let result: { success: boolean; action: string; message?: string; error?: string }

  switch (subcommand) {
    case 'open': {
      const sequence = await readSequence(basePath)
      const configYaml = generateMprocsConfig(sequence)
      const configPath = join(basePath, '.threados/mprocs.yaml')
      await writeFileAtomic(configPath, configYaml)

      // Launch mprocs in background
      const mprocsPath = process.env.THREADOS_MPROCS_PATH || 'mprocs'
      try {
        Bun.spawn([mprocsPath, '--config', configPath], {
          cwd: basePath,
          stdio: ['inherit', 'inherit', 'inherit'],
        })
      } catch {
        // mprocs may not be installed
      }

      result = { success: true, action: 'open', message: `mprocs config written to ${configPath} and launched` }
      break
    }

    case 'select': {
      const stepId = args[0]
      if (!stepId) {
        result = { success: false, action: 'select', error: 'Usage: seqctl mprocs select <stepId>' }
        break
      }
      const mprocsMap = await readMprocsMap(basePath)
      const processIndex = mprocsMap[stepId]
      if (processIndex === undefined) {
        result = { success: false, action: 'select', error: new StepNotFoundError(stepId).message }
        break
      }
      const client = new MprocsClient()
      await client.sendCommand({ c: 'select-proc', index: processIndex })
      result = { success: true, action: 'select', message: `Selected step '${stepId}' in mprocs (index ${processIndex})` }
      break
    }

    default:
      result = { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl mprocs open|select' }
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
