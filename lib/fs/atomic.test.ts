import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setAtomicBoundaryHookForTests, withExclusiveFileLock, writeFileAtomic } from './atomic'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let tempDir: string

beforeEach(async () => {
  tempDir = await createTempDir()
})

afterEach(async () => {
  setAtomicBoundaryHookForTests(null)
  await cleanTempDir(tempDir)
})

describe('writeFileAtomic', () => {
  test('writes file successfully', async () => {
    const filePath = join(tempDir, 'test.txt')
    await writeFileAtomic(filePath, 'hello world')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('hello world')
  })

  test('creates parent directories', async () => {
    const filePath = join(tempDir, 'nested', 'dir', 'test.txt')
    await writeFileAtomic(filePath, 'nested content')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('nested content')
  })

  test('overwrites existing file', async () => {
    const filePath = join(tempDir, 'test.txt')
    await writeFileAtomic(filePath, 'first')
    await writeFileAtomic(filePath, 'second')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('second')
  })

  test('revalidates a lock parent after precheck and removes the empty escaped artifact', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atomic-lock-outside-'))
    const directory = join(tempDir, 'records')
    const moved = `${directory}.moved`
    await mkdir(directory)
    setAtomicBoundaryHookForTests(async context => {
      if (context.stage !== 'after-lock-precheck-before-open') return
      await rename(directory, moved)
      await symlink(outside, directory, 'junction')
    })
    try {
      await expect(withExclusiveFileLock(join(directory, 'record.lock'), async () => undefined, {
        allowedRoot: tempDir,
      })).rejects.toThrow()
      expect(await readdir(outside)).toEqual([])
      expect((await readdir(moved)).filter(name => name.endsWith('.lock'))).toEqual([])
      await unlink(directory)
      await rename(moved, directory)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('revalidates a temp parent after precheck and writes no content outside the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atomic-temp-outside-'))
    const directory = join(tempDir, 'records')
    const moved = `${directory}.moved`
    await mkdir(directory)
    setAtomicBoundaryHookForTests(async context => {
      if (context.stage !== 'after-temp-precheck-before-open') return
      await rename(directory, moved)
      await symlink(outside, directory, 'junction')
    })
    try {
      await expect(writeFileAtomic(join(directory, 'record.json'), 'canonical-content', {
        allowedRoot: tempDir,
      })).rejects.toThrow()
      expect(await readdir(outside)).toEqual([])
      expect((await readdir(moved)).filter(name => name.endsWith('.tmp'))).toEqual([])
      await unlink(directory)
      await rename(moved, directory)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('holds the source identity across the final rename gap and cleans in-root relocations', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atomic-rename-outside-'))
    const directory = join(tempDir, 'records')
    const moved = `${directory}.moved`
    await mkdir(directory)
    let swapResult: 'swapped' | 'platform-blocked' | null = null
    setAtomicBoundaryHookForTests(async context => {
      if (context.stage !== 'after-final-precheck-before-rename') return
      try {
        await rename(directory, moved)
        await symlink(outside, directory, 'junction')
        swapResult = 'swapped'
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && ['EPERM', 'EACCES'].includes(String(error.code)))) throw error
        swapResult = 'platform-blocked'
        throw new Error('platform prevented directory relocation while the source handle was open')
      }
    })
    try {
      await expect(writeFileAtomic(join(directory, 'record.json'), 'canonical-content', {
        allowedRoot: tempDir,
      })).rejects.toThrow()
      expect(swapResult).not.toBeNull()
      expect(await readdir(outside)).toEqual([])
      const inspected = swapResult === 'swapped' ? moved : directory
      expect((await readdir(inspected)).filter(name => name.endsWith('.tmp'))).toEqual([])
      if (swapResult === 'swapped') {
        await unlink(directory)
        await rename(moved, directory)
      }
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
