import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function appendTraceEvent(
  basePath: string,
  runId: string,
  event: TraceEvent,
): Promise<void> {
  const validated = TraceEventSchema.parse(event)
  const dirPath = join(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'trace.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}
