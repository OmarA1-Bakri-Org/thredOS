import { expect, test } from 'bun:test'
import { lstat, mkdir, link, symlink, rename, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'
import { auditCandidateValidationTree } from './validation-tree'

test('stopped candidate audit rejects canonical hardlinks, root aliases, and root replacement before validator launch', async () => {
  const root = await createFixtureRoot('threados-candidate-audit-')
  try {
    const canonical = join(root, 'canonical'), workspace = join(root, 'workspace')
    await mkdir(canonical); await mkdir(workspace)
    await writeFile(join(canonical, 'sentinel.txt'), 'canonical untouched\n')
    const stat = await lstat(workspace), identity = `${stat.dev}:${stat.ino}`
    const limits = { maxFiles: 100, maxBytes: 10_000 }
    await link(join(canonical, 'sentinel.txt'), join(workspace, 'unsafe.txt'))
    await expect(auditCandidateValidationTree(workspace, identity, limits)).rejects.toThrow('CHANGE_SET_UNSAFE_TREE')
    await rename(workspace, join(root, 'retained-workspace'))
    await symlink(canonical, workspace, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(auditCandidateValidationTree(workspace, identity, limits)).rejects.toThrow('CHANGE_SET_UNSAFE_ROOT')
    const replacement = join(root, 'replacement'); await mkdir(replacement)
    const different = await lstat(replacement)
    await expect(auditCandidateValidationTree(replacement, identity, limits)).rejects.toThrow('CHANGE_SET_UNSAFE_ROOT')
    expect(`${different.dev}:${different.ino}`).not.toBe(identity)
    expect(await readFile(join(canonical, 'sentinel.txt'), 'utf8')).toBe('canonical untouched\n')
  } finally { await removeFixtureTree(root) }
})
