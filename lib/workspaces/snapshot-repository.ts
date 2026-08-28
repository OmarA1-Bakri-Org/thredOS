import { randomUUID } from 'crypto'
import { mkdir, readdir, rename, rm } from 'fs/promises'
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
import { verifySnapshotManifest } from './manifest'
import {
  SnapshotManifestSchema,
  WorkspaceSnapshotSchema,
  compareSnapshotPathBytes,
  parseSnapshotSha256Digest,
  type SnapshotManifest,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotStatus,
} from './schema'

const SnapshotCommitPointerSchema = z.object({
  generation: z.string().min(1),
})

export type SnapshotMutation = (current: WorkspaceSnapshot) => WorkspaceSnapshot

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class SnapshotRecordCorruptError extends Error {
  readonly code = 'SNAPSHOT_RECORD_CORRUPT'

  constructor(
    public readonly snapshotId: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SnapshotRecordCorruptError'
  }
}

function snapshotDirectoryRef(snapshotId: string): string {
  return `.threados/snapshots/${snapshotId}`
}

function manifestRef(snapshotId: string): string {
  return `${snapshotDirectoryRef(snapshotId)}/manifest.json`
}

function currentPointerPath(snapshotRoot: string): string {
  return join(snapshotRoot, 'current.json')
}

function stableManifestPath(snapshotRoot: string): string {
  return join(snapshotRoot, 'manifest.json')
}

function generationsRootPath(snapshotRoot: string): string {
  return join(snapshotRoot, 'generations')
}

function generationPath(snapshotRoot: string, generation: string): string {
  return join(generationsRootPath(snapshotRoot), generation)
}

function stagingGenerationPath(snapshotRoot: string, generation: string): string {
  return join(generationsRootPath(snapshotRoot), `${generation}.staging`)
}

function shouldCarryReadyEvidence(snapshot: Pick<WorkspaceSnapshot, 'status' | 'verified_at'>): boolean {
  return snapshot.status === 'ready' || (snapshot.status === 'deleted' && snapshot.verified_at != null)
}

function isAllowedTransition(current: WorkspaceSnapshotStatus, next: WorkspaceSnapshotStatus): boolean {
  if (current === next) return false
  if (current === 'creating') return next === 'ready' || next === 'failed' || next === 'deleted'
  if (current === 'ready' || current === 'failed') return next === 'deleted'
  return false
}

function asCorruptRecordError(snapshotId: string, context: string, error: unknown): SnapshotRecordCorruptError {
  if (error instanceof SnapshotRecordCorruptError) return error
  if (error instanceof RuntimeRepositoryError) throw error
  const detail = error instanceof Error ? error.message : String(error)
  return new SnapshotRecordCorruptError(snapshotId, `Snapshot record ${snapshotId} is corrupt: ${context}: ${detail}`, error)
}

