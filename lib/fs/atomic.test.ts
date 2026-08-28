import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setAtomicBoundaryHookForTests, withExclusiveFileLock, writeFileAtomic } from './atomic'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, unlink, utimes, writeFile } from 'fs/promises'
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
  test('serializes high-contention lock generations without treating owner turnover as tampering', async () => {
    const lockPath = join(tempDir, 'contended.lock')
    let counter = 0

    await Promise.all(Array.from({ length: 16 }, () => withExclusiveFileLock(
      lockPath,
      async () => {
        const observed = counter
        await Promise.resolve()
        counter = observed + 1
      },
      { allowedRoot: tempDir, timeoutMs: 5_000 },
    )))

    expect(counter).toBe(16)
  })

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

  test.skipIf(process.platform !== 'win32')('retries replacement while a Windows reader briefly holds the destination', async () => {
    const filePath = join(tempDir, 'shared.txt')
    await writeFileAtomic(filePath, 'first')
    const reader = await open(filePath, 'r')
    const release = new Promise<void>(resolve => {
      setTimeout(() => void reader.close().then(() => resolve()), 50)
    })
    try {
      await writeFileAtomic(filePath, 'second')
      expect(await readFile(filePath, 'utf-8')).toBe('second')
    } finally {
      await release
      await reader.close().catch(() => undefined)
    }
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

  test('rejects a replaced lock metadata path before reading owner bytes', async () => {
    const directory = join(tempDir, 'records')
    const lockPath = join(directory, 'record.lock')
    const movedLock = `${lockPath}.moved`
    await mkdir(directory)
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, created_at_ms: Date.now(), token: 'original' }))
    let swapped = false
    setAtomicBoundaryHookForTests(async context => {
      if (swapped || context.stage !== 'after-lock-metadata-precheck-before-open') return
      swapped = true
      await rename(lockPath, movedLock)
      await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, created_at_ms: 0, token: 'replacement' }))
    })

    await expect(withExclusiveFileLock(lockPath, async () => undefined, {
      allowedRoot: tempDir,
      timeoutMs: 20,
    })).rejects.toThrow('Refusing replaced lock metadata')
    expect(swapped).toBe(true)
    expect(JSON.parse(await readFile(movedLock, 'utf-8')).token).toBe('original')
  })

  test('rejects a swapped lock metadata parent before reading outside bytes', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atomic-metadata-outside-'))
    const directory = join(tempDir, 'records')
    const moved = `${directory}.moved`
    const lockPath = join(directory, 'record.lock')
    await mkdir(directory)
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, created_at_ms: Date.now(), token: 'inside' }))
    await writeFile(join(outside, 'record.lock'), JSON.stringify({
      pid: 2_147_483_647,
      created_at_ms: 0,
      token: 'outside',
    }))
    let swapped = false
    setAtomicBoundaryHookForTests(async context => {
      if (swapped || context.stage !== 'after-lock-metadata-precheck-before-open') return
      swapped = true
      await rename(directory, moved)
      await symlink(outside, directory, 'junction')
    })
    try {
      await expect(withExclusiveFileLock(lockPath, async () => undefined, {
        allowedRoot: tempDir,
        timeoutMs: 20,
      })).rejects.toThrow()
      expect(swapped).toBe(true)
      expect(JSON.parse(await readFile(join(outside, 'record.lock'), 'utf-8')).token).toBe('outside')
      await unlink(directory)
      await rename(moved, directory)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('closes the metadata handle when inspection is interrupted after open', async () => {
    const directory = join(tempDir, 'records')
    const lockPath = join(directory, 'record.lock')
    const movedLock = `${lockPath}.moved`
    await mkdir(directory)
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, created_at_ms: Date.now(), token: 'owner' }))
    setAtomicBoundaryHookForTests(context => {
      if (context.stage === 'after-lock-metadata-open-before-read') throw new Error('injected metadata read interruption')
    })

    await expect(withExclusiveFileLock(lockPath, async () => undefined, {
      allowedRoot: tempDir,
      timeoutMs: 20,
    })).rejects.toThrow('injected metadata read interruption')
    await expect(rename(lockPath, movedLock)).resolves.toBeUndefined()
  })

  test('caps oversized lock metadata and recovers it only as a stale unknown owner', async () => {
    const lockPath = join(tempDir, 'record.lock')
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      created_at_ms: 0,
      token: 'x'.repeat(5_000),
    }))
    const old = new Date(0)
    await utimes(lockPath, old, old)

    await expect(withExclusiveFileLock(lockPath, async () => 'recovered', {
      allowedRoot: tempDir,
      timeoutMs: 100,
      staleAfterMs: 1,
    })).resolves.toBe('recovered')
  })
})
