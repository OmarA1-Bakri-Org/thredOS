import { mkdir } from 'fs/promises'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { appendFileNoFollow } from '@/lib/security/safe-io'

export async function appendTraceEvent(
  basePath: string,
  runId: string,
  event: TraceEvent,
): Promise<void> {
  assertSafePathSegment(runId, 'run id')
  const validated = TraceEventSchema.parse(event)
  if (validated.run_id !== runId) {
    throw new Error('Trace event run_id must match the target run id')
  }
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const runsRoot = await resolvePathWithinRoot(threadosRoot, 'runs')
  await mkdir(runsRoot, { recursive: true })
  const verifiedRunsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
  const dirPath = await resolvePathWithinRoot(verifiedRunsRoot, runId)
  await mkdir(dirPath, { recursive: true })
  const verifiedRunDir = await resolveExistingPathWithinRoot(verifiedRunsRoot, runId)
  const filePath = await resolvePathWithinRoot(verifiedRunDir, 'trace.ndjson')
  await appendFileNoFollow(filePath, JSON.stringify(validated) + '\n')
}
