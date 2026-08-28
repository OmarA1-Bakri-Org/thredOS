import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { WorkspaceLimits } from '../config-schema'
import { createSnapshotManifest } from '../manifest'
import { WorkspaceRepository } from '../repository'
import { SnapshotRepository } from '../snapshot-repository'
import type { SnapshotEntry, SurfaceWorkspace, WorkspaceSnapshot } from '../schema'
import { CopyWorkspaceProvider, copyWorkspaceTreePath } from './copy'
import { setAtomicBeforeRenameHookForTests } from '@/lib/fs/atomic'

const roots: string[] = []
const timestamp = '2026-08-28T00:00:00.000Z'
const limits: WorkspaceLimits = {
  max_active: 5,
  max_bytes_each: 1_000_000,
  max_total_retained_bytes: 5_000_000,
  max_files: 100,
}

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function fixture(options: { symlink?: boolean; directorySymlink?: boolean } = {}) {
  const canonicalRoot = await tempRoot('threados-copy-canonical-')
  const storageRoot = await tempRoot('threados-copy-storage-')
  const snapshotsRoot = join(storageRoot, 'snapshots')
  const workspacesRoot = join(storageRoot, 'workspaces')
  let tree = join(snapshotsRoot, 'snapshot-01', 'tree')
  await mkdir(join(tree, 'src'), { recursive: true })
  await writeFile(join(tree, 'src', 'index.ts'), 'export const value = 1\n')
  const entries: SnapshotEntry[] = [
    { path: 'src', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null },
    {
      path: 'src/index.ts',
      kind: 'file',
      sha256: `sha256:${new Bun.CryptoHasher('sha256').update('export const value = 1\n').digest('hex')}`,
      size_bytes: Buffer.byteLength('export const value = 1\n'),
      mode: 0o644,
      symlink_target: null,
    },
  ]
  if (options.symlink) {
    await symlink('index.ts', join(tree, 'src', 'link.ts'), 'file')
    entries.push({
      path: 'src/link.ts',
      kind: 'symlink',
      sha256: null,
      size_bytes: 0,
      mode: 0o777,
      symlink_target: 'index.ts',
    })
  }
  if (options.directorySymlink) {
    await symlink('src', join(tree, 'src-link'), 'dir')
    entries.push({
      path: 'src-link',
      kind: 'symlink',
      sha256: null,
      size_bytes: 0,
      mode: 0o777,
      symlink_target: 'src',
    })
  }
  const manifest = createSnapshotManifest('snapshot-01', entries)
  const addressedContainer = join(
    snapshotsRoot,
    manifest.root_manifest_hash.slice('sha256:'.length),
  )
  await rename(dirname(tree), addressedContainer)
  tree = join(addressedContainer, 'tree')
  await chmod(join(tree, 'src', 'index.ts'), 0o444)
  await chmod(join(tree, 'src'), 0o555)
  await chmod(tree, 0o555)
  const snapshot: WorkspaceSnapshot = {
    schema_version: 1,
    id: 'snapshot-01',
    local_workspace_id: 'local-01',
    workflow_run_id: 'run-01',
    source_root: canonicalRoot,
    content_root: tree,
    manifest_ref: '.threados/snapshots/snapshot-01/manifest.json',
    status: 'ready',
    root_manifest_hash: manifest.root_manifest_hash,
    exclusion_policy_hash: `sha256:${'e'.repeat(64)}`,
    file_count: 1,
    total_bytes: Buffer.byteLength('export const value = 1\n'),
    git_head: null,
    git_dirty: null,
    created_at: timestamp,
    verified_at: timestamp,
    error_code: null,
    directory_count: 1,
    symlink_count: Number(Boolean(options.symlink)) + Number(Boolean(options.directorySymlink)),
    blocked_symlink_paths: [],
    source_retry_count: 0,
  }
  const repository = new WorkspaceRepository(canonicalRoot)
  const snapshotRepository = new SnapshotRepository(canonicalRoot)
  await snapshotRepository.create(snapshot, manifest)
  return {
    canonicalRoot,
    workspacesRoot,
    snapshotsRoot,
    tree,
    snapshot,
    manifest,
    repository,
    snapshotRepository,
  }
}

