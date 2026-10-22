import { mkdir } from 'fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'path'
import { z } from 'zod'
import { getRuntimeEventLogPath } from '../runner/artifacts'
import { appendFileNoFollow, readTextFileNoFollow } from '../security/safe-io'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'

const SpawnKindSchema = z.enum(['orchestrator', 'watchdog', 'fanout'])
const MergeKindSchema = z.enum(['single', 'block'])

const ThreadTypeSchema = z.enum(['base', 'parallel', 'chained', 'fusion', 'orchestrated', 'long-autonomy'])

const SpawnChildEventSchema = z.object({
  eventType: z.literal('spawn-child'),
  createdAt: z.string(),
  childStepId: z.string().min(1),
  childLabel: z.string().min(1),
  spawnKind: SpawnKindSchema,
  parentStepId: z.string().min(1).optional(),
  threadType: ThreadTypeSchema.optional(),
})

const MergeIntoEventSchema = z.object({
  eventType: z.literal('merge-into'),
  createdAt: z.string(),
  destinationStepId: z.string().min(1),
  sourceStepIds: z.array(z.string().min(1)).min(1),
  mergeKind: MergeKindSchema,
  summary: z.string().min(1).optional(),
})

const RuntimeDelegationEventSchema = z.discriminatedUnion('eventType', [
  SpawnChildEventSchema,
  MergeIntoEventSchema,
])

export type RuntimeDelegationEvent = z.infer<typeof RuntimeDelegationEventSchema>

export interface RuntimeEventLogReadResult {
  events: RuntimeDelegationEvent[]
  invalidLines: number
}

export async function readRuntimeEventLog(
  basePath: string,
  runId: string,
  stepId: string,
): Promise<RuntimeEventLogReadResult> {
  const logPath = getRuntimeEventLogPath(basePath, runId, stepId)
  return await readRuntimeEventLogAtPath(logPath, basePath)
}

async function readContainedEventLog(logPath: string, executionRoot: string): Promise<string> {
  const child = relative(resolve(executionRoot), resolve(logPath))
  const segments = child.split(sep)
  try {
    await resolvePathWithinRoot(executionRoot, ...segments)
    const containedPath = await resolveExistingPathWithinRoot(executionRoot, ...segments)
    return await readTextFileNoFollow(containedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function readRuntimeEventLogAtPath(
  logPath: string,
  executionRoot: string,
): Promise<RuntimeEventLogReadResult> {
  const content = await readContainedEventLog(logPath, executionRoot)

  if (!content.trim()) {
    return { events: [], invalidLines: 0 }
  }

  const events: RuntimeDelegationEvent[] = []
  let invalidLines = 0
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed)
      const result = RuntimeDelegationEventSchema.safeParse(parsed)
      if (result.success) {
        events.push(result.data)
      } else {
        invalidLines += 1
        console.warn(`[runtime-event-log] Invalid event at line ${i + 1}`)
      }
    } catch {
      invalidLines += 1
      console.warn(`[runtime-event-log] Malformed JSON at line ${i + 1}`)
    }
  }

  return { events, invalidLines }
}

export async function appendRuntimeEventAtPath(
  logPath: string,
  event: RuntimeDelegationEvent,
  allowedRoot: string,
): Promise<void> {
  const child = relative(resolve(allowedRoot), resolve(logPath))
  if (child === '' || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
    throw new Error('Runtime event log must remain within the execution root')
  }
  const segments = child.split(sep)
  const fileName = segments.pop()
  if (!fileName || fileName !== basename(logPath)) {
    throw new Error('Runtime event log path is invalid')
  }
  const safeParent = await resolvePathWithinRoot(allowedRoot, ...segments)
  await mkdir(safeParent, { recursive: true })
  const parent = await resolveExistingPathWithinRoot(allowedRoot, ...segments)
  const verifiedPath = await resolvePathWithinRoot(parent, fileName)
  await appendFileNoFollow(verifiedPath, `${JSON.stringify(event)}\n`)
}

export async function appendRuntimeEvent(
  basePath: string,
  runId: string,
  stepId: string,
  event: RuntimeDelegationEvent,
): Promise<void> {
  const logPath = getRuntimeEventLogPath(basePath, runId, stepId)
  await appendRuntimeEventAtPath(logPath, event, basePath)
}

export {
  getRuntimeEventLogPath,
  MergeKindSchema,
  RuntimeDelegationEventSchema,
  SpawnKindSchema,
}
