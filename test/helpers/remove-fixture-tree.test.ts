import { describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFixtureRoot, removeFixtureTree } from './remove-fixture-tree'

describe('owned fixture tree cleanup', () => {
  test('removes read-only fixture directories and files without changing file permissions', async () => {
    const root = await createFixtureRoot('threados-cleanup-frozen-')
    try {
      await mkdir(join(root, 'tree', 'src'), { recursive: true })
      await writeFile(join(root, 'tree', 'src', 'file.txt'), 'immutable fixture')
      await chmod(join(root, 'tree', 'src', 'file.txt'), 0o444)
      await chmod(join(root, 'tree', 'src'), 0o555)
      await chmod(join(root, 'tree'), 0o555)
      await chmod(root, 0o555)

      await removeFixtureTree(root)
      expect(existsSync(root)).toBe(false)
    } finally {
      await removeFixtureTree(root)
    }
  })

  test('unlinks an escaping directory symlink without touching its outside sentinel', async () => {
    const root = await createFixtureRoot('threados-cleanup-link-')
    const outside = await createFixtureRoot('threados-cleanup-sentinel-')
    try {
      const sentinel = join(outside, 'sentinel.txt')
      await writeFile(sentinel, 'outside must survive')
      await chmod(sentinel, 0o444)
      await chmod(outside, 0o555)
      const outsideMode = (await lstat(outside)).mode
      const sentinelMode = (await lstat(sentinel)).mode
      await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')

      await removeFixtureTree(root)
      expect(await readFile(sentinel, 'utf8')).toBe('outside must survive')
      expect((await lstat(outside)).mode).toBe(outsideMode)
      expect((await lstat(sentinel)).mode).toBe(sentinelMode)
      expect(existsSync(root)).toBe(false)
    } finally {
      await removeFixtureTree(root)
      await removeFixtureTree(outside)
    }
  })

  test('rejects an arbitrary directory that was not created by the fixture helper', async () => {
    const unowned = await mkdtemp(join(tmpdir(), 'threados-cleanup-unowned-'))
    try {
      await writeFile(join(unowned, 'sentinel.txt'), 'unowned')
      await expect(removeFixtureTree(unowned)).rejects.toThrow('not created by createFixtureRoot')
      expect(await readFile(join(unowned, 'sentinel.txt'), 'utf8')).toBe('unowned')
    } finally {
      await rm(unowned, { recursive: true, force: true })
    }
  })

  test('rejects a replacement directory at a previously owned fixture path', async () => {
    const root = await createFixtureRoot('threados-cleanup-original-')
    const outside = await createFixtureRoot('threados-cleanup-replacement-')
    const preserved = join(outside, 'preserved')
    try {
      await rename(root, preserved)
      await mkdir(root)
      await writeFile(join(root, 'sentinel.txt'), 'replacement must survive')
      await expect(removeFixtureTree(root)).rejects.toThrow('identity changed')
      expect(await readFile(join(root, 'sentinel.txt'), 'utf8')).toBe('replacement must survive')
    } finally {
      await rm(root, { recursive: true, force: true })
      await removeFixtureTree(outside)
    }
  })
})
