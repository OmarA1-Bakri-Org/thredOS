import { readdir } from 'fs/promises'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { lookupRunRecordPath, lookupRunsRoot, runRecordPath } from './paths'
import { WorkflowRunSchema, type WorkflowRun, type WorkflowRunStatus } from './schema'
import { refreshRuntimeIndexBestEffort } from './runtime-index'

export type RunMutation = (current: WorkflowRun) => WorkflowRun
export interface RunQuery {
  sequenceId?: string
  status?: WorkflowRunStatus
}

export class RuntimeRepositoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'RuntimeRepositoryError'
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function readWorkflowRunFile(path: string): Promise<WorkflowRun> {
  return WorkflowRunSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

export class RunRepository {
  constructor(private readonly basePath: string) {}

  async create(value: WorkflowRun): Promise<void> {
    const run = WorkflowRunSchema.parse(value)
    assertSafePathSegment(run.id, 'run id')
    const path = await runRecordPath(this.basePath, run.id)
    await withExclusiveFileLock(`${path}.lock`, async () => {
      try {
        await readTextFileNoFollow(path)
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `run ${run.id} already exists`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await writeFileAtomic(path, `${JSON.stringify(run, null, 2)}\n`, { allowedRoot: this.basePath })
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
  }

  async get(runId: string): Promise<WorkflowRun | null> {
    assertSafePathSegment(runId, 'run id')
    const path = await lookupRunRecordPath(this.basePath, runId)
    if (!path) return null
    try {
      const run = await readWorkflowRunFile(path)
      if (run.id !== runId) throw new Error('run record identity does not match its path')
      return run
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async update(runId: string, expectedRevision: number, mutate: RunMutation): Promise<WorkflowRun> {
    assertSafePathSegment(runId, 'run id')
    const path = await runRecordPath(this.basePath, runId)
    const updated = await withExclusiveFileLock(`${path}.lock`, async () => {
      let current: WorkflowRun
      try {
        current = await readWorkflowRunFile(path)
      } catch (error) {
        if (isMissing(error)) throw new RuntimeRepositoryError('RUN_NOT_FOUND', `run ${runId} was not found`)
        throw error
      }
      if (current.id !== runId) throw new Error('run record identity does not match its path')
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError(
          'RUNTIME_REVISION_CONFLICT',
          `run ${runId} revision ${current.revision} does not match expected ${expectedRevision}`,
        )
      }
      const candidate = mutate(structuredClone(current))
      const next = WorkflowRunSchema.parse({ ...candidate, id: current.id, revision: current.revision + 1 })
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { allowedRoot: this.basePath })
      return next
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
    return updated
  }

  async list(query: RunQuery = {}): Promise<WorkflowRun[]> {
    const root = await lookupRunsRoot(this.basePath)
    if (!root) return []
    const runs: WorkflowRun[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      assertSafePathSegment(entry.name, 'run id')
      const path = await resolveExistingPathWithinRoot(root, entry.name, 'run.json').catch(() => null)
      if (!path) continue
      const parsed = WorkflowRunSchema.safeParse(JSON.parse(await readTextFileNoFollow(path)))
      if (!parsed.success || parsed.data.id !== entry.name) continue
      if (query.sequenceId && parsed.data.sequence_id !== query.sequenceId) continue
      if (query.status && parsed.data.status !== query.status) continue
      runs.push(parsed.data)
    }
    return runs.sort((left, right) => left.id.localeCompare(right.id))
  }
}
