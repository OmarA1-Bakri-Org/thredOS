import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { AgentNotFoundError } from '../errors'
import type { RunnerConfig } from './wrapper'
import type { ModelType } from '../sequence/schema'

export interface DispatchOptions {
  stepId: string
  runId: string
  compiledPrompt: string
  cwd: string
  timeout: number
  env?: Record<string, string>
}

/**
 * Agent dispatcher definition.
 * Each model type gets a dispatcher that knows how to invoke its CLI.
 */
interface AgentDispatcher {
  /** The shell command name for availability check */
  binary: string
  /** Human-readable install hint */
  installHint: string
  /** Build the RunnerConfig for this agent */
  buildConfig(opts: DispatchOptions, promptFilePath: string): RunnerConfig
}

/**
 * Write the compiled prompt to a temp file for the agent to read.
 * Returns the path to the temp file.
 */
async function writeTempPrompt(compiledPrompt: string, stepId: string): Promise<string> {
  const fileName = `threados-prompt-${stepId}-${randomUUID().slice(0, 8)}.md`
  const filePath = join(tmpdir(), fileName)
  await writeFile(filePath, compiledPrompt, 'utf-8')
  return filePath
}

/**
 * Dispatcher registry \u2014 maps model names to their CLI invocations.
 */
const dispatchers: Record<string, AgentDispatcher> = {
  'claude-code': {
    binary: 'claude',
    installHint: 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
    buildConfig(opts, promptFilePath) {
      return {
        stepId: opts.stepId,
        runId: opts.runId,
        command: 'claude',
        args: [
          '-p',
          `Execute the task described in ${promptFilePath}. Read the file first, then follow all instructions.`,
          '--output-format', 'json',
          '--max-turns', '100',
        ],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          ...opts.env,
          THREADOS_STEP_ID: opts.stepId,
          THREADOS_RUN_ID: opts.runId,
          THREADOS_PROMPT_FILE: promptFilePath,
        },
      }
    },
  },

  codex: {
    binary: 'codex',
    installHint: 'Install Codex CLI: npm install -g @openai/codex',
    buildConfig(opts, promptFilePath) {
      return {
        stepId: opts.stepId,
        runId: opts.runId,
        command: 'codex',
        args: [
          '-q',
          `Execute the task described in ${promptFilePath}. Read the file first, then follow all instructions.`,
          '--full-auto',
        ],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          ...opts.env,
          THREADOS_STEP_ID: opts.stepId,
          THREADOS_RUN_ID: opts.runId,
        },
      }
    },
  },

  gemini: {
    binary: 'gemini',
    installHint: 'Install Gemini CLI: npm install -g @google/gemini-cli',
    buildConfig(opts, promptFilePath) {
      return {
        stepId: opts.stepId,
        runId: opts.runId,
        command: 'gemini',
        args: [
          '-p',
          `Execute the task described in ${promptFilePath}. Read the file first, then follow all instructions.`,
        ],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          ...opts.env,
          THREADOS_STEP_ID: opts.stepId,
          THREADOS_RUN_ID: opts.runId,
        },
      }
    },
  },

  shell: {
    binary: 'sh',
    installHint: 'sh should be available on all Unix systems',
    buildConfig(opts, promptFilePath) {
      // For shell steps, the prompt content IS the command to execute
      return {
        stepId: opts.stepId,
        runId: opts.runId,
        command: 'sh',
        args: [promptFilePath],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          ...opts.env,
          THREADOS_STEP_ID: opts.stepId,
          THREADOS_RUN_ID: opts.runId,
        },
      }
    },
  },
}

/**
 * Check if an agent's CLI binary is available on PATH.
 */
export async function checkAgentAvailable(model: ModelType): Promise<boolean> {
  const dispatcher = dispatchers[model]
  if (!dispatcher) return false

  // Shell is always available
  if (model === 'shell') return true

  try {
    const isWindows = process.platform === 'win32'
    const checkCmd = isWindows ? 'where' : 'which'
    const proc = Bun.spawn([checkCmd, dispatcher.binary], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Dispatch a step to its agent.
 *
 * 1. Writes compiled prompt to temp file
 * 2. Resolves the dispatcher for the model
 * 3. Checks agent availability
 * 4. Returns a RunnerConfig ready for the existing runner
 *
 * @throws AgentNotFoundError if the model's CLI is not on PATH
 */
export async function dispatch(
  model: ModelType,
  opts: DispatchOptions
): Promise<RunnerConfig> {
  const dispatcher = dispatchers[model]
  if (!dispatcher) {
    throw new AgentNotFoundError(model)
  }

  // Check availability
  const available = await checkAgentAvailable(model)
  if (!available) {
    throw new AgentNotFoundError(model, dispatcher.installHint)
  }

  // Write prompt to temp file
  const promptFilePath = await writeTempPrompt(opts.compiledPrompt, opts.stepId)

  // Build the runner config
  return dispatcher.buildConfig(opts, promptFilePath)
}

/**
 * Get the list of supported model types.
 */
export function getSupportedModels(): string[] {
  return Object.keys(dispatchers)
}

/**
 * Map exit codes to step status hints.
 */
export function exitCodeToStatus(code: number | null): 'DONE' | 'FAILED' | 'NEEDS_REVIEW' {
  if (code === 0) return 'DONE'
  if (code === 42) return 'NEEDS_REVIEW'
  return 'FAILED'
}
