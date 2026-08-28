import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SurfaceWorkspace } from './schema'
import { WorkspaceRepository } from './repository'

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
    retention_policy: 'retain_on_failure',
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
})