async function lookupSnapshotsRoot(basePath: string): Promise<string | null> {
  try {
    return await resolveExistingPathWithinRoot(basePath, '.threados', 'snapshots')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function ensureSnapshotsRoot(basePath: string): Promise<string> {
  const threadosRoot = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosRoot, { recursive: true })
  const snapshotsRoot = await resolvePathWithinRoot(basePath, '.threados', 'snapshots')
  await mkdir(snapshotsRoot, { recursive: true })
  return snapshotsRoot
}

async function snapshotRootPath(basePath: string, snapshotId: string): Promise<string> {
  return resolvePathWithinRoot(basePath, '.threados', 'snapshots', snapshotId)
}

async function snapshotDirectoryExistsUnlocked(basePath: string, snapshotId: string): Promise<boolean> {
  try {
    await resolveExistingPathWithinRoot(basePath, '.threados', 'snapshots', snapshotId)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function readCommitPointerUnlocked(snapshotRoot: string, snapshotId: string): Promise<string> {
  const path = await resolveExistingPathWithinRoot(snapshotRoot, 'current.json')
  const parsed = SnapshotCommitPointerSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  try {
    return assertSafePathSegment(parsed.generation, 'snapshot generation')
  } catch (error) {
    throw asCorruptRecordError(snapshotId, 'commit pointer generation is invalid', error)
  }
}

async function readGenerationFilesUnlocked(
  basePath: string,
  snapshotId: string,
): Promise<{ manifest: SnapshotManifest; snapshot: WorkspaceSnapshot; generation: string }> {
  const snapshotRoot = await snapshotRootPath(basePath, snapshotId)
  const generation = await readCommitPointerUnlocked(snapshotRoot, snapshotId)
  const manifestPath = await resolveExistingPathWithinRoot(snapshotRoot, 'manifest.json')
  const generationManifestPath = await resolveExistingPathWithinRoot(snapshotRoot, 'generations', generation, 'manifest.json')
  const metadataPath = await resolveExistingPathWithinRoot(snapshotRoot, 'generations', generation, 'metadata.json')

  const manifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(manifestPath)))
  const generationManifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(generationManifestPath)))
  verifySnapshotManifest(generationManifest)
  if (
    manifest.snapshot_id !== generationManifest.snapshot_id
    || manifest.root_manifest_hash !== generationManifest.root_manifest_hash
  ) {
    throw new Error('Stable and generation snapshot manifests do not match')
  }

  return {
    generation,
    manifest,
    snapshot: WorkspaceSnapshotSchema.parse(JSON.parse(await readTextFileNoFollow(metadataPath))),
  }
}

function canonicalizeSnapshot(snapshot: WorkspaceSnapshot, manifest: SnapshotManifest): WorkspaceSnapshot {
  const verified = verifySnapshotManifest(manifest)
  if (snapshot.id !== manifest.snapshot_id) {
    throw new Error(`Snapshot identity mismatch between metadata ${snapshot.id} and manifest ${manifest.snapshot_id}`)
  }

  const carriesReadyEvidence = shouldCarryReadyEvidence(snapshot)
  const expectedManifestRef = carriesReadyEvidence ? manifestRef(snapshot.id) : null
  const expectedRootManifestHash = carriesReadyEvidence ? verified.rootManifestHash : null

  if (snapshot.file_count !== verified.fileCount) throw new Error('Snapshot file_count must match the manifest')
  if (snapshot.total_bytes !== verified.totalBytes) throw new Error('Snapshot total_bytes must match the manifest')
  if (snapshot.directory_count !== verified.directoryCount) throw new Error('Snapshot directory_count must match the manifest')
  if (snapshot.symlink_count !== verified.symlinkCount) throw new Error('Snapshot symlink_count must match the manifest')
  if (snapshot.manifest_ref !== expectedManifestRef) {
    throw new Error(`Snapshot manifest_ref must be ${expectedManifestRef}`)
  }
  if (snapshot.root_manifest_hash !== expectedRootManifestHash) {
    throw new Error(`Snapshot root_manifest_hash must be ${expectedRootManifestHash}`)
  }

  return WorkspaceSnapshotSchema.parse({
    ...snapshot,
    manifest_ref: expectedManifestRef,
    root_manifest_hash: expectedRootManifestHash,
    file_count: verified.fileCount,
    total_bytes: verified.totalBytes,
    directory_count: verified.directoryCount,
    symlink_count: verified.symlinkCount,
  })
}

function assertDeleteMutationFrozen(current: WorkspaceSnapshot, next: WorkspaceSnapshot): void {
  if (next.status !== 'deleted') return

  const frozenCurrent = JSON.stringify({ ...current, status: 'deleted' as const })
  const frozenNext = JSON.stringify({ ...next, status: 'deleted' as const })
  if (frozenCurrent !== frozenNext) {
    throw new RuntimeRepositoryError(
      'INVALID_RUNTIME_TRANSITION',
      `snapshot ${current.id} records are immutable during deletion except for status`,
    )
  }
}

async function cleanupPath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

