import { randomUUID } from 'crypto'
import { access, constants, mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Step } from '../sequence/schema'

interface PreflightProbeOptions {
  home?: string
  which?: (binary: string) => string | null | undefined
}

function runtimePreflightError(message: string): Error {
  return new Error(`Runtime preflight failed: ${message}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureWritableDirectory(path: string, label: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true })
    const probePath = join(path, `.threados-write-probe-${randomUUID()}`)
    await writeFile(probePath, 'ok', 'utf-8')
    await unlink(probePath)
  } catch {
    throw runtimePreflightError(`${label} is not writable: ${path}`)
  }
}

function collectActionTypes(actions: unknown): Set<string> {
  const found = new Set<string>()
  const visit = (candidates: unknown) => {
    if (!Array.isArray(candidates)) return
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue
      const action = candidate as Record<string, unknown>
      const type = action.type === 'rube_tool' ? 'composio_tool' : String(action.type ?? '')
      if (type) found.add(type)
      if (type === 'conditional') {
        const config = (action.config ?? {}) as Record<string, unknown>
        visit(config.if_true)
        visit(config.if_false)
      }
    }
  }

  visit(actions)
  return found
}

async function ensureExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function ensureComposioPreflight(options: PreflightProbeOptions = {}): Promise<void> {
  const home = options.home ?? process.env.HOME ?? ''
  const which = options.which ?? ((binary: string) => Bun.which(binary))
  const commandCandidates = [which('composio'), home ? join(home, '.composio', 'composio') : null].filter((value): value is string => Boolean(value))

  let resolvedCommand: string | null = null
  for (const candidate of commandCandidates) {
    if (await ensureExecutable(candidate)) {
      resolvedCommand = candidate
      break
    }
  }

  if (!resolvedCommand) {
    throw runtimePreflightError('Composio CLI is unavailable (expected on PATH or at ~/.composio/composio)')
  }

  if (process.env.COMPOSIO_API_KEY) {
    return
  }

  const authIndicators = [
    home ? join(home, '.composio', 'user_data.json') : '',
    home ? join(home, '.composio', 'config.json') : '',
  ].filter(Boolean)

  for (const indicator of authIndicators) {
    if (await pathExists(indicator)) {
      return
    }
  }

  throw runtimePreflightError('Composio auth is not configured (set COMPOSIO_API_KEY or initialize ~/.composio)')
}

export async function preflightDispatchEnvironment(cwd: string): Promise<void> {
  await ensureWritableDirectory(join(cwd, '.threados', 'tmp-prompts'), 'prompt temp root')
}

export async function preflightStepEnvironment(
  basePath: string,
  step: Pick<Step, 'actions' | 'cwd'>,
  options: PreflightProbeOptions = {},
): Promise<void> {
  await ensureWritableDirectory(join(basePath, '.threados', 'state'), 'runtime state root')
  await ensureWritableDirectory(join(basePath, '.threados', 'runs'), 'run artifact root')
  await preflightDispatchEnvironment(step.cwd || basePath)

  const actionTypes = collectActionTypes(step.actions)
  if (actionTypes.has('composio_tool')) {
    await ensureComposioPreflight(options)
  }
}
