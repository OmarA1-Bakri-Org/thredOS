import { randomUUID } from 'crypto'
import { lstat, mkdir, readdir, rename, rm } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { RuntimeRepositoryError } from '@/lib/runtime/run-repository'
import {
  SurfaceWorkspaceSchema,
  compareSnapshotPathBytes,
  type SurfaceWorkspace,
  type SurfaceWorkspaceStatus,
} from './schema'

const WorkspaceIndexSchema = z.object({
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative().refine(Number.isSafeInteger),
  workspaces: z.array(SurfaceWorkspaceSchema),
}).superRefine((index, context) => {
  const seen = new Set<string>()
  index.workspaces.forEach((workspace, offset) => {
    if (seen.has(workspace.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workspaces', offset, 'id'],
        message: `Duplicate workspace id: ${workspace.id}`,
      })
    }
    seen.add(workspace.id)
  })
})
export type WorkspaceIndex = z.infer<typeof WorkspaceIndexSchema>
export type WorkspaceMutation = (current: SurfaceWorkspace) => SurfaceWorkspace
export type WorkspaceCreatePrecondition = (current: readonly SurfaceWorkspace[]) => void

const WorkspaceRepositoryMarkerSchema = z.object({
  schema_version: z.literal(1),
  mode: z.literal('canonical-records-v1'),
}).strict()

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function emptyIndex(): WorkspaceIndex {
  return { schema_version: 1, revision: 0, workspaces: [] }
}

export function getWorkspaceIndexPath(basePath: string): string {
  return join(basePath, '.threados', 'workspaces', 'index.json')
}

async function readIndex(basePath: string): Promise<WorkspaceIndex> {
  try {
    const path = await resolveExistingPathWithinRoot(
      basePath,
      '.threados',
      'workspaces',
      'index.json',
    )
    return WorkspaceIndexSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  } catch (error) {
    if (isMissing(error)) return emptyIndex()
    throw error
  }
}

async function writeIndex(basePath: string, index: WorkspaceIndex): Promise<void> {
  const parsed = WorkspaceIndexSchema.parse(index)
  await ensureWorkspaceDirectory(basePath)
  await writeFileAtomic(
    getWorkspaceIndexPath(basePath),
    `${JSON.stringify(parsed, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

function recordPath(basePath: string, workspaceId: string): string {
  assertSafePathSegment(workspaceId, 'workspace id')
  return join(basePath, '.threados', 'workspaces', 'records', `${workspaceId}.json`)
}

async function ensurePlainDirectory(basePath: string, segments: readonly string[]): Promise<string> {
  let current = basePath
  for (let index = 0; index < segments.length; index += 1) {
    const prefix = segments.slice(0, index + 1)
    const candidate = await resolvePathWithinRoot(basePath, ...prefix)
    await mkdir(candidate).catch(error => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
    const stat = await lstat(candidate)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Workspace repository path is not a plain directory: ${candidate}`)
    }
    current = await resolveExistingPathWithinRoot(basePath, ...prefix)
  }
  return current
}

async function ensureWorkspaceDirectory(basePath: string): Promise<string> {
  return ensurePlainDirectory(basePath, ['.threados', 'workspaces'])
}

async function ensureRecordsDirectory(basePath: string): Promise<string> {
  return ensurePlainDirectory(basePath, ['.threados', 'workspaces', 'records'])
}

async function repositoryMarkerPath(basePath: string): Promise<string> {
  const stateRoot = await ensurePlainDirectory(basePath, ['.threados', 'state'])
  return resolvePathWithinRoot(stateRoot, 'workspace-records-v1.json')
}

