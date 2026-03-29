import { readFile } from 'fs/promises'
import { join } from 'path'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function readTraceEvents(
  basePath: string,
  runId: string,
): Promise<TraceEvent[]> {
  const filePath = join(basePath, RUNS_PATH, runId, 'trace.ndjson')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => TraceEventSchema.parse(JSON.parse(line)))
}
