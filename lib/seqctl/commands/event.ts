import { z } from 'zod'
import {
  appendRuntimeEventAtPath,
  MergeKindSchema,
  SpawnKindSchema,
} from '../../thread-surfaces/runtime-event-log'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
}

const SpawnChildArgsSchema = z.object({
  childStepId: z.string().min(1),
  childLabel: z.string().min(1),
  spawnKind: SpawnKindSchema,
  parentStepId: z.string().min(1).optional(),
})

const MergeIntoArgsSchema = z.object({
  destinationStepId: z.string().min(1),
  sourceStepIds: z.array(z.string().min(1)).min(1),
  mergeKind: MergeKindSchema,
  summary: z.string().min(1).optional(),
})

function parseFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1 || index === args.length - 1) return undefined
  return args[index + 1]
}

function requireEventLogPath(): string {
  const logPath = process.env.THREADOS_EVENT_LOG
  if (!logPath) {
    throw new Error('THREADOS_EVENT_LOG is required')
  }
  return logPath
}

function emitResult(options: CLIOptions, payload: object): void {
  if (options.json) {
    console.log(JSON.stringify(payload))
  }
}

async function handleSpawnChild(args: string[], options: CLIOptions): Promise<void> {
  const childStepId = args[0]
  const childLabel = parseFlagValue(args, '--label')
  const spawnKind = parseFlagValue(args, '--kind')
  const parentStepId = parseFlagValue(args, '--parent-step-id')

  const parsed = SpawnChildArgsSchema.parse({
    childStepId,
    childLabel,
    spawnKind,
    parentStepId,
  })

  await appendRuntimeEventAtPath(requireEventLogPath(), {
    eventType: 'spawn-child',
    createdAt: new Date().toISOString(),
    childStepId: parsed.childStepId,
    childLabel: parsed.childLabel,
    spawnKind: parsed.spawnKind,
    ...(parsed.parentStepId ? { parentStepId: parsed.parentStepId } : {}),
  })

  emitResult(options, {
    success: true,
    eventType: 'spawn-child',
    childStepId: parsed.childStepId,
  })
}

async function handleMergeInto(args: string[], options: CLIOptions): Promise<void> {
  const destinationStepId = args[0]
  const sourcesArg = parseFlagValue(args, '--sources')
  const mergeKind = parseFlagValue(args, '--kind')
  const summary = parseFlagValue(args, '--summary')

  const parsed = MergeIntoArgsSchema.parse({
    destinationStepId,
    sourceStepIds: sourcesArg?.split(',').map(value => value.trim()).filter(Boolean) ?? [],
    mergeKind,
    summary,
  })

  await appendRuntimeEventAtPath(requireEventLogPath(), {
    eventType: 'merge-into',
    createdAt: new Date().toISOString(),
    destinationStepId: parsed.destinationStepId,
    sourceStepIds: parsed.sourceStepIds,
    mergeKind: parsed.mergeKind,
    ...(parsed.summary ? { summary: parsed.summary } : {}),
  })

  emitResult(options, {
    success: true,
    eventType: 'merge-into',
    destinationStepId: parsed.destinationStepId,
  })
}

export async function eventCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  switch (subcommand) {
    case 'spawn-child':
      await handleSpawnChild(args, options)
      return
    case 'merge-into':
      await handleMergeInto(args, options)
      return
    default:
      throw new Error(`Unknown event subcommand: ${subcommand ?? '(missing)'}`)
  }
}
