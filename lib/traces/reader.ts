import { readFile } from 'fs/promises'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '@/lib/security/safe-path'

const RUNS_PATH = '.threados/runs'

export async function readTraceEvents(
  basePath: string,
  runId: string,
): Promise<TraceEvent[]> {
  assertSafePathSegment(runId, 'run id')
  let filePath: string
  let content: string
  try {
    filePath = await resolveExistingPathWithinRoot(basePath, RUNS_PATH, runId, 'trace.ndjson')
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => TraceEventSchema.parse(JSON.parse(line)))
}
