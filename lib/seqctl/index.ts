#!/usr/bin/env bun
import { ZodError } from 'zod'
import { initCommand } from './commands/init'
import { runCommand } from './commands/run'
import { statusCommand } from './commands/status'
import { stepCommand } from './commands/step'
import { depCommand } from './commands/dep'
import { groupCommand } from './commands/group'
import { fusionCommand } from './commands/fusion'
import { gateCommand } from './commands/gate'
import { controlCommand } from './commands/control'
import { mprocsCommand } from './commands/mprocs'
import { templateCommand } from './commands/template'
import { eventCommand } from './commands/event'

// Explicit CLI options interface
interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
}

// Command handler type
type CommandHandler = (
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
) => Promise<void>

const commands: Record<string, CommandHandler> = {
  init: initCommand,
  step: stepCommand,
  run: runCommand,
  status: statusCommand,
  dep: depCommand,
  group: groupCommand,
  fusion: fusionCommand,
  gate: gateCommand,
  stop: (sub, args, opts) => controlCommand('stop', sub ? [sub, ...args] : args, opts),
  restart: (sub, args, opts) => controlCommand('restart', sub ? [sub, ...args] : args, opts),
  mprocs: mprocsCommand,
  template: templateCommand,
  event: eventCommand,
}

// Error formatting utility
function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function main() {
  const rawArgs = Bun.argv.slice(2)

  // Extract global flags manually so subcommand flags pass through untouched
  const options: CLIOptions = { json: false, help: false, watch: false }
  const remaining: string[] = []

  for (const arg of rawArgs) {
    if (arg === '--json' || arg === '-j') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--watch' || arg === '-w') options.watch = true
    else remaining.push(arg)
  }

  const [command, subcommand, ...args] = remaining

  if (options.help || !command) {
    console.log(`
thread - ThreadOS Sequence Controller

Usage:
  thread <command> [subcommand] [options]

Commands:
  init                        Initialize .threados/ directory
  step add|edit|rm|clone      Manage steps
  run step|runnable|group     Execute steps
  status [--watch]            Show sequence status
  dep add|rm                  Manage step dependencies
  group parallelize|list      Manage parallel groups
  fusion create               Create fusion (candidate+synth) steps
  gate insert|approve|block|list  Manage gates
  stop <stepId>               Stop a running step
  restart <stepId>            Restart a step
  mprocs open|select          Manage mprocs sessions
  template apply <type>       Apply a thread template
  event spawn-child|merge-into  Emit runtime delegation events
    Types: base, parallel, chained, fusion, orchestrated, long-autonomy

Options:
  -j, --json              Output as JSON
  -h, --help              Show help
  -w, --watch             Watch for changes (status only)
`)
    process.exit(0)
  }

  const handler = commands[command]
  if (!handler) {
    const errorMsg = `Unknown command: ${command}`
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg, success: false }))
    } else {
      console.error(errorMsg)
    }
    process.exit(1)
  }

  try {
    await handler(subcommand, args, options)
  } catch (error) {
    const message = formatError(error)
    if (options.json) {
      console.log(JSON.stringify({ error: message, success: false }))
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }
}

main()
