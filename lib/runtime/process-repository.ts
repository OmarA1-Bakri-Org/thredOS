import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertSafePathSegment } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { AttemptRepository } from './attempt-repository'
import { processRecordPath } from './paths'
import { RuntimeRepositoryError } from './run-repository'
import { ProcessRecordSchema, type ProcessRecord } from './schema'
import {
  readRuntimeIndex,
  rebuildRuntimeIndex,
  refreshRuntimeIndexBestEffort,
  resolveRuntimeIndexReference,
  scanAuthoritativeRuntimeIndex,
} from './runtime-index'

export type ProcessMutation = (current: ProcessRecord) => ProcessRecord

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readProcess(path: string): Promise<ProcessRecord> {
  return ProcessRecordSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

export class ProcessRepository {
  constructor(private readonly basePath: string) {}

  async create(value: ProcessRecord): Promise<void> {
    const processRecord = ProcessRecordSchema.parse(value)
    assertSafePathSegment(processRecord.id, 'process id')
    assertSafePathSegment(processRecord.workflow_run_id, 'run id')
    assertSafePathSegment(processRecord.attempt_id, 'attempt id')
    const attempt = await new AttemptRepository(this.basePath).get(processRecord.attempt_id)
    if (!attempt || attempt.workflow_run_id !== processRecord.workflow_run_id) {
      throw new RuntimeRepositoryError('ATTEMPT_NOT_FOUND', `attempt ${processRecord.attempt_id} was not found`)
    }
    const path = await processRecordPath(
      this.basePath,
      processRecord.workflow_run_id,
      processRecord.attempt_id,
    )
    await withExclusiveFileLock(`${path}.lock`, async () => {
      try {
        await readTextFileNoFollow(path)
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `process ${processRecord.id} already exists`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await writeFileAtomic(path, `${JSON.stringify(processRecord, null, 2)}\n`, { allowedRoot: this.basePath })
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
  }

  async get(processId: string): Promise<ProcessRecord | null> {
    assertSafePathSegment(processId, 'process id')
    const readReference = async (reference: string | undefined): Promise<ProcessRecord | null> => {
      if (!reference) return null
      const record = await readProcess(await resolveRuntimeIndexReference(this.basePath, reference))
      if (record.id !== processId) throw new Error('process record identity does not match its index key')
      return record
    }
    const first = (await readRuntimeIndex(this.basePath)).processes[processId]
    try {
      const processRecord = await readReference(first)
      if (processRecord) return processRecord
    } catch {
      // The derived reference is stale or invalid; authoritative scan wins below.
    }
    const authoritative = await scanAuthoritativeRuntimeIndex(this.basePath)
    const retry = authoritative.processes[processId]
    if (first || retry) await rebuildRuntimeIndex(this.basePath, 25).catch(() => undefined)
    return await readReference(retry)
  }

  async list(): Promise<ProcessRecord[]> {
    const index = await scanAuthoritativeRuntimeIndex(this.basePath)
    const records = await Promise.all(Object.values(index.processes).map(async reference =>
      await readProcess(await resolveRuntimeIndexReference(this.basePath, reference)),
    ))
    return records.sort((left, right) => left.id.localeCompare(right.id))
  }

  async update(processId: string, expectedRevision: number, mutate: ProcessMutation): Promise<ProcessRecord> {
    const existing = await this.get(processId)
    if (!existing) throw new RuntimeRepositoryError('PROCESS_NOT_FOUND', `process ${processId} was not found`)
    const path = await processRecordPath(this.basePath, existing.workflow_run_id, existing.attempt_id)
    const updated = await withExclusiveFileLock(`${path}.lock`, async () => {
      const current = await readProcess(path)
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError('RUNTIME_REVISION_CONFLICT', `process ${processId} revision conflict`)
      }
      const next = ProcessRecordSchema.parse({
        ...mutate(structuredClone(current)),
        id: current.id,
        workflow_run_id: current.workflow_run_id,
        attempt_id: current.attempt_id,
        revision: current.revision + 1,
      })
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { allowedRoot: this.basePath })
      return next
    }, { allowedRoot: this.basePath })
    await refreshRuntimeIndexBestEffort(this.basePath)
    return updated
  }
}