async function writeGenerationRecord(
  basePath: string,
  snapshotId: string,
  snapshot: WorkspaceSnapshot,
  manifest: SnapshotManifest,
): Promise<{ snapshotRoot: string; generation: string; committedPath: string }> {
  const snapshotRoot = await snapshotRootPath(basePath, snapshotId)
  await mkdir(snapshotRoot, { recursive: true })
  const generationsRoot = generationsRootPath(snapshotRoot)
  await mkdir(generationsRoot, { recursive: true })

  const generation = assertSafePathSegment(randomUUID(), 'snapshot generation')
  const stagingPath = stagingGenerationPath(snapshotRoot, generation)
  const committedPath = generationPath(snapshotRoot, generation)
  await mkdir(stagingPath, { recursive: true })

  try {
    await writeFileAtomic(join(stagingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      allowedRoot: basePath,
    })
    await writeFileAtomic(join(stagingPath, 'metadata.json'), `${JSON.stringify(snapshot, null, 2)}\n`, {
      allowedRoot: basePath,
    })
    await rename(stagingPath, committedPath)
    return { snapshotRoot, generation, committedPath }
  } catch (error) {
    await cleanupPath(stagingPath)
    throw error
  }
}

async function publishCommittedGeneration(basePath: string, snapshotRoot: string, generation: string): Promise<void> {
  await writeFileAtomic(
    currentPointerPath(snapshotRoot),
    `${JSON.stringify({ generation }, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

async function publishStableManifest(
  basePath: string,
  snapshotRoot: string,
  manifest: SnapshotManifest,
): Promise<void> {
  await writeFileAtomic(
    stableManifestPath(snapshotRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

async function readCommittedSnapshotUnlocked(
  basePath: string,
  snapshotId: string,
): Promise<{ manifest: SnapshotManifest; snapshot: WorkspaceSnapshot; generation: string } | null> {
  try {
    if (!await snapshotDirectoryExistsUnlocked(basePath, snapshotId)) return null
    const committed = await readGenerationFilesUnlocked(basePath, snapshotId)
    return {
      ...committed,
      snapshot: canonicalizeSnapshot(committed.snapshot, committed.manifest),
    }
  } catch (error) {
    throw asCorruptRecordError(snapshotId, 'committed metadata or manifest validation failed', error)
  }
}

export class SnapshotRepository {
  constructor(private readonly basePath: string) {}

  async create(value: WorkspaceSnapshot, manifestValue: SnapshotManifest): Promise<void> {
    const snapshot = WorkspaceSnapshotSchema.parse(value)
    const manifest = SnapshotManifestSchema.parse(manifestValue)
    assertSafePathSegment(snapshot.id, 'snapshot id')
    assertSafePathSegment(manifest.snapshot_id, 'snapshot id')
    const canonicalSnapshot = canonicalizeSnapshot(snapshot, manifest)
    const snapshotsRoot = await ensureSnapshotsRoot(this.basePath)
    const lockPath = join(snapshotsRoot, `${snapshot.id}.lock`)

    await withExclusiveFileLock(lockPath, async () => {
      const existedBefore = await snapshotDirectoryExistsUnlocked(this.basePath, snapshot.id)
      const current = await readCommittedSnapshotUnlocked(this.basePath, snapshot.id)
      if (current != null) {
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `snapshot ${snapshot.id} already exists`)
      }

      let committedPath: string | null = null
      try {
        const staged = await writeGenerationRecord(this.basePath, snapshot.id, canonicalSnapshot, manifest)
        committedPath = staged.committedPath
        await publishStableManifest(this.basePath, staged.snapshotRoot, manifest)
        await publishCommittedGeneration(this.basePath, staged.snapshotRoot, staged.generation)
      } catch (error) {
        if (committedPath) await cleanupPath(committedPath)
        if (!existedBefore) await cleanupPath(await snapshotRootPath(this.basePath, snapshot.id))
        throw error
      }
    }, { allowedRoot: this.basePath })
  }

  async get(snapshotId: string): Promise<WorkspaceSnapshot | null> {
    assertSafePathSegment(snapshotId, 'snapshot id')
    const snapshotsRoot = await lookupSnapshotsRoot(this.basePath)
    if (!snapshotsRoot) return null
    return await withExclusiveFileLock(join(snapshotsRoot, `${snapshotId}.lock`), async () => {
      try {
        return (await readCommittedSnapshotUnlocked(this.basePath, snapshotId))?.snapshot ?? null
      } catch (error) {
        throw asCorruptRecordError(snapshotId, 'metadata or manifest validation failed', error)
      }
    }, { allowedRoot: this.basePath })
  }

  async getManifest(snapshotId: string): Promise<SnapshotManifest | null> {
    assertSafePathSegment(snapshotId, 'snapshot id')
    const snapshotsRoot = await lookupSnapshotsRoot(this.basePath)
    if (!snapshotsRoot) return null
    return await withExclusiveFileLock(join(snapshotsRoot, `${snapshotId}.lock`), async () => {
      try {
        return (await readCommittedSnapshotUnlocked(this.basePath, snapshotId))?.manifest ?? null
      } catch (error) {
        throw asCorruptRecordError(snapshotId, 'manifest validation failed', error)
      }
    }, { allowedRoot: this.basePath })
  }

  async update(
    snapshotId: string,
    expectedStatus: WorkspaceSnapshotStatus,
    mutate: SnapshotMutation,
  ): Promise<WorkspaceSnapshot> {
    assertSafePathSegment(snapshotId, 'snapshot id')
    const snapshotsRoot = await ensureSnapshotsRoot(this.basePath)
    const lockPath = join(snapshotsRoot, `${snapshotId}.lock`)

    return await withExclusiveFileLock(lockPath, async () => {
      const current = await readCommittedSnapshotUnlocked(this.basePath, snapshotId)
      if (current == null) {
        throw new RuntimeRepositoryError('SNAPSHOT_NOT_FOUND', `snapshot ${snapshotId} was not found`)
      }
      if (current.snapshot.status !== expectedStatus) {
        throw new RuntimeRepositoryError(
          'RUNTIME_REVISION_CONFLICT',
          `snapshot ${snapshotId} status ${current.snapshot.status} does not match expected ${expectedStatus}`,
        )
      }

      const candidateRaw = mutate(structuredClone(current.snapshot))
      if (!isAllowedTransition(current.snapshot.status, candidateRaw.status)) {
        throw new RuntimeRepositoryError(
          'INVALID_RUNTIME_TRANSITION',
          `snapshot ${snapshotId} cannot transition from ${current.snapshot.status} to ${candidateRaw.status}`,
        )
      }
      assertDeleteMutationFrozen(current.snapshot, candidateRaw)

      const carriesReadyEvidence = shouldCarryReadyEvidence(candidateRaw)
      const candidate = canonicalizeSnapshot(WorkspaceSnapshotSchema.parse({
        ...candidateRaw,
        id: current.snapshot.id,
        manifest_ref: carriesReadyEvidence ? manifestRef(current.snapshot.id) : null,
        root_manifest_hash: carriesReadyEvidence ? current.manifest.root_manifest_hash : null,
      }), current.manifest)

      let committedPath: string | null = null
      try {
        const staged = await writeGenerationRecord(this.basePath, snapshotId, candidate, current.manifest)
        committedPath = staged.committedPath
        await publishCommittedGeneration(this.basePath, staged.snapshotRoot, staged.generation)
        return candidate
      } catch (error) {
        if (committedPath) await cleanupPath(committedPath)
        throw error
      }
    }, { allowedRoot: this.basePath })
  }

  async list(): Promise<WorkspaceSnapshot[]> {
    const snapshotsRoot = await lookupSnapshotsRoot(this.basePath)
    if (!snapshotsRoot) return []

    const snapshots: WorkspaceSnapshot[] = []
    for (const entry of await readdir(snapshotsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      assertSafePathSegment(entry.name, 'snapshot id')
      const snapshot = await this.get(entry.name)
      if (snapshot) snapshots.push(snapshot)
    }
    return snapshots.sort((left, right) => compareSnapshotPathBytes(left.id, right.id))
  }

  async findByRootManifestHash(rootManifestHash: string): Promise<WorkspaceSnapshot | null> {
    parseSnapshotSha256Digest(rootManifestHash)
    for (const snapshot of await this.list()) {
      if (snapshot.status === 'ready' && snapshot.root_manifest_hash === rootManifestHash) return snapshot
    }
    return null
  }
}
