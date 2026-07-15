import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import { readTextFileNoFollow } from '@/lib/security/safe-io'

export async function readTraceEvents(
  basePath: string,
  runId: string,
): Promise<TraceEvent[]> {
  assertSafePathSegment(runId, 'run id')
  let filePath: string
  let content: string
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    filePath = await resolveExistingPathWithinRoot(runsRoot, runId, 'trace.ndjson')
    content = await readTextFileNoFollow(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => TraceEventSchema.parse(JSON.parse(line)))
}
