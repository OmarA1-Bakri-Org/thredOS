import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanNoGitWorktreeRuntime } from '@/scripts/verify/no-worktree-guard'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sourceFixture(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'threados-no-worktree-guard-'))
  roots.push(root)
  await Promise.all(['app', 'lib', 'desktop', 'scripts'].map(path => mkdir(join(root, path), { recursive: true })))
  await writeFile(join(root, 'lib', 'runtime.ts'), source)
  return root
}

describe('no Git worktree production-runtime guard', () => {
  test('the repository production runtime has no executable worktree construction', async () => {
    const report = await scanNoGitWorktreeRuntime(process.cwd())
    expect(report.files_scanned.length).toBeGreaterThan(0)
    expect(report.violations).toEqual([])
    expect(report.passed).toBe(true)
  })

  test('ignores prose and comments that state the product boundary', async () => {
    const root = await sourceFixture([
      '// git worktree is not a supported runtime substrate',
      'export const productNote = "No manual worktrees are required."',
    ].join('\n'))
    await writeFile(join(root, 'README.md'), 'Do not use git worktree.\n')

    expect((await scanNoGitWorktreeRuntime(root)).violations).toEqual([])
  })

  test('detects direct and indirect process invocation construction', async () => {
    const directRoot = await sourceFixture("spawn('git', ['worktree', 'add', target])\n")
    const indirectRoot = await sourceFixture([
      "const command = 'git.exe'",
      "const args = ['worktree', 'remove', target]",
      'execFile(command, args)',
    ].join('\n'))

    expect((await scanNoGitWorktreeRuntime(directRoot)).violations).toEqual([
      expect.objectContaining({ file: 'lib/runtime.ts', pattern: 'git-worktree' }),
    ])
    expect((await scanNoGitWorktreeRuntime(indirectRoot)).violations).toEqual([
      expect.objectContaining({ file: 'lib/runtime.ts', pattern: 'git-worktree' }),
    ])
  })

  test('does not mistake verification Git fixtures for a production runtime path', async () => {
    const root = await sourceFixture('export const safe = true\n')
    await mkdir(join(root, 'scripts', 'verify'), { recursive: true })
    await writeFile(join(root, 'scripts', 'verify', 'm2-proof.mjs'), [
      "const guardName = 'no-worktree-guard'",
      "spawn('git', ['init', fixtureRoot])",
    ].join('\n'))

    expect((await scanNoGitWorktreeRuntime(root)).violations).toEqual([])
  })

  test('fails closed when a required production root is missing', async () => {
    const root = await sourceFixture('export const safe = true\n')
    await rm(join(root, 'desktop'), { recursive: true, force: true })

    await expect(scanNoGitWorktreeRuntime(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
