import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { createDefaultWorkspaceConfig } from '@/lib/workspaces/config-schema'
import { writeWorkspaceConfig } from '@/lib/workspaces/config'
import {
  ensureLocalWorkspace,
  getLocalWorkspaceStatePath,
  readLocalWorkspace,
  writeLocalWorkspace,
} from './workspace'

const roots: string[] = []

async function layout(): Promise<{ root: string; project: string; runtime: string }> {
  const root = await mkdtemp(join(tmpdir(), 'threados-local-workspace-'))
  roots.push(root)
  const project = join(root, 'project')
  const runtime = join(root, 'runtime')
  await Promise.all([mkdir(project), mkdir(runtime)])
  return { root, project, runtime }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local workspace runtime resolution', () => {
  test('enriches a workspace with an external root and stable exclusion hash', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)

    const first = await readLocalWorkspace(project)
    const second = await readLocalWorkspace(project)
    expect(first.id).toBe(basename(project))
    expect(first.runtimeDataRoot).toBe(runtime)
    expect(first.runtimeNamespace).toMatch(new RegExp(`^${first.id}-[a-f0-9]{16}$`))
    expect(first.snapshotRoot).toBe(join(runtime, 'snapshots', first.runtimeNamespace))
    expect(first.surfaceWorkspaceRoot).toBe(join(runtime, 'workspaces', first.runtimeNamespace))
    expect(first.exclusionPolicyHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(second.exclusionPolicyHash).toBe(first.exclusionPolicyHash)
  })

  test('upgrades and persists a legacy local-workspace record additively', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify({
      id: 'legacy-workspace',
      label: 'Legacy',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
      runtimeTarget: 'node',
    }))

    const workspace = await ensureLocalWorkspace(project)
    expect(workspace.id).toBe('legacy-workspace')
    expect(workspace.workspaceConfigVersion).toBe(1)
    expect(workspace.workspaceProvider).toBe('auto')
    const persisted = JSON.parse(await readFile(getLocalWorkspaceStatePath(project), 'utf8'))
    expect(persisted.runtimeDataRoot).toBe(runtime)
    expect(persisted.exclusionPolicyHash).toBe(workspace.exclusionPolicyHash)
  })

  test('keeps a legacy ID with spaces while deriving a safe runtime namespace', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify({
      id: 'Client Workspace',
      label: 'Client Workspace',
      runtimeTarget: 'desktop',
    }))

    const workspace = await readLocalWorkspace(project)
    expect(workspace.id).toBe('Client Workspace')
    expect(workspace.snapshotRoot).toMatch(/workspace-[a-f0-9]{16}-[a-f0-9]{16}$/)
  })

  test('fills missing valid identity fields from defaults individually', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify({
      id: 'legacy-workspace',
      extraField: 'ignored',
    }))

    const workspace = await readLocalWorkspace(project)
    expect(workspace.id).toBe('legacy-workspace')
    expect(workspace.label).toBe(basename(project))
    expect(workspace.runtimeTarget).toBe('desktop')
  })

  test('rejects non-object local workspace JSON', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify('invalid'))

    await expect(readLocalWorkspace(project)).rejects.toThrow('local-workspace.json')
  })

  test('rejects malformed local workspace identity field types', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify({
      id: 42,
      label: ['wrong'],
    }))

    await expect(readLocalWorkspace(project)).rejects.toThrow('local-workspace.json')
  })

  test('rejects invalid local workspace datetimes and runtime target', async () => {
    const { project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    await writeFile(getLocalWorkspaceStatePath(project), JSON.stringify({
      createdAt: 'not-a-date',
      lastOpenedAt: 'also-not-a-date',
      runtimeTarget: 'browser',
    }))

    await expect(readLocalWorkspace(project)).rejects.toThrow('local-workspace.json')
  })

  test('does not read local workspace state through an escaping symlink', async () => {
    const { root, project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados', 'state'), { recursive: true })
    const outsideState = join(root, 'outside-workspace.json')
    await writeFile(outsideState, JSON.stringify({ id: 'outside' }))
    await symlink(outsideState, getLocalWorkspaceStatePath(project), 'file')

    await expect(readLocalWorkspace(project)).rejects.toThrow('allowed root')
  })

  test('does not write local workspace state through an escaping state directory symlink', async () => {
    const { root, project, runtime } = await layout()
    const config = createDefaultWorkspaceConfig()
    config.runtime_data_root = runtime
    await writeWorkspaceConfig(project, config)
    await mkdir(join(project, '.threados'), { recursive: true })
    const outsideStateDir = join(root, 'outside-state')
    await mkdir(outsideStateDir)
    await symlink(
      outsideStateDir,
      join(project, '.threados', 'state'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const workspace = await readLocalWorkspace(project)
    await expect(writeLocalWorkspace(project, workspace)).rejects.toThrow('allowed root')
    expect(existsSync(join(outsideStateDir, 'local-workspace.json'))).toBe(false)
  })
})
