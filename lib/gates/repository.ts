import { lstat, mkdir, open } from 'fs/promises'
import { createHash } from 'crypto'
import { constants } from 'fs'
import { GateDecisionSchema, type GateDecision } from '@/lib/contracts/schemas'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { appendFileNoFollow, readTextFileNoFollow } from '@/lib/security/safe-io'

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function parseJournal(bytes: Buffer): {
  decisions: GateDecision[]
  validPrefix: string
  tornTail: boolean
} {
  const decisions: GateDecision[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = 0
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset)
    if (newline < 0) break
    const line = bytes.subarray(offset, newline)
    try {
      if (line.length) decisions.push(GateDecisionSchema.parse(JSON.parse(decoder.decode(line))))
    } catch {
      throw new Error('GATE_DECISION_JOURNAL_CORRUPT')
    }
    offset = newline + 1
  }
  const tail = bytes.subarray(offset)
  if (tail.length) {
    try {
      decisions.push(GateDecisionSchema.parse(JSON.parse(decoder.decode(tail))))
    } catch {
      return { decisions, validPrefix: bytes.subarray(0, offset).toString('utf8'), tornTail: true }
    }
  }
  return { decisions, validPrefix: bytes.toString('utf8'), tornTail: false }
}

async function readJournalBytes(filePath: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (missing(error)) return Buffer.alloc(0)
    throw error
  }
  try {
    const before = await handle.stat()
    const pathStat = await lstat(filePath)
    if (!before.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
      || before.nlink !== 1 || pathStat.nlink !== 1
      || before.dev !== pathStat.dev || before.ino !== pathStat.ino) {
      throw new Error('GATE_DECISION_JOURNAL_UNSAFE')
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) {
      throw new Error('GATE_DECISION_JOURNAL_CHANGED')
    }
    return bytes
  } finally {
    await handle.close()
  }
}

/** Must be called with the gate journal lock held. The original bytes remain in a named artifact. */
async function recoverTornTail(basePath: string, runDir: string, filePath: string): Promise<GateDecision[]> {
  const sourceBytes = await readJournalBytes(filePath)
  const parsed = parseJournal(sourceBytes)
  if (!parsed.tornTail) return parsed.decisions
  const digest = createHash('sha256').update(sourceBytes).digest('hex')
  const archivePath = await resolvePathWithinRoot(runDir, `gate-decisions.ndjson.torn-${digest}.json`)
  const archive = JSON.stringify({ schema_version: 1, source_sha256: `sha256:${digest}`,
    source_bytes_base64: sourceBytes.toString('base64') })
  try {
    if (await readTextFileNoFollow(archivePath) !== archive) {
      throw new Error('GATE_DECISION_RECOVERY_ARTIFACT_CONFLICT')
    }
  } catch (error) {
    if (!missing(error)) throw error
    await writeFileAtomic(archivePath, archive, { allowedRoot: basePath })
  }
  await writeFileAtomic(filePath, parsed.validPrefix, { allowedRoot: basePath })
  return parsed.decisions
}

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
  const lockPath = await resolvePathWithinRoot(verifiedRunDir, 'gate-decisions.ndjson.lock')
  await withExclusiveFileLock(lockPath, async () => {
    const content = await readJournalBytes(filePath)
    await recoverTornTail(basePath, verifiedRunDir, filePath)
    const separator = content.length > 0 && content.at(-1) !== 0x0a && !parseJournal(content).tornTail ? '\n' : ''
    await appendFileNoFollow(filePath, separator + JSON.stringify(validated) + '\n')
  }, { allowedRoot: basePath })
}

export async function readGateDecisions(basePath: string, runId: string): Promise<GateDecision[]> {
  assertSafePathSegment(runId, 'run id')
  let runDir: string
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    runDir = await resolveExistingPathWithinRoot(runsRoot, runId)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const filePath = await resolvePathWithinRoot(runDir, 'gate-decisions.ndjson')
  const lockPath = await resolvePathWithinRoot(runDir, 'gate-decisions.ndjson.lock')
  return withExclusiveFileLock(lockPath, async () => {
    const parsed = parseJournal(await readJournalBytes(filePath))
    if (parsed.tornTail) throw new Error('GATE_DECISION_JOURNAL_CORRUPT')
    return parsed.decisions
  }, { allowedRoot: basePath })
}

/** Explicit repair for an invalid, unterminated final NDJSON entry. Earlier decisions are immutable. */
export async function readGateDecisionsRecoveringTail(basePath: string, runId: string): Promise<GateDecision[]> {
  assertSafePathSegment(runId, 'run id')
  let runDir: string
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    runDir = await resolveExistingPathWithinRoot(runsRoot, runId)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const filePath = await resolvePathWithinRoot(runDir, 'gate-decisions.ndjson')
  const lockPath = await resolvePathWithinRoot(runDir, 'gate-decisions.ndjson.lock')
  return withExclusiveFileLock(lockPath, () => recoverTornTail(basePath, runDir, filePath),
    { allowedRoot: basePath })
}
