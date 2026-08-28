import { readdir } from 'fs/promises'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import {
  attemptRecordPath,
  attemptWorkspaceRefPath,
  ensureRunsRoot,
  lookupAttemptRecordPath,
  lookupAttemptsDirectory,
  lookupAttemptWorkspaceRefPath,
} from './paths'
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

export const AttemptWorkspaceRefSchema = z.object({
  schema_version: z.literal(1),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  workspace_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bound_at: z.string().datetime(),
}).strict().superRefine((reference, context) => {
  for (const [field, label] of [
    ['workflow_run_id', 'run id'],
    ['attempt_id', 'attempt id'],
    ['workspace_id', 'workspace id'],
    ['snapshot_id', 'snapshot id'],
  ] as const) {
    try {
      assertSafePathSegment(reference[field], label)
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: error instanceof Error ? error.message : `${label} must be a file-safe identifier`,
      })
    }
  }
})
export type AttemptWorkspaceRef = z.infer<typeof AttemptWorkspaceRefSchema>

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readAttemptFile(path: string): Promise<StepAttempt> {
  return StepAttemptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

async function readWorkspaceRefFile(path: string): Promise<AttemptWorkspaceRef> {
  return AttemptWorkspaceRefSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

function workspaceRefsMatch(left: AttemptWorkspaceRef, right: AttemptWorkspaceRef): boolean {
  return left.schema_version === right.schema_version
    && left.workflow_run_id === right.workflow_run_id
    && left.attempt_id === right.attempt_id
    && left.workspace_id === right.workspace_id
    && left.snapshot_id === right.snapshot_id
    && left.manifest_hash === right.manifest_hash
}

function assertWorkspaceRefMatchesAttempt(
  attempt: StepAttempt,
  reference: AttemptWorkspaceRef,
): void {
  if (
    attempt.workspace_id != null && attempt.workspace_id !== reference.workspace_id
    || attempt.baseline_snapshot_id != null && attempt.baseline_snapshot_id !== reference.snapshot_id
  ) {
    throw new RuntimeRepositoryError(
      'ATTEMPT_WORKSPACE_REF_IDENTITY_MISMATCH',
      `workspace reference does not match persisted attempt ${attempt.id}`,
    )
  }
}

async function readMatchingAttempt(
  path: string,
  runId: string,
  attemptId: string,
): Promise<StepAttempt> {
  let attempt: StepAttempt
  try {
    attempt = await readAttemptFile(path)
  } catch (error) {
    if (isMissing(error)) {
      throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    }
    throw error
  }
  if (attempt.id !== attemptId || attempt.workflow_run_id !== runId) {
    throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
  }
  return attempt
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

  async getWorkspaceRef(runId: string, attemptId: string): Promise<AttemptWorkspaceRef | null> {
    assertSafePathSegment(runId, 'run id')
    assertSafePathSegment(attemptId, 'attempt id')
    const path = await lookupAttemptWorkspaceRefPath(this.basePath, runId, attemptId)
    if (!path) return null
    const reference = await readWorkspaceRefFile(path)
    if (reference.workflow_run_id !== runId || reference.attempt_id !== attemptId) {
      throw new RuntimeRepositoryError(
        'ATTEMPT_WORKSPACE_REF_IDENTITY_MISMATCH',
        `workspace reference identity does not match attempt ${attemptId}`,
      )
    }
    const attemptPath = await lookupAttemptRecordPath(this.basePath, runId, attemptId)
    if (!attemptPath) {
      throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    }
    const attempt = await readMatchingAttempt(attemptPath, runId, attemptId)
    assertWorkspaceRefMatchesAttempt(attempt, reference)
    return reference
  }

  async bindWorkspaceRef(value: AttemptWorkspaceRef): Promise<AttemptWorkspaceRef> {
    const reference = AttemptWorkspaceRefSchema.parse(value)
    const attemptPath = await lookupAttemptRecordPath(
      this.basePath,
      reference.workflow_run_id,
      reference.attempt_id,
    )
    if (!attemptPath) {
      throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${reference.attempt_id} was not found`)
    }
    const owner = await readMatchingAttempt(
      attemptPath,
      reference.workflow_run_id,
      reference.attempt_id,
    )
    assertWorkspaceRefMatchesAttempt(owner, reference)

    const path = await attemptWorkspaceRefPath(
      this.basePath,
      reference.workflow_run_id,
      reference.attempt_id,
    )
    return await withExclusiveFileLock(`${path}.lock`, async () => {
      const currentOwner = await readMatchingAttempt(
        attemptPath,
        reference.workflow_run_id,
        reference.attempt_id,
      )
      assertWorkspaceRefMatchesAttempt(currentOwner, reference)
      try {
        const existing = await readWorkspaceRefFile(path)
        if (workspaceRefsMatch(existing, reference)) return existing
        throw new RuntimeRepositoryError(
          'ATTEMPT_WORKSPACE_REF_CONFLICT',
          `attempt ${reference.attempt_id} is already bound to workspace ${existing.workspace_id}`,
        )
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await writeFileAtomic(path, `${JSON.stringify(reference, null, 2)}\n`, { allowedRoot: this.basePath })
      return reference
    }, { allowedRoot: this.basePath })
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
    return updated
  }
}
