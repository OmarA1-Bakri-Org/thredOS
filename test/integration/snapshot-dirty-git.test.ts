import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { cp, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createDefaultWorkspaceConfig } from '@/lib/workspaces/config-schema'
import { captureSnapshot } from '@/lib/workspaces/snapshot'
import { createFixtureRoot, removeFixtureTree } from '../helpers/remove-fixture-tree'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixtureTree))
})

describe('snapshot dirty Git integration', () => {
  test('captures modified and untracked bytes while recording best-effort Git evidence', async () => {
    const source = await createFixtureRoot('threados-dirty-git-source-')
    const runtime = await createFixtureRoot('threados-dirty-git-runtime-')
    roots.push(source, runtime)
    await cp(join(import.meta.dir, '..', 'fixtures', 'workspaces', 'snapshot-project'), source, { recursive: true })
    await execFileAsync('git', ['init'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['config', 'user.email', 'fixture@threados.local'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['config', 'user.name', 'thredOS fixture'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['add', '.'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: source, windowsHide: true })
    await writeFile(join(source, 'README.md'), 'dirty tracked bytes\n')
    await writeFile(join(source, 'untracked.txt'), 'untracked bytes\n')

    const result = await captureSnapshot({
      canonicalRoot: source,
      runtimeDataRoot: runtime,
      localWorkspaceId: 'dirty-git-fixture',
      workflowRunId: 'run-dirty-git',
      config: createDefaultWorkspaceConfig(),
    })

    expect(result.snapshot.git_head).toMatch(/^[a-f0-9]{40,64}$/)
    expect(result.snapshot.git_dirty).toBe(true)
    expect(await readFile(join(result.snapshot.content_root!, 'README.md'), 'utf8')).toBe('dirty tracked bytes\n')
    expect(await readFile(join(result.snapshot.content_root!, 'untracked.txt'), 'utf8')).toBe('untracked bytes\n')
    expect(result.manifest.entries.some(entry => entry.path === '.git')).toBe(false)

    const trackedOnlyConfig = createDefaultWorkspaceConfig()
    trackedOnlyConfig.snapshot.include_untracked = false
    const trackedOnly = await captureSnapshot({
      canonicalRoot: source,
      runtimeDataRoot: runtime,
      localWorkspaceId: 'dirty-git-fixture',
      workflowRunId: 'run-dirty-git-tracked-only',
      config: trackedOnlyConfig,
    })
    expect(trackedOnly.manifest.entries.some(entry => entry.path === 'untracked.txt')).toBe(false)
    expect(await readFile(join(trackedOnly.snapshot.content_root!, 'README.md'), 'utf8')).toBe('dirty tracked bytes\n')
  })

  test('captures a clean Git project with stable HEAD evidence', async () => {
    const source = await createFixtureRoot('threados-clean-git-source-')
    const runtime = await createFixtureRoot('threados-clean-git-runtime-')
    roots.push(source, runtime)
    await cp(join(import.meta.dir, '..', 'fixtures', 'workspaces', 'snapshot-project'), source, { recursive: true })
    await execFileAsync('git', ['init'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['config', 'user.email', 'fixture@threados.local'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['config', 'user.name', 'thredOS fixture'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['add', '.'], { cwd: source, windowsHide: true })
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: source, windowsHide: true })

    const result = await captureSnapshot({
      canonicalRoot: source,
      runtimeDataRoot: runtime,
      localWorkspaceId: 'clean-git-fixture',
      workflowRunId: 'run-clean-git',
      config: createDefaultWorkspaceConfig(),
    })

    expect(result.snapshot.git_head).toMatch(/^[a-f0-9]{40,64}$/)
    expect(result.snapshot.git_dirty).toBe(false)
  })
})
