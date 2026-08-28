import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAtomicBeforeRenameHookForTests } from '@/lib/fs/atomic'
import { createSnapshotManifest } from './manifest'
import type { SnapshotManifest, WorkspaceSnapshot } from './schema'
import { SnapshotRecordCorruptError, SnapshotRepository } from './snapshot-repository'

const roots: string[] = []
const timestamp = '2026-08-28T00:00:00.000Z'

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'threados-snapshot-repo-'))
  roots.push(root)
  return root
}

function manifest(snapshotId = 'snapshot-01'): SnapshotManifest {
  return createSnapshotManifest(snapshotId, [
    {
      path: 'README.md',
      kind: 'file',
      sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      size_bytes: 10,
      mode: 0o644,
      symlink_target: null,
    },
  ])
}

function snapshot(snapshotId = 'snapshot-01', overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const snapshotManifest = manifest(snapshotId)
  return {
    schema_version: 1,
    id: snapshotId,
    local_workspace_id: 'local-01',
    source_root: 'C:\\project',
    content_root: 'C:\\runtime\\snapshots\\local-01\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\tree',
    manifest_ref: `.threados/snapshots/${snapshotId}/manifest.json`,
    status: 'ready',
    root_manifest_hash: snapshotManifest.root_manifest_hash,
    exclusion_policy_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    file_count: 1,
    total_bytes: 10,
    git_head: null,
    git_dirty: null,
    created_at: timestamp,
    verified_at: timestamp,
    error_code: null,
    directory_count: 0,
    symlink_count: 0,
    blocked_symlink_paths: [],
    source_retry_count: 0,
    ...overrides,
  }
}

function creatingSnapshot(snapshotId = 'snapshot-01', overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return snapshot(snapshotId, {
    status: 'creating',
    content_root: null,
    manifest_ref: null,
    root_manifest_hash: null,
    verified_at: null,
    error_code: null,
    ...overrides,
  })
}

function failedSnapshot(snapshotId = 'snapshot-01', overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return snapshot(snapshotId, {
    status: 'failed',
    content_root: null,
    manifest_ref: null,
    root_manifest_hash: null,
    verified_at: null,
    error_code: 'SNAPSHOT_SOURCE_BUSY',
    ...overrides,
  })
}

