// Exercise the same CommonJS module loaded by Electron's main process.
const { describe, expect, test } = require('bun:test')
const { mkdtemp, mkdir, realpath, rm } = require('fs/promises')
const { tmpdir } = require('os')
const path = require('path')
const {
  safeId, inspectionUrl, validatedRoot, verifyActualDirectory, openVerifiedWorkspace,
} = require('./workspace-open.cjs')

function inspection(root, changes = {}) {
  return {
    schema_version: 1,
    workspace: {
      id: 'workspace-1', workflow_run_id: 'run-1', provider: 'copy',
      isolation_label: 'THREADOS_SCOPED', status: 'retained', root_path: root,
      ...changes,
    },
    verification: { exists: true }, diagnostics: [],
  }
}

describe('desktop workspace Explorer bridge', () => {
  test('accepts only file-safe identifiers and a loopback inspection API', () => {
    expect(safeId('workspace-1')).toBe('workspace-1')
    for (const bad of ['../project', 'a/b', 'a\\b', '.', 'CON', 'name.', 'name ', 'x?y', '']) {
      expect(() => safeId(bad)).toThrow()
    }
    expect(inspectionUrl('http://127.0.0.1:3010/app', 'workspace-1'))
      .toBe('http://127.0.0.1:3010/api/workspaces/workspace-1')
    expect(() => inspectionUrl('https://example.com/app', 'workspace-1')).toThrow()
    expect(() => inspectionUrl('http://127.0.0.1:3010.evil.test/app', 'workspace-1')).toThrow()
  })

  test('rejects API identity, provider, status, verification, and root mismatches', () => {
    const canonical = path.resolve('project')
    const root = path.resolve('runtime', 'workspaces', 'namespace', 'run-1', 'workspace-1', 'tree')
    expect(validatedRoot(inspection(root), 'workspace-1', canonical)).toBe(root)
    expect(() => validatedRoot(inspection(root, { id: 'other' }), 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot(inspection(root, { provider: 'container' }), 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot(inspection(root, { status: 'cleaned' }), 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot({ ...inspection(root), verification: { exists: false } }, 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot({ ...inspection(root), diagnostics: [{ code: 'WORKSPACE_STORAGE_UNSAFE' }] }, 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot(inspection(path.join(canonical, 'workspaces', 'namespace', 'run-1', 'workspace-1', 'tree')), 'workspace-1', canonical)).toThrow()
    expect(() => validatedRoot(inspection(path.resolve('runtime', 'workspaces', 'namespace', 'run-2', 'workspace-1', 'tree')), 'workspace-1', canonical)).toThrow()
  })

  test('opens only the verified directory returned by the matching local API', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'thredos-explorer-'))
    try {
      const canonical = path.join(fixture, 'project')
      const root = path.join(fixture, 'runtime', 'workspaces', 'namespace', 'run-1', 'workspace-1', 'tree')
      await mkdir(canonical)
      await mkdir(root, { recursive: true })
      let opened = null
      await openVerifiedWorkspace({
        id: 'workspace-1', startUrl: 'http://127.0.0.1:3010/app', canonicalRoot: canonical,
        fetchInspection: async url => {
          expect(url).toBe('http://127.0.0.1:3010/api/workspaces/workspace-1')
          return inspection(root)
        },
        openPath: async target => { opened = target; return '' },
      })
      expect(opened).toBe(await realpath(root))
      await expect(openVerifiedWorkspace({
        id: 'workspace-1', startUrl: 'http://127.0.0.1:3010/app', canonicalRoot: canonical,
        fetchInspection: async () => inspection(root, { id: 'workspace-2' }),
        openPath: async () => { throw new Error('must not launch') },
      })).rejects.toThrow('not verified')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  test('rejects linked ancestors and realpath aliases before launch', async () => {
    const root = path.resolve('runtime', 'workspaces', 'namespace', 'run-1', 'workspace-1', 'tree')
    const canonical = path.resolve('project')
    const linked = {
      lstat: async () => ({ isSymbolicLink: () => true, isDirectory: () => true }),
      realpath: async value => value,
    }
    await expect(verifyActualDirectory(root, canonical, linked)).rejects.toThrow('link')
    const aliased = {
      lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      realpath: async value => value === root ? path.resolve('other-place') : value,
    }
    await expect(verifyActualDirectory(root, canonical, aliased)).rejects.toThrow('another path')
  })
})
