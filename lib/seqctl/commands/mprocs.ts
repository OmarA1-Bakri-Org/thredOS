import { join } from 'path'
import { RuntimeServiceError } from '../../runtime/errors'
import { writeFileAtomic } from '../../fs/atomic'
import { MprocsClient } from '../../mprocs/client'
import { generateMprocsConfig } from '../../mprocs/config'
import { readMprocsMap } from '../../mprocs/state'
import { readSequence } from '../../sequence/parser'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'

interface CLIMprocsRuntime {
  open(command: string[], cwd: string): void
  select(processIndex: number): Promise<void>
}

declare global {
  var __THREADOS_CLI_MPROCS_RUNTIME__: Partial<CLIMprocsRuntime> | undefined
}

function mprocsRuntime(): CLIMprocsRuntime {
  const injected = globalThis.__THREADOS_CLI_MPROCS_RUNTIME__
  return {
    open: injected?.open ?? ((command, cwd) => {
      const subprocess = Bun.spawn(command, {
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
      })
      if (!subprocess.pid) throw new Error('mprocs did not start')
    }),
    select: injected?.select ?? (async processIndex => {
      await new MprocsClient().sendCommand({ c: 'select-proc', index: processIndex })
    }),
  }
}

async function openObserver(basePath: string): Promise<{ action: 'open'; configPath: string }> {
  const sequence = await readSequence(basePath)
  const configPath = join(basePath, '.threados', 'mprocs.yaml')
  await writeFileAtomic(configPath, generateMprocsConfig(sequence))
  const executable = process.env.THREADOS_MPROCS_PATH || 'mprocs'
  mprocsRuntime().open([executable, '--config', configPath], basePath)
  return { action: 'open', configPath }
}

async function selectObserver(basePath: string, args: string[]): Promise<{ action: 'select'; stepId: string; processIndex: number }> {
  const stepId = args[0]?.trim()
  if (!stepId) throw new RuntimeServiceError('VALIDATION_ERROR', 'Usage: thread mprocs select <stepId>')
  const processIndex = (await readMprocsMap(basePath))[stepId]
  if (processIndex === undefined) {
    throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', `mprocs observer has no process for step ${stepId}`)
  }
  await mprocsRuntime().select(processIndex)
  return { action: 'select', stepId, processIndex }
}

export async function mprocsCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const basePath = options.basePath ?? process.cwd()
    if (subcommand === 'open') {
      const result = await openObserver(basePath)
      renderRuntimeSuccess(result, options, () => console.log(`mprocs launched with ${result.configPath}`))
      return
    }
    if (subcommand === 'select') {
      const result = await selectObserver(basePath, args)
      renderRuntimeSuccess(result, options, () => {
        console.log(`Selected step '${result.stepId}' in mprocs (index ${result.processIndex})`)
      })
      return
    }
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Unknown subcommand. Usage: thread mprocs open|select')
  } catch (error) {
    renderRuntimeFailure({
      code: error instanceof RuntimeServiceError ? error.code : 'MPROCS_OBSERVER_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }, options)
  }
}