afterEach(async () => {
  setAtomicBeforeRenameHookForTests(null)
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('SnapshotRepository', () => {
  test('creates, reads, lists, and finds snapshots by root hash from authoritative records', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(snapshot(), manifest())
    const rootManifestHash = manifest().root_manifest_hash

    expect((await repository.get('snapshot-01'))?.status).toBe('ready')
    const stored = await repository.get('snapshot-01')
    const storedManifest = await repository.getManifest('snapshot-01')
    expect(storedManifest?.snapshot_id).toBe('snapshot-01')
    expect(stored?.manifest_ref).toBe('.threados/snapshots/snapshot-01/manifest.json')
    expect(JSON.parse(await readFile(
      join(root, stored!.manifest_ref!),
      'utf-8',
    ))).toEqual(storedManifest)
    expect(await repository.list()).toHaveLength(1)
    expect((await repository.findByRootManifestHash(rootManifestHash))?.id).toBe('snapshot-01')
  })

  test('reuses only ready snapshots and validates lookup digests', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(snapshot('snapshot-a'), manifest('snapshot-a'))
    const rootManifestHash = manifest('snapshot-a').root_manifest_hash
    await repository.update('snapshot-a', 'ready', current => ({ ...current, status: 'deleted' }))

    await expect(repository.findByRootManifestHash(rootManifestHash)).resolves.toBeNull()
    await expect(repository.findByRootManifestHash('not-a-digest')).rejects.toThrow()

    await repository.create(snapshot('snapshot-b'), manifest('snapshot-b'))
    await expect(repository.findByRootManifestHash(rootManifestHash))
      .resolves.toMatchObject({ id: 'snapshot-b', status: 'ready' })
  })

  test('uses expected-status CAS and closed status transitions', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(creatingSnapshot(), manifest())

    const ready = await repository.update('snapshot-01', 'creating', current => ({
      ...current,
      status: 'ready',
      content_root: 'C:\\runtime\\snapshots\\local-01\\ready-tree',
      verified_at: timestamp,
    }))
    expect(ready.status).toBe('ready')

    await expect(repository.update('snapshot-01', 'creating', current => current))
      .rejects.toMatchObject({ code: 'RUNTIME_REVISION_CONFLICT' })

    await expect(repository.update('snapshot-01', 'ready', current => ({
      ...current,
      status: 'creating',
      verified_at: null,
    }))).rejects.toMatchObject({ code: 'INVALID_RUNTIME_TRANSITION' })
  })

  test('rejects ready to ready updates even when they are no-ops', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(snapshot(), manifest())

    await expect(repository.update('snapshot-01', 'ready', current => current))
      .rejects.toMatchObject({ code: 'INVALID_RUNTIME_TRANSITION' })
  })

  test.each([
    ['source_root', (current: WorkspaceSnapshot) => ({ ...current, status: 'deleted' as const, source_root: 'D:\\other' })],
    ['exclusion_policy_hash', (current: WorkspaceSnapshot) => ({ ...current, status: 'deleted' as const, exclusion_policy_hash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' })],
    ['content_root', (current: WorkspaceSnapshot) => ({ ...current, status: 'deleted' as const, content_root: 'D:\\runtime\\other' })],
    ['root_manifest_hash', (current: WorkspaceSnapshot) => ({ ...current, status: 'deleted' as const, root_manifest_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' })],
    ['file_count', (current: WorkspaceSnapshot) => ({ ...current, status: 'deleted' as const, file_count: current.file_count + 1 })],
  ] as const)('freezes ready snapshot field %s during delete transition', async (_field, mutate) => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(snapshot(), manifest())

    await expect(repository.update('snapshot-01', 'ready', mutate))
      .rejects.toMatchObject({ code: 'INVALID_RUNTIME_TRANSITION' })
  })

  test('allows a ready snapshot to transition to deleted without mutating frozen fields', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(snapshot(), manifest())

    const deleted = await repository.update('snapshot-01', 'ready', current => ({
      ...current,
      status: 'deleted',
    }))

    expect(deleted.status).toBe('deleted')
    expect(deleted.source_root).toBe('C:\\project')
    expect(deleted.content_root).toBe('C:\\runtime\\snapshots\\local-01\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\tree')
    expect(deleted.root_manifest_hash).toBe(manifest().root_manifest_hash)
    expect(deleted.file_count).toBe(1)
  })

  test('allows failed snapshots to be deleted but freezes their failure evidence', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(failedSnapshot(), manifest())

    await expect(repository.update('snapshot-01', 'failed', current => ({
      ...current,
      status: 'deleted',
      error_code: 'DIFFERENT_FAILURE',
    }))).rejects.toMatchObject({ code: 'INVALID_RUNTIME_TRANSITION' })

    const deleted = await repository.update('snapshot-01', 'failed', current => ({
      ...current,
      status: 'deleted',
    }))
    expect(deleted.status).toBe('deleted')
    expect(deleted.error_code).toBe('SNAPSHOT_SOURCE_BUSY')
  })

  test('rejects create when metadata and manifest identities disagree', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await expect(repository.create(snapshot('snapshot-a'), manifest('snapshot-b')))
      .rejects.toThrow('Snapshot identity mismatch')
  })

  test('preserves prior bytes and cleans temporary files when atomic metadata write fails', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(creatingSnapshot(), manifest())
    const pointerPath = join(root, '.threados', 'snapshots', 'snapshot-01', 'current.json')
    const before = await readFile(pointerPath, 'utf-8')
    const generationsPath = join(root, '.threados', 'snapshots', 'snapshot-01', 'generations')
    const generationsBefore = await readdir(generationsPath)

    setAtomicBeforeRenameHookForTests(async target => {
      if (target === pointerPath) throw new Error('injected snapshot pointer rename failure')
    })

    await expect(repository.update('snapshot-01', 'creating', current => ({
      ...current,
      status: 'failed',
      error_code: 'SNAPSHOT_SOURCE_BUSY',
    }))).rejects.toThrow('injected snapshot pointer rename failure')

    expect(await readFile(pointerPath, 'utf-8')).toBe(before)
    expect(await readdir(generationsPath)).toEqual(generationsBefore)
    expect((await readdir(join(root, '.threados', 'snapshots', 'snapshot-01')))
      .filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
  })

  test('never exposes an unpublished generation to a concurrent reader', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await repository.create(creatingSnapshot(), manifest())
    const update = repository.update('snapshot-01', 'creating', current => ({
      ...current,
      status: 'ready',
      content_root: 'C:\\runtime\\snapshots\\local-01\\ready-tree',
      verified_at: timestamp,
    }))
    const concurrentReads = Array.from({ length: 12 }, () => repository.get('snapshot-01'))
    const [, ...observed] = await Promise.all([update, ...concurrentReads])

    for (const record of observed) {
      expect(record?.status === 'creating' || record?.status === 'ready').toBe(true)
      if (record?.status === 'creating') {
        expect(record.root_manifest_hash).toBeNull()
        expect(record.manifest_ref).toBeNull()
      } else {
        expect(record?.root_manifest_hash).toBe(manifest().root_manifest_hash)
        expect(record?.manifest_ref).toBe('.threados/snapshots/snapshot-01/manifest.json')
      }
    }
  })

  test('list rebuilds from records even if a sibling file is malformed', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(snapshot('snapshot-01'), manifest('snapshot-01'))
    await repository.create(snapshot('snapshot-02'), manifest('snapshot-02'))
    await writeFile(join(root, '.threados', 'snapshots', 'not-a-directory.json'), '{}')

    expect((await repository.list()).map(entry => entry.id)).toEqual(['snapshot-01', 'snapshot-02'])
  })

  test('get returns null only when the snapshot directory is absent', async () => {
    const repository = new SnapshotRepository(await tempRoot())
    await expect(repository.get('missing-snapshot')).resolves.toBeNull()
    await expect(repository.getManifest('missing-snapshot')).resolves.toBeNull()
  })

  test('throws SnapshotRecordCorruptError when snapshot directory is partial or tampered', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(snapshot('snapshot-01'), manifest('snapshot-01'))

    const pointer = JSON.parse(await readFile(join(root, '.threados', 'snapshots', 'snapshot-01', 'current.json'), 'utf-8')) as { generation: string }
    await rm(join(root, '.threados', 'snapshots', 'snapshot-01', 'generations', pointer.generation, 'manifest.json'))
    await expect(repository.get('snapshot-01')).rejects.toBeInstanceOf(SnapshotRecordCorruptError)
    await expect(repository.getManifest('snapshot-01')).rejects.toMatchObject({
      code: 'SNAPSHOT_RECORD_CORRUPT',
    })
  })

  test('throws SnapshotRecordCorruptError for malformed metadata and manifest mismatches', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(snapshot('snapshot-01'), manifest('snapshot-01'))

    const pointer = JSON.parse(await readFile(join(root, '.threados', 'snapshots', 'snapshot-01', 'current.json'), 'utf-8')) as { generation: string }
    await writeFile(join(root, '.threados', 'snapshots', 'snapshot-01', 'generations', pointer.generation, 'metadata.json'), '{bad-json')
    await expect(repository.get('snapshot-01')).rejects.toMatchObject({
      code: 'SNAPSHOT_RECORD_CORRUPT',
    })
    await expect(repository.update('snapshot-01', 'ready', current => ({
      ...current,
      status: 'deleted',
    }))).rejects.toMatchObject({ code: 'SNAPSHOT_RECORD_CORRUPT' })

    await repository.create(snapshot('snapshot-02'), manifest('snapshot-02'))
    const pointer02 = JSON.parse(await readFile(join(root, '.threados', 'snapshots', 'snapshot-02', 'current.json'), 'utf-8')) as { generation: string }
    const path = join(root, '.threados', 'snapshots', 'snapshot-02', 'generations', pointer02.generation, 'manifest.json')
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as SnapshotManifest
    await writeFile(path, `${JSON.stringify({ ...parsed, snapshot_id: 'different-id' }, null, 2)}\n`)
    await expect(repository.getManifest('snapshot-02')).rejects.toMatchObject({
      code: 'SNAPSHOT_RECORD_CORRUPT',
    })
  })

  test('rejects generation manifest entry tampering even when its declared hash is unchanged', async () => {
    const root = await tempRoot()
    const repository = new SnapshotRepository(root)
    await repository.create(snapshot(), manifest())

    const pointer = JSON.parse(await readFile(join(root, '.threados', 'snapshots', 'snapshot-01', 'current.json'), 'utf-8')) as { generation: string }
    const path = join(root, '.threados', 'snapshots', 'snapshot-01', 'generations', pointer.generation, 'manifest.json')
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as SnapshotManifest
    await writeFile(path, `${JSON.stringify({
      ...parsed,
      entries: parsed.entries.map(entry => ({ ...entry, size_bytes: entry.size_bytes + 1 })),
    }, null, 2)}\n`)

    await expect(repository.get('snapshot-01')).rejects.toMatchObject({
      code: 'SNAPSHOT_RECORD_CORRUPT',
    })
  })

  test('rejects an escaping snapshots directory symlink', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await mkdir(join(root, '.threados'), { recursive: true })
    await symlink(outside, join(root, '.threados', 'snapshots'), process.platform === 'win32' ? 'junction' : 'dir')

    const repository = new SnapshotRepository(root)
    await expect(repository.list()).rejects.toThrow('allowed root')
  })
})
