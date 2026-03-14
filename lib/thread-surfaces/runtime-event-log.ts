import { readFile, appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod'
import { getRuntimeEventLogPath } from '../runner/artifacts'

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
  const content = await readFile(logPath, 'utf-8').catch(() => '')

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
        const preview = trimmed.length > 100 ? trimmed.slice(0, 100) + '...' : trimmed
        console.warn(`[runtime-event-log] Invalid event at line ${i + 1}: ${preview}`)
      }
    } catch {
      invalidLines += 1
      const preview = trimmed.length > 100 ? trimmed.slice(0, 100) + '...' : trimmed
      console.warn(`[runtime-event-log] Malformed JSON at line ${i + 1}: ${preview}`)
    }
  }

  return { events, invalidLines }
}

export async function appendRuntimeEventAtPath(
  logPath: string,
  event: RuntimeDelegationEvent,
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf-8')
}

export async function appendRuntimeEvent(
  basePath: string,
  runId: string,
  stepId: string,
  event: RuntimeDelegationEvent,
): Promise<void> {
  const logPath = getRuntimeEventLogPath(basePath, runId, stepId)
  await appendRuntimeEventAtPath(logPath, event)
}

export {
  getRuntimeEventLogPath,
  MergeKindSchema,
  RuntimeDelegationEventSchema,
  SpawnKindSchema,
}
