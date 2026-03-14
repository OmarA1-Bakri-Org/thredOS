import YAML from 'yaml'
import type { Sequence, Step } from '../sequence/schema'

interface MprocsProcessConfig {
  name: string
  cmd: string[]
  cwd?: string
  autostart?: boolean
}

interface MprocsConfig {
  server?: {
    host: string
    port: number
  }
  procs: Record<string, MprocsProcessConfig>
}

const DEFAULT_SERVER_HOST = '127.0.0.1'
const DEFAULT_SERVER_PORT = 4050

/** Model-to-CLI mapping for known model types. */
const MODEL_COMMAND_MAP: Record<string, (step: Step) => string[]> = {
  'claude-code': (step) => ['claude', '--prompt-file', step.prompt_file],
  'codex': (step) => ['codex', '--prompt-file', step.prompt_file],
  'gemini': (step) => ['gemini', '--prompt-file', step.prompt_file],
}

/**
 * Generate a command array for a step based on its model type
 */
function generateStepCommand(step: Step): string[] {
  const commandBuilder = MODEL_COMMAND_MAP[step.model]
  return commandBuilder ? commandBuilder(step) : ['echo', `Running step: ${step.id}`]
}

interface MprocsOptions {
  serverHost?: string
  serverPort?: number
  autostart?: boolean
}

function buildProcs(steps: Step[], commandFn: (step: Step) => string[], autostart: boolean): Record<string, MprocsProcessConfig> {
  const procs: Record<string, MprocsProcessConfig> = {}
  for (const step of steps) {
    procs[step.id] = {
      name: step.name,
      cmd: commandFn(step),
      ...(step.cwd && { cwd: step.cwd }),
      autostart,
    }
  }
  return procs
}

function resolveOptions(options?: MprocsOptions) {
  return {
    serverHost: options?.serverHost ?? DEFAULT_SERVER_HOST,
    serverPort: options?.serverPort ?? DEFAULT_SERVER_PORT,
    autostart: options?.autostart ?? false,
  }
}

/**
 * Generate mprocs.yaml configuration from a sequence
 *
 * @param sequence - The sequence to generate configuration for
 * @param options - Optional configuration options
 * @returns The mprocs configuration as a YAML string
 */
export function generateMprocsConfig(
  sequence: Sequence,
  options?: MprocsOptions,
): string {
  const { serverHost, serverPort, autostart } = resolveOptions(options)
  const config: MprocsConfig = {
    server: { host: serverHost, port: serverPort },
    procs: buildProcs(sequence.steps, generateStepCommand, autostart),
  }
  return YAML.stringify(config, { indent: 2 })
}

/**
 * Generate mprocs configuration object (not YAML string)
 *
 * @param sequence - The sequence to generate configuration for
 * @param options - Optional configuration options
 * @returns The mprocs configuration object
 */
export function generateMprocsConfigObject(
  sequence: Sequence,
  options?: MprocsOptions,
): MprocsConfig {
  const { serverHost, serverPort, autostart } = resolveOptions(options)
  return {
    server: { host: serverHost, port: serverPort },
    procs: buildProcs(sequence.steps, generateStepCommand, autostart),
  }
}
