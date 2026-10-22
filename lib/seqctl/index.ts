#!/usr/bin/env bun
import { parseCLIArguments } from './argv'
import { RuntimeServiceError } from '../runtime/errors'
import { attemptCommand } from './commands/attempt'
import { controlCommand } from './commands/control'
import { depCommand } from './commands/dep'
import { eventCommand } from './commands/event'
import { fusionCommand } from './commands/fusion'
import { gateCommand } from './commands/gate'
import { groupCommand } from './commands/group'
import { initCommand } from './commands/init'
import { mprocsCommand } from './commands/mprocs'
import { runCommand } from './commands/run'
import { statusCommand } from './commands/status'
import { stepCommand } from './commands/step'
import { templateCommand } from './commands/template'
import { workspaceCommand } from './commands/workspace'
import { renderRuntimeFailure, type CLIOptions } from './formatters/runtime'

type CommandHandler = (
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
) => Promise<void>

const commands: Record<string, CommandHandler> = {
  init: initCommand,
  step: stepCommand,
  run: runCommand,
  attempt: attemptCommand,
  status: statusCommand,
  dep: depCommand,
  group: groupCommand,
  fusion: fusionCommand,
  gate: gateCommand,
  stop: (subcommand, args, options) => controlCommand('stop', subcommand ? [subcommand, ...args] : args, options),
  restart: (subcommand, args, options) => controlCommand('restart', subcommand ? [subcommand, ...args] : args, options),
  mprocs: mprocsCommand,
  template: templateCommand,
  event: eventCommand,
  workspace: workspaceCommand,
}

function printHelp(): void {
  console.log(`
thread - thredOS Sequence Controller

Usage:
  thread <command> [subcommand] [options]

Commands:
  init                              Initialize .threados/ directory
  step add|edit|rm|clone            Manage steps
  run step|runnable|group           Execute through the sequential runtime
  run list|inspect|cancel           Inspect and control canonical runs
  attempt inspect|cancel|retry      Inspect and control canonical attempts
  status [--watch]                  Show canonical runtime status
  dep add|rm                        Manage step dependencies
  group parallelize|list            Manage groups (execution remains sequential before M3)
  fusion create                     Create fusion (candidate+synth) steps
  gate insert|approve|block|list    Manage gates
  stop <stepId>                     Cancel the latest running attempt
  restart <stepId>                  Retry the latest terminal attempt
  mprocs open|select                Optional legacy observer controls
  template apply <type>             Apply a thread template
  event spawn-child|merge-into      Emit runtime delegation events
  workspace list|inspect            Inspect Surface Workspaces
  workspace retain|clean|doctor     Manage retained Surface Workspaces

Options:
  -j, --json                        Emit the versioned JSON envelope
  -h, --help                        Show help
  -w, --watch                       Watch status (JSON is compact NDJSON)
      --idempotency-key <key>       Replay-safe key for runtime mutations
      --confirm                     Confirm the exact executable policy subject
`)
}

export async function main(rawArgs = Bun.argv.slice(2)): Promise<void> {
  let json = rawArgs.includes('--json') || rawArgs.includes('-j')
  try {
    const parsed = parseCLIArguments(rawArgs)
    json = parsed.options.json
    if (parsed.options.help || !parsed.command) {
      printHelp()
      process.exitCode = 0
      return
    }
    const handler = commands[parsed.command]
    if (!handler) throw new RuntimeServiceError('VALIDATION_ERROR', `Unknown command: ${parsed.command}`)
    await handler(parsed.subcommand, parsed.args, parsed.options)
  } catch (error) {
    renderRuntimeFailure(error, { json, help: false, watch: false })
  }
}

if (import.meta.main) {
  void main()
}
