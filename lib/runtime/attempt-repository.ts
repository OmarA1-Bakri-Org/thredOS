import { readdir } from 'fs/promises'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { attemptRecordPath, ensureRunsRoot, lookupAttemptsDirectory } from './paths'
import { RuntimeRepositoryError } from './run-repository'
import { StepAttemptSchema, type StepAttempt } from './schema'
import {
  readRuntimeIndex,
  rebuildRuntimeIndex,
  refreshRuntimeIndexBestEffort,
  resolveRuntimeIndexReference,
  scanAuthoritativeRuntimeIndex,
} from './runtime-index'

export type AttemptMutation = (current: StepAttempt) => StepAttempt

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readAttemptFile(path: string): Promise<StepAttempt> {
  return StepAttemptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

export class AttemptRepository {
  constructor(private readonly basePath: string) {}

  async create(value: StepAttempt): Promise<void> {
    const attempt = StepAttemptSchema.parse(value)
    assertSafePathSegment(attempt.workflow_run_id, 'run id')
    assertSafePathSegment(attempt.id, 'attempt id')
    const runsRoot = await ensureRunsRoot(this.basePath)
    const runPath = await resolveExistingPathWithinRoot(runsRoot, attempt.workflow_run_id, 'run.json').catch(() => null)
    if (!runPath) throw new RuntimeRepositoryError('RUN_NOT_FOUND', `run ${attempt.workflow_run_id} was not found`)
    const path = await attemptRecordPath(this.basePath, attempt.workflow_run_id, attempt.id)
    await withExclusiveFileLock(`${path}.lock`, async () => {
      try {
        await readTextFileNoFollow(path)
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `attempt ${attempt.id} already exists`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await writeFileAtomic(path, `${JSON.stringify(attempt, null, 2)}\n`, { allowedRoot: this.basePath })
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
  }

  async get(attemptId: string): Promise<StepAttempt | null> {
    assertSafePathSegment(attemptId, 'attempt id')
    const readReference = async (reference: string | undefined): Promise<StepAttempt | null> => {
      if (!reference) return null
      const attempt = await readAttemptFile(await resolveRuntimeIndexReference(this.basePath, reference))
      if (attempt.id !== attemptId) throw new Error('attempt record identity does not match its index key')
      return attempt
    }
    const first = (await readRuntimeIndex(this.basePath)).attempts[attemptId]
    try {
      const attempt = await readReference(first)
      if (attempt) return attempt
    } catch {
      // Any stale, invalid, mismatched, or escaping derived reference is discarded below.
    }
    const authoritative = await scanAuthoritativeRuntimeIndex(this.basePath)
    const retry = authoritative.attempts[attemptId]
    if (first || retry) await rebuildRuntimeIndex(this.basePath, 25).catch(() => undefined)
    return await readReference(retry)
  }

  async listForRun(runId: string): Promise<StepAttempt[]> {
    assertSafePathSegment(runId, 'run id')
    const root = await lookupAttemptsDirectory(this.basePath, runId)
    if (!root) return []
    const attempts: StepAttempt[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      assertSafePathSegment(entry.name, 'attempt id')
      const path = await resolveExistingPathWithinRoot(root, entry.name, 'attempt.json').catch(() => null)
      if (!path) continue
      const attempt = await readAttemptFile(path)
      if (attempt.id !== entry.name || attempt.workflow_run_id !== runId) continue
      attempts.push(attempt)
    }
    return attempts.sort((left, right) => left.id.localeCompare(right.id))
  }

  async update(attemptId: string, expectedRevision: number, mutate: AttemptMutation): Promise<StepAttempt> {
    const existing = await this.get(attemptId)
    if (!existing) throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    const path = await attemptRecordPath(this.basePath, existing.workflow_run_id, attemptId)
    const updated = await withExclusiveFileLock(`${path}.lock`, async () => {
      const current = await readAttemptFile(path)
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError(
          'RUNTIME_REVISION_CONFLICT',
          `attempt ${attemptId} revision ${current.revision} does not match expected ${expectedRevision}`,
        )
      }
      const candidate = mutate(structuredClone(current))
      const next = StepAttemptSchema.parse({
        ...candidate,
        id: current.id,
        workflow_run_id: current.workflow_run_id,
        revision: current.revision + 1,
      })
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { allowedRoot: this.basePath })
      return next
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
    return updated
  }
}
