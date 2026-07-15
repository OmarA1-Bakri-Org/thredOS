import { appendFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { GateDecisionSchema, type GateDecision } from '@/lib/contracts/schemas'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'

const RUNS_PATH = '.threados/runs'

export async function appendGateDecision(basePath: string, runId: string, decision: GateDecision): Promise<void> {
  assertSafePathSegment(runId, 'run id')
  const validated = GateDecisionSchema.parse(decision)
  const dirPath = await resolvePathWithinRoot(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'gate-decisions.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}

export async function readGateDecisions(basePath: string, runId: string): Promise<GateDecision[]> {
  assertSafePathSegment(runId, 'run id')
  let filePath: string
  let content: string
  try {
    filePath = await resolveExistingPathWithinRoot(basePath, RUNS_PATH, runId, 'gate-decisions.ndjson')
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => GateDecisionSchema.parse(JSON.parse(line)))
}
