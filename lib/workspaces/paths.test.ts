import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, win32 } from 'path'
import {
  resolveDefaultRuntimeDataRoot,
  resolveRuntimeDataRoot,
  resolveWorkspaceRuntimePaths,
} from './paths'

const roots: string[] = []

async function tempLayout(): Promise<{ root: string; project: string; runtime: string }> {
  const root = await mkdtemp(join(tmpdir(), 'threados-workspace-paths-'))
  roots.push(root)
  const project = join(root, 'project')
  const runtime = join(root, 'runtime')
  await Promise.all([mkdir(project), mkdir(runtime)])
  return { root, project, runtime }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('runtime data root resolution', () => {
  test('uses LOCALAPPDATA on Windows', () => {
    expect(resolveDefaultRuntimeDataRoot({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\operator\\AppData\\Local' },
      homeDirectory: 'C:\\Users\\operator',
    })).toBe(win32.join('C:\\Users\\operator\\AppData\\Local', 'thredOS', 'runtime'))
  })

  test('uses XDG_DATA_HOME or the Linux/WSL home fallback', () => {
    expect(resolveDefaultRuntimeDataRoot({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/var/data' },
      homeDirectory: '/home/operator',
    })).toBe('/var/data/thredos')
    expect(resolveDefaultRuntimeDataRoot({
      platform: 'linux',
      env: {},
      homeDirectory: '/home/operator',
    })).toBe('/home/operator/.local/share/thredos')
  })

  test('accepts a real external override and derives workspace namespaces', async () => {
    const { project, runtime } = await tempLayout()
    const resolved = await resolveRuntimeDataRoot({ canonicalRoot: project, override: runtime })
    const paths = resolveWorkspaceRuntimePaths(resolved, 'workspace-01', project)

    expect(resolved).toBe(resolve(runtime))
    expect(paths.workspaceNamespace).toMatch(/^workspace-01-[a-f0-9]{16}$/)
    expect(paths.snapshotsRoot).toBe(join(resolved, 'snapshots', paths.workspaceNamespace))
    expect(paths.workspacesRoot).toBe(join(resolved, 'workspaces', paths.workspaceNamespace))
  })

  test('rejects overrides inside, equal to, or containing the canonical project', async () => {
    const { root, project } = await tempLayout()
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: join(project, 'runtime'),
    })).rejects.toThrow('overlap')
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: project,
    })).rejects.toThrow('overlap')
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: root,
    })).rejects.toThrow('overlap')
  })

  test('rejects runtime copies beneath any .threados directory', async () => {
    const { root, project } = await tempLayout()
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: join(root, 'elsewhere', '.threados', 'runtime'),
    })).rejects.toThrow('.threados')
  })

  test('compares both lexical and real paths across symlinks', async () => {
    const { root, project, runtime } = await tempLayout()
    const externalLinkToProject = join(root, 'project-link')
    await symlink(project, externalLinkToProject, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: externalLinkToProject,
    })).rejects.toThrow('overlap')

    const insideLinkToRuntime = join(project, 'runtime-link')
    await symlink(runtime, insideLinkToRuntime, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolveRuntimeDataRoot({
      canonicalRoot: project,
      override: insideLinkToRuntime,
    })).rejects.toThrow('overlap')
  })

  test('maps legacy unsafe workspace IDs to a stable file-safe namespace', () => {
    const first = resolveWorkspaceRuntimePaths('C:\\runtime', 'Client Workspace', 'C:\\clients\\a\\app')
    const second = resolveWorkspaceRuntimePaths('C:\\runtime', 'Client Workspace', 'C:\\clients\\a\\app')
    expect(first).toEqual(second)
    expect(first.snapshotsRoot).toMatch(/workspace-[a-f0-9]{16}-[a-f0-9]{16}$/)
    expect(() => resolveWorkspaceRuntimePaths('C:\\runtime', '', 'C:\\clients\\a\\app'))
      .toThrow('must not be empty')
  })

  test('keeps same-basename projects in distinct runtime namespaces', () => {
    const first = resolveWorkspaceRuntimePaths('C:\\runtime', 'app', 'C:\\clients\\a\\app')
    const second = resolveWorkspaceRuntimePaths('C:\\runtime', 'app', 'C:\\clients\\b\\app')
    expect(first.workspaceNamespace).not.toBe(second.workspaceNamespace)
    expect(first.workspacesRoot).not.toBe(second.workspacesRoot)
  })
})
