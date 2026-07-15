import { mkdir } from 'fs/promises'
import { GateDecisionSchema, type GateDecision } from '@/lib/contracts/schemas'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { appendFileNoFollow, readTextFileNoFollow } from '@/lib/security/safe-io'

async function ensureRunsRoot(basePath: string): Promise<string> {
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const runsRoot = await resolvePathWithinRoot(threadosRoot, 'runs')
  await mkdir(runsRoot, { recursive: true })
  return await resolveExistingPathWithinRoot(threadosRoot, 'runs')
}

export async function appendGateDecision(basePath: string, runId: string, decision: GateDecision): Promise<void> {
  assertSafePathSegment(runId, 'run id')
  const validated = GateDecisionSchema.parse(decision)
  const runsRoot = await ensureRunsRoot(basePath)
  const dirPath = await resolvePathWithinRoot(runsRoot, runId)
  await mkdir(dirPath, { recursive: true })
  const verifiedRunDir = await resolveExistingPathWithinRoot(runsRoot, runId)
  const filePath = await resolvePathWithinRoot(verifiedRunDir, 'gate-decisions.ndjson')
  await appendFileNoFollow(filePath, JSON.stringify(validated) + '\n')
}

export async function readGateDecisions(basePath: string, runId: string): Promise<GateDecision[]> {
  assertSafePathSegment(runId, 'run id')
  let filePath: string
  let content: string
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    filePath = await resolveExistingPathWithinRoot(runsRoot, runId, 'gate-decisions.ndjson')
    content = await readTextFileNoFollow(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => GateDecisionSchema.parse(JSON.parse(line)))
}
