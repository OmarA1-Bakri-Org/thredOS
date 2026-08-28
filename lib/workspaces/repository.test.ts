import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SurfaceWorkspace } from './schema'
import { WorkspaceRepository } from './repository'
import { setAtomicBeforeRenameHookForTests } from '@/lib/fs/atomic'

const roots: string[] = []
const timestamp = '2026-08-26T00:00:00.000Z'

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'threados-workspace-repo-'))
  roots.push(root)
  return root
}

function workspace(id = 'workspace-01'): SurfaceWorkspace {
  return {
    schema_version: 1,
    id,
    revision: 0,
    workflow_run_id: 'run-01',
    attempt_id: 'attempt-01',
    surface_id: 'surface-01',
    snapshot_id: 'snapshot-01',
    provider: 'copy',
    isolation_label: 'THREADOS_SCOPED',
    root_path: 'C:\\runtime\\workspace-01',
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

describe('WorkspaceRepository', () => {
  test('creates, lists, and revision-checks workspace records atomically', async () => {
    const repository = new WorkspaceRepository(await tempRoot())
    await repository.create(workspace())
    expect((await repository.get('workspace-01'))?.status).toBe('planned')
    expect(await repository.list()).toHaveLength(1)

    const updated = await repository.update('workspace-01', 0, current => ({
      ...current,
      status: 'materializing',
    }))
    expect(updated.revision).toBe(1)
    expect(updated.status).toBe('materializing')
    await expect(repository.update('workspace-01', 0, current => current))
      .rejects.toMatchObject({ code: 'RUNTIME_REVISION_CONFLICT' })
  })

  test('rejects creation with a nonzero revision', async () => {
    const repository = new WorkspaceRepository(await tempRoot())
    await expect(repository.create({ ...workspace(), revision: 1 }))
      .rejects.toMatchObject({ code: 'RUNTIME_REVISION_CONFLICT' })
  })

  test('does not read an index through an escaping parent directory', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await mkdir(join(root, '.threados'), { recursive: true })
    await writeFile(join(outside, 'index.json'), JSON.stringify({
      schema_version: 1,
      revision: 0,
      workspaces: [],
    }))
    await symlink(outside, join(root, '.threados', 'workspaces'), process.platform === 'win32' ? 'junction' : 'dir')

    const repository = new WorkspaceRepository(root)
    await expect(repository.list()).rejects.toThrow('allowed root')
  })

  test('rebuilds a deleted derived index from canonical workspace records', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    await repository.create(workspace('workspace-rebuild'))
    await unlink(join(root, '.threados', 'workspaces', 'index.json'))

    expect((await repository.list()).map(item => item.id)).toEqual(['workspace-rebuild'])
    expect(JSON.parse(await Bun.file(join(root, '.threados', 'workspaces', 'index.json')).text()))
      .toMatchObject({ workspaces: [{ id: 'workspace-rebuild' }] })
  })

  test('rejects invalid lifecycle transitions and identity mutation', async () => {
    const repository = new WorkspaceRepository(await tempRoot())
    await repository.create(workspace())

    await expect(repository.update('workspace-01', 0, current => ({
      ...current,
      status: 'active',
      manifest_hash: `sha256:${'a'.repeat(64)}`,
      ready_at: timestamp,
    }))).rejects.toMatchObject({ code: 'INVALID_RUNTIME_TRANSITION' })

    await expect(repository.update('workspace-01', 0, current => ({
      ...current,
      attempt_id: 'attempt-other',
    }))).rejects.toMatchObject({ code: 'RUNTIME_IDENTITY_MUTATION' })
  })

  test('rebuilds retained-byte records without trusting a stale index', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    await repository.create(workspace('workspace-retained'))
    await repository.update('workspace-retained', 0, current => ({
      ...current,
      status: 'materializing',
    }))
    await repository.update('workspace-retained', 1, current => ({
      ...current,
      status: 'ready',
      manifest_hash: `sha256:${'b'.repeat(64)}`,
      file_count: 1,
      total_bytes: 12,
      ready_at: timestamp,
    }))
    await repository.update('workspace-retained', 2, current => ({ ...current, status: 'retained' }))

    await writeFile(join(root, '.threados', 'workspaces', 'index.json'), JSON.stringify({
      schema_version: 1,
      revision: 99,
      workspaces: [],
    }))

    expect(await repository.rebuildIndex()).toMatchObject({
      workspaces: [{ id: 'workspace-retained', total_bytes: 12, status: 'retained' }],
    })
  })

  test('never resurrects a missing canonical record from the derived index', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    await repository.create(workspace())
    await unlink(join(root, '.threados', 'workspaces', 'records', 'workspace-01.json'))

    expect(await repository.get('workspace-01')).toBeNull()
    expect(await repository.list()).toEqual([])
  })

  test('fails closed when the entire canonical record directory is lost after migration', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    await repository.create(workspace())
    await rm(join(root, '.threados', 'workspaces', 'records'), { recursive: true, force: true })

    await expect(repository.get('workspace-01'))
      .rejects.toMatchObject({ code: 'WORKSPACE_RECORDS_MISSING' })
    await expect(repository.list())
      .rejects.toMatchObject({ code: 'WORKSPACE_RECORDS_MISSING' })
  })

  test('rebuilds same-revision index content drift from canonical records', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    await repository.create(workspace())
    const indexPath = join(root, '.threados', 'workspaces', 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      workspaces: SurfaceWorkspace[]
    }
    index.workspaces[0]!.retention_policy = 'retain_always'
    await writeFile(indexPath, JSON.stringify(index))

    expect((await repository.list())[0]?.retention_policy).toBe('retain_until_applied')
    expect(JSON.parse(await readFile(indexPath, 'utf8')).workspaces[0].retention_policy)
      .toBe('retain_until_applied')
  })

  test('canonical create succeeds when only the derived index update fails', async () => {
    const root = await tempRoot()
    const repository = new WorkspaceRepository(root)
    const indexPath = join(root, '.threados', 'workspaces', 'index.json')
    setAtomicBeforeRenameHookForTests(async target => {
      if (target === indexPath) throw new Error('injected derived index failure')
    })

    await expect(repository.create(workspace())).resolves.toBeUndefined()
    expect((await repository.get('workspace-01'))?.id).toBe('workspace-01')
  })

  test('legacy index migration publishes canonical records only as one complete directory', async () => {
    const root = await tempRoot()
    const workspaceRoot = join(root, '.threados', 'workspaces')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'index.json'), JSON.stringify({
      schema_version: 1,
      revision: 1,
      workspaces: [workspace('workspace-a'), workspace('workspace-b')],
    }))
    const repository = new WorkspaceRepository(root)
    setAtomicBeforeRenameHookForTests(async target => {
      if (target.endsWith('workspace-b.json') && target.includes('records-migration-')) {
        throw new Error('injected migration failure')
      }
    })

    await expect(repository.create(workspace('workspace-c'))).rejects.toThrow('injected migration failure')
    await expect(Bun.file(join(workspaceRoot, 'records')).exists()).resolves.toBe(false)
    expect((await repository.list()).map(item => item.id)).toEqual(['workspace-a', 'workspace-b'])

    setAtomicBeforeRenameHookForTests(null)
    await repository.create(workspace('workspace-c'))
    expect((await repository.list()).map(item => item.id))
      .toEqual(['workspace-a', 'workspace-b', 'workspace-c'])
  })

  test('verified workspace evidence is immutable across later lifecycle transitions', async () => {
    const repository = new WorkspaceRepository(await tempRoot())
    await repository.create(workspace())
    await repository.update('workspace-01', 0, current => ({ ...current, status: 'materializing' }))
    const ready = await repository.update('workspace-01', 1, current => ({
      ...current,
      status: 'ready',
      manifest_hash: `sha256:${'c'.repeat(64)}`,
      file_count: 1,
      total_bytes: 12,
      ready_at: timestamp,
    }))

    await expect(repository.update(ready.id, ready.revision, current => ({
      ...current,
      status: 'retained',
      total_bytes: 13,
    }))).rejects.toMatchObject({ code: 'RUNTIME_IDENTITY_MUTATION' })
  })
})
