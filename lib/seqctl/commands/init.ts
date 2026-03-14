import { mkdir, access } from 'fs/promises'
import { join } from 'path'
import { writeSequence } from '../../sequence/parser'
import type { Sequence } from '../../sequence/schema'

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
const SUBDIRS = ['prompts', 'runs', 'state']

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
    await access(join(threadosPath, 'sequence.yaml'))
    const result: InitResult = {
      success: false,
      message: 'ThreadOS already initialized',
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

  // Create directory structure
  await mkdir(threadosPath, { recursive: true })
  for (const subdir of SUBDIRS) {
    await mkdir(join(threadosPath, subdir), { recursive: true })
  }

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
    message: 'ThreadOS initialized successfully',
    path: threadosPath,
  }

  if (options.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(result.message)
    console.log(`Created: ${threadosPath}/`)
    for (const subdir of SUBDIRS) {
      console.log(`  ${subdir}/`)
    }
    console.log('  sequence.yaml')
  }
}