function planned(root: string, id = 'workspace-01'): SurfaceWorkspace {
  return {
    schema_version: 1,
    id,
    revision: 0,
    workflow_run_id: 'run-01',
    attempt_id: `attempt-${id}`,
    surface_id: `surface-${id}`,
    snapshot_id: 'snapshot-01',
    provider: 'copy',
    isolation_label: 'THREADOS_SCOPED',
    root_path: copyWorkspaceTreePath(root, 'run-01', id),
    status: 'planned',
    retention_policy: 'retain_until_applied',
    manifest_hash: null,
    file_count: 0,
    total_bytes: 0,
    created_at: timestamp,
    ready_at: null,
    cleaned_at: null,
    error_code: null,
  }
}

afterEach(async () => {
  setAtomicBeforeRenameHookForTests(null)
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('CopyWorkspaceProvider', () => {
  test('copies only a verified immutable snapshot into a distinct THREADOS_SCOPED tree', async () => {
    const context = await fixture({ symlink: true, directorySymlink: true })
    await context.repository.create(planned(context.workspacesRoot))
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      now: () => new Date(timestamp),
      createId: () => 'copy-01',
    })

    const ready = await provider.provision({
      workspaceId: 'workspace-01',
      snapshot: context.snapshot,
      manifest: context.manifest,
      limits,
    })

    expect(ready.status).toBe('ready')
    expect(ready.isolation_label).toBe('THREADOS_SCOPED')
    expect(ready.manifest_hash).toBe(context.manifest.root_manifest_hash)
    expect(await readFile(join(ready.root_path, 'src', 'index.ts'), 'utf8'))
      .toBe('export const value = 1\n')
    expect(await readlink(join(ready.root_path, 'src', 'link.ts'))).toBe('index.ts')
    expect((await lstat(join(ready.root_path, 'src-link'))).isSymbolicLink()).toBe(true)
    const copiedIdentity = await lstat(join(ready.root_path, 'src', 'index.ts'), { bigint: true })
    const sourceIdentity = await lstat(join(context.tree, 'src', 'index.ts'), { bigint: true })
    expect(copiedIdentity.dev === sourceIdentity.dev && copiedIdentity.ino === sourceIdentity.ino).toBe(false)
    expect(await Bun.file(join(dirname(ready.root_path), '.threados', 'manifest.json')).exists()).toBe(false)
    expect((await provider.inspect('workspace-01')).manifestValid).toBe(true)
  })

  test('rejects a live canonical tree or mutable/unverified source as the baseline', async () => {
    const context = await fixture()
    await context.repository.create(planned(context.workspacesRoot))
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
    })
    await chmod(context.tree, 0o755)

    await expect(provider.provision({
      workspaceId: 'workspace-01',
      snapshot: { ...context.snapshot, content_root: context.canonicalRoot },
      manifest: context.manifest,
      limits,
    })).rejects.toMatchObject({ code: 'WORKSPACE_SOURCE_INVALID' })
    expect((await context.repository.get('workspace-01'))?.status).toBe('failed')
  })

  test('cleans unique staging content and persists failure evidence after a partial copy', async () => {
    const context = await fixture()
    await context.repository.create(planned(context.workspacesRoot))
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      createId: () => 'partial-copy',
      afterEntryCopied: () => { throw new Error('injected copy failure') },
    })

    await expect(provider.provision({
      workspaceId: 'workspace-01',
      snapshot: context.snapshot,
      manifest: context.manifest,
      limits,
    })).rejects.toThrow('injected copy failure')

    expect((await context.repository.get('workspace-01'))).toMatchObject({
      status: 'failed',
      error_code: 'WORKSPACE_COPY_FAILED',
    })
    expect(await Bun.file(join(context.workspacesRoot, 'run-01', 'staging-workspace-01-partial-copy')).exists()).toBe(false)
    expect(await Bun.file(join(context.workspacesRoot, 'run-01', 'workspace-01')).exists()).toBe(false)
  })

  test('never deletes a destination created by a promotion race it does not own', async () => {
    const context = await fixture()
    const record = planned(context.workspacesRoot)
    await context.repository.create(record)
    const racedContainer = dirname(record.root_path)
    let created = false
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      createId: () => 'promotion-race',
      afterEntryCopied: async entry => {
        if (created || entry.kind !== 'file') return
        created = true
        await mkdir(racedContainer, { recursive: true })
        await writeFile(join(racedContainer, 'sentinel.txt'), 'foreign destination')
      },
    })

    await expect(provider.provision({
      workspaceId: record.id,
      snapshot: context.snapshot,
      manifest: context.manifest,
      limits,
    })).rejects.toThrow()
    expect(await readFile(join(racedContainer, 'sentinel.txt'), 'utf8')).toBe('foreign destination')
    expect((await context.repository.get(record.id))?.status).toBe('failed')
  })

  test('surfaces failure-persistence errors as recovery-required truth', async () => {
    const context = await fixture()
    await context.repository.create(planned(context.workspacesRoot))
    const recordPath = join(
      context.canonicalRoot,
      '.threados',
      'workspaces',
      'records',
      'workspace-01.json',
    )
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      afterEntryCopied: () => {
        setAtomicBeforeRenameHookForTests(async target => {
          if (target === recordPath) throw new Error('injected failure persistence error')
        })
        throw new Error('injected copy failure')
      },
    })

    await expect(provider.provision({
      workspaceId: 'workspace-01',
      snapshot: context.snapshot,
      manifest: context.manifest,
      limits,
    })).rejects.toMatchObject({ code: 'WORKSPACE_RECOVERY_REQUIRED' })
    expect((await context.repository.get('workspace-01'))?.status).toBe('materializing')
  })

  test('refuses to destroy an active workspace and cleans a frozen workspace truthfully', async () => {
    const context = await fixture()
    await context.repository.create(planned(context.workspacesRoot))
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      now: () => new Date(timestamp),
    })
    const ready = await provider.provision({
      workspaceId: 'workspace-01',
      snapshot: context.snapshot,
      manifest: context.manifest,
      limits,
    })
    const active = await context.repository.update(ready.id, ready.revision, current => ({ ...current, status: 'active' }))
    await expect(provider.destroy(active.id)).rejects.toMatchObject({ code: 'WORKSPACE_ACTIVE' })

    const frozen = await provider.freeze(active.id)
    expect(frozen.status).toBe('frozen')
    await provider.destroy(frozen.id)
    expect((await context.repository.get(frozen.id))?.status).toBe('cleaned')
    expect(await Bun.file(dirname(frozen.root_path)).exists()).toBe(false)
  })

  test('leaves durable cleaning intent when cleaned-state persistence fails and resumes on retry', async () => {
    const context = await fixture()
    await context.repository.create(planned(context.workspacesRoot))
    const provider = new CopyWorkspaceProvider({
      repository: context.repository,
      snapshotRepository: context.snapshotRepository,
      workspacesRoot: context.workspacesRoot,
      snapshotsRoot: context.snapshotsRoot,
      now: () => new Date(timestamp),
    })
    const ready = await provider.provision({
      workspaceId: 'workspace-01', snapshot: context.snapshot, manifest: context.manifest, limits,
    })
    const frozen = await provider.freeze(ready.id)
    const recordPath = join(
      context.canonicalRoot,
      '.threados',
      'workspaces',
      'records',
      'workspace-01.json',
    )
    let recordWrites = 0
    setAtomicBeforeRenameHookForTests(async target => {
      if (target === recordPath && (recordWrites += 1) === 2) {
        throw new Error('injected cleaned-state failure')
      }
    })

    await expect(provider.destroy(frozen.id))
      .rejects.toMatchObject({ code: 'WORKSPACE_RECOVERY_REQUIRED' })
    expect((await context.repository.get(frozen.id))?.status).toBe('cleaning')
    expect(await Bun.file(dirname(frozen.root_path)).exists()).toBe(false)

    setAtomicBeforeRenameHookForTests(null)
    await provider.destroy(frozen.id)
    expect((await context.repository.get(frozen.id))?.status).toBe('cleaned')
  })
})
