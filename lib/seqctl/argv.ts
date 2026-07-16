import { RuntimeServiceError } from '../runtime/errors'
import type { CLIOptions } from './formatters/runtime'

export interface ParsedCLIArguments {
  command: string | undefined
  subcommand: string | undefined
  args: string[]
  options: CLIOptions
}

const BOOLEAN_FLAGS: Record<string, keyof Pick<CLIOptions, 'json' | 'help' | 'watch' | 'policyConfirmed'>> = {
  '--json': 'json',
  '-j': 'json',
  '--help': 'help',
  '-h': 'help',
  '--watch': 'watch',
  '-w': 'watch',
  '--confirm': 'policyConfirmed',
}

export function parseCLIArguments(rawArgs: string[]): ParsedCLIArguments {
  const options: CLIOptions = {
    json: false,
    help: false,
    watch: false,
    policyConfirmed: false,
  }
  const remaining: string[] = []

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    const flag = BOOLEAN_FLAGS[argument]
    if (flag) {
      options[flag] = true
      continue
    }
    if (argument === '--idempotency-key') {
      const value = rawArgs[index + 1]
      if (value === undefined || value.startsWith('-') || value.trim().length === 0) {
        throw new RuntimeServiceError('VALIDATION_ERROR', 'Idempotency key value required')
      }
      options.idempotencyKey = value
      index += 1
      continue
    }
    if (argument.startsWith('--idempotency-key=')) {
      const value = argument.slice('--idempotency-key='.length)
      if (value.trim().length === 0) {
        throw new RuntimeServiceError('VALIDATION_ERROR', 'Idempotency key value required')
      }
      options.idempotencyKey = value
      continue
    }
    remaining.push(argument)
  }

  const [command, subcommand, ...args] = remaining
  return { command, subcommand, args, options }
}