async function hasCanonicalRecordsMarker(basePath: string): Promise<boolean> {
  try {
    const path = await resolveExistingPathWithinRoot(
      basePath,
      '.threados',
      'state',
      'workspace-records-v1.json',
    )
    WorkspaceRepositoryMarkerSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function writeCanonicalRecordsMarker(basePath: string): Promise<void> {
  await writeFileAtomic(
    await repositoryMarkerPath(basePath),
    `${JSON.stringify({ schema_version: 1, mode: 'canonical-records-v1' }, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

function missingCanonicalRecordsError(): RuntimeRepositoryError {
  return new RuntimeRepositoryError(
    'WORKSPACE_RECORDS_MISSING',
    'canonical workspace records directory is missing',
  )
}

async function readCanonicalRecords(basePath: string): Promise<SurfaceWorkspace[] | null> {
  let recordsRoot: string
  try {
    recordsRoot = await resolveExistingPathWithinRoot(basePath, '.threados', 'workspaces', 'records')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }

  const records: SurfaceWorkspace[] = []
  for (const entry of await readdir(recordsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const workspaceId = entry.name.slice(0, -'.json'.length)
    assertSafePathSegment(workspaceId, 'workspace id')
    const path = await resolveExistingPathWithinRoot(recordsRoot, entry.name)
    const record = SurfaceWorkspaceSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
    if (record.id !== workspaceId) {
      throw new Error(`Workspace record filename does not match record id: ${entry.name}`)
    }
    records.push(record)
  }
  return records.sort((left, right) => compareSnapshotPathBytes(left.id, right.id))
}

async function writeCanonicalRecord(basePath: string, workspace: SurfaceWorkspace): Promise<void> {
  const parsed = SurfaceWorkspaceSchema.parse(workspace)
  await ensureRecordsDirectory(basePath)
  await writeFileAtomic(
    recordPath(basePath, parsed.id),
    `${JSON.stringify(parsed, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

const ALLOWED_TRANSITIONS: Readonly<Record<SurfaceWorkspaceStatus, readonly SurfaceWorkspaceStatus[]>> = {
  planned: ['materializing', 'cleaning', 'failed'],
  materializing: ['ready', 'failed'],
  ready: ['active', 'frozen', 'retained', 'cleaning'],
  active: ['frozen'],
  frozen: ['retained', 'cleaning'],
  retained: ['cleaning'],
  cleaning: ['cleaned', 'failed'],
  cleaned: [],
  failed: ['cleaning'],
}

function assertReadyEvidenceFrozen(current: SurfaceWorkspace, candidate: SurfaceWorkspace): void {
  if (current.ready_at == null) return
  const fields = ['manifest_hash', 'file_count', 'total_bytes', 'ready_at'] as const
  if (fields.some(field => candidate[field] !== current[field])) {
    throw new RuntimeRepositoryError(
      'RUNTIME_IDENTITY_MUTATION',
      `workspace ${current.id} verified materialization evidence cannot be changed`,
    )
  }
}

function assertTransition(current: SurfaceWorkspace, candidate: SurfaceWorkspace): void {
  if (candidate.status !== current.status && !ALLOWED_TRANSITIONS[current.status].includes(candidate.status)) {
    throw new RuntimeRepositoryError(
      'INVALID_RUNTIME_TRANSITION',
      `workspace ${current.id} cannot transition from ${current.status} to ${candidate.status}`,
    )
  }
}

function assertIdentity(current: SurfaceWorkspace, candidate: SurfaceWorkspace): void {
  const identityFields = [
    'schema_version',
    'id',
    'workflow_run_id',
    'attempt_id',
    'surface_id',
    'snapshot_id',
    'provider',
    'isolation_label',
    'root_path',
    'created_at',
  ] as const
  if (identityFields.some(field => candidate[field] !== current[field])) {
    throw new RuntimeRepositoryError(
      'RUNTIME_IDENTITY_MUTATION',
      `workspace ${current.id} immutable identity fields cannot be changed`,
    )
  }
}

async function migrateLegacyRecords(basePath: string, records: readonly SurfaceWorkspace[]): Promise<void> {
  const canonical = await readCanonicalRecords(basePath)
  const marked = await hasCanonicalRecordsMarker(basePath)
  if (marked) {
    if (canonical == null) throw missingCanonicalRecordsError()
    return
  }
  if (canonical != null) {
    await writeCanonicalRecordsMarker(basePath)
    return
  }
  const workspacesRoot = await ensureWorkspaceDirectory(basePath)
  if (records.length === 0) {
    const recordsRoot = await ensureRecordsDirectory(basePath)
    try {
      await writeCanonicalRecordsMarker(basePath)
    } catch (error) {
      await rm(recordsRoot, { recursive: true, force: true })
      throw error
    }
    return
  }

  const stagingId = assertSafePathSegment(`records-migration-${randomUUID()}`, 'workspace migration id')
  const stagingRoot = await resolvePathWithinRoot(workspacesRoot, stagingId)
  const recordsRoot = await resolvePathWithinRoot(workspacesRoot, 'records')
  await mkdir(stagingRoot)
  try {
    for (const record of records) {
      const parsed = SurfaceWorkspaceSchema.parse(record)
      await writeFileAtomic(
        join(stagingRoot, `${assertSafePathSegment(parsed.id, 'workspace id')}.json`),
        `${JSON.stringify(parsed, null, 2)}\n`,
        { allowedRoot: basePath },
      )
    }
    await rename(stagingRoot, recordsRoot)
    try {
      await writeCanonicalRecordsMarker(basePath)
    } catch (error) {
      await rm(recordsRoot, { recursive: true, force: true })
      throw error
    }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

export class WorkspaceRepository {
  constructor(private readonly basePath: string) {}

  async list(): Promise<SurfaceWorkspace[]> {
    const records = await readCanonicalRecords(this.basePath)
    const index = await readIndex(this.basePath)
    const marked = await hasCanonicalRecordsMarker(this.basePath)
    if (marked && records == null) throw missingCanonicalRecordsError()
    if (records == null) {
      return index.workspaces
        .sort((left, right) => compareSnapshotPathBytes(left.id, right.id))
    }
    const currentShape = JSON.stringify(records)
    const projectedShape = JSON.stringify(
      [...index.workspaces].sort((left, right) => compareSnapshotPathBytes(left.id, right.id)),
    )
    if (currentShape !== projectedShape) await this.rebuildIndex().catch(() => undefined)
    return records
  }

  async get(workspaceId: string): Promise<SurfaceWorkspace | null> {
    assertSafePathSegment(workspaceId, 'workspace id')
    const canonicalRecords = await readCanonicalRecords(this.basePath)
    if (await hasCanonicalRecordsMarker(this.basePath) && canonicalRecords == null) {
      throw missingCanonicalRecordsError()
    }
    if (canonicalRecords != null) {
      return canonicalRecords.find(item => item.id === workspaceId) ?? null
    }
    return (await readIndex(this.basePath)).workspaces.find(item => item.id === workspaceId) ?? null
  }

  async create(value: SurfaceWorkspace, precondition?: WorkspaceCreatePrecondition): Promise<void> {
    const workspace = SurfaceWorkspaceSchema.parse(value)
    assertSafePathSegment(workspace.id, 'workspace id')
    if (workspace.revision !== 0) {
      throw new RuntimeRepositoryError('RUNTIME_REVISION_CONFLICT', 'new workspace records must start at revision 0')
    }
    const indexPath = getWorkspaceIndexPath(this.basePath)
    await ensureWorkspaceDirectory(this.basePath)
    await withExclusiveFileLock(`${indexPath}.lock`, async () => {
      const index = await readIndex(this.basePath)
      const canonical = await readCanonicalRecords(this.basePath)
      if (await hasCanonicalRecordsMarker(this.basePath) && canonical == null) {
        throw missingCanonicalRecordsError()
      }
      const current = canonical ?? index.workspaces
      precondition?.(current)
      if (current.some(item => item.id === workspace.id)) {
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `workspace ${workspace.id} already exists`)
      }
      await migrateLegacyRecords(this.basePath, current)
      await writeCanonicalRecord(this.basePath, workspace)
      await writeIndex(this.basePath, {
        ...index,
        revision: index.revision + 1,
        workspaces: [...current, workspace],
      }).catch(() => undefined)
    }, { allowedRoot: this.basePath })
  }

  async update(
    workspaceId: string,
    expectedRevision: number,
    mutate: WorkspaceMutation,
  ): Promise<SurfaceWorkspace> {
    assertSafePathSegment(workspaceId, 'workspace id')
    const indexPath = getWorkspaceIndexPath(this.basePath)
    return await withExclusiveFileLock(`${indexPath}.lock`, async () => {
      const index = await readIndex(this.basePath)
      const canonical = await readCanonicalRecords(this.basePath)
      if (await hasCanonicalRecordsMarker(this.basePath) && canonical == null) {
        throw missingCanonicalRecordsError()
      }
      const workspaces = [...(canonical ?? index.workspaces)]
      const offset = workspaces.findIndex(item => item.id === workspaceId)
      if (offset === -1) {
        throw new RuntimeRepositoryError('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} was not found`)
      }
      const current = workspaces[offset]
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError(
          'RUNTIME_REVISION_CONFLICT',
          `workspace ${workspaceId} revision ${current.revision} does not match expected ${expectedRevision}`,
        )
      }
      const candidate = mutate(structuredClone(current))
      const next = SurfaceWorkspaceSchema.parse({
        ...candidate,
        id: current.id,
        revision: current.revision + 1,
      })
      assertIdentity(current, next)
      assertReadyEvidenceFrozen(current, next)
      assertTransition(current, next)
      workspaces[offset] = next
      await migrateLegacyRecords(this.basePath, workspaces.filter(item => item.id !== workspaceId))
      await writeCanonicalRecord(this.basePath, next)
      await writeIndex(this.basePath, { ...index, revision: index.revision + 1, workspaces })
        .catch(() => undefined)
      return next
    }, { allowedRoot: this.basePath })
  }

  async rebuildIndex(): Promise<WorkspaceIndex> {
    await ensureWorkspaceDirectory(this.basePath)
    const indexPath = getWorkspaceIndexPath(this.basePath)
    return await withExclusiveFileLock(`${indexPath}.lock`, async () => {
      const existing = await readIndex(this.basePath)
      const canonical = await readCanonicalRecords(this.basePath)
      if (await hasCanonicalRecordsMarker(this.basePath) && canonical == null) {
        throw missingCanonicalRecordsError()
      }
      const records = canonical ?? existing.workspaces
      await migrateLegacyRecords(this.basePath, records)
      const rebuilt = WorkspaceIndexSchema.parse({
        schema_version: 1,
        revision: existing.revision + 1,
        workspaces: records.sort((left, right) => compareSnapshotPathBytes(left.id, right.id)),
      })
      await writeIndex(this.basePath, rebuilt)
      return rebuilt
    }, { allowedRoot: this.basePath })
  }
}
