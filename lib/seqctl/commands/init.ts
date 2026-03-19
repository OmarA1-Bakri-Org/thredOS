import { join } from 'path'
import { writeSequence } from '../../sequence/parser'
import type { Sequence } from '../../sequence/schema'
import { ensureLibraryStructure } from '@/lib/library/repository'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

interface InitResult {
  success: boolean
  message: string
  path: string
}

const THREADOS_DIR = '.threados'

/**
 * Initialize the .threados/ directory structure
 */
export async function initCommand(
  _subcommand: string | undefined,
  _args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()
  const threadosPath = join(basePath, THREADOS_DIR)

  // Check if already initialized
  try {
    const { access } = await import('fs/promises')
    await access(join(threadosPath, 'sequence.yaml'))
    const result: InitResult = {
      success: false,
      message: 'thredOS already initialized',
      path: threadosPath,
    }
    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(result.message)
    }
    return
  } catch {
    // Not initialized, proceed
  }

  await ensureLibraryStructure(basePath)

  // Create default sequence.yaml
  const defaultSequence: Sequence = {
    version: '1.0',
    name: 'New Sequence',
    steps: [],
    gates: [],
  }

  await writeSequence(basePath, defaultSequence)

  const result: InitResult = {
    success: true,
    message: 'thredOS initialized successfully',
    path: threadosPath,
  }

  if (options.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(result.message)
    console.log(`Created: ${threadosPath}/`)
    console.log('  prompts/')
    console.log('  skills/')
    console.log('  agents/')
    console.log('  state/')
    console.log('  sequence.yaml')
    console.log('  library.yaml')
  }
}
