import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { access, lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendFileNoFollow,
  copyFileNoFollow,
  hashFileNoFollow,
  readTextFileNoFollow,
  setSafeIoAfterOpenHookForTests,
  setSafeIoBeforeOpenHookForTests,
  writeFileNoFollow,
} from './safe-io'

type WriteResult = { bytesWritten: number; buffer: unknown }
type WriteMethod = (this: unknown, ...args: unknown[]) => Promise<WriteResult>

async function withWriteInterceptor(
  filePath: string,
  interceptor: (
    originalWrite: WriteMethod,
    receiver: unknown,
    args: unknown[],
  ) => Promise<WriteResult>,
  operation: () => Promise<void>,
): Promise<void> {
  const probe = await open(filePath, 'r')
  const prototype = Object.getPrototypeOf(probe) as { write: WriteMethod }
  const originalWrite = prototype.write
  await probe.close()

  prototype.write = function (this: unknown, ...args: unknown[]): Promise<WriteResult> {
    return interceptor(originalWrite, this, args)
  }
  try {
    await operation()
  } finally {
    prototype.write = originalWrite
  }
}

describe('safe file I/O', () => {
  let root: string
  let inside: string
  let outside: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'thredos-safe-io-'))
    inside = join(root, 'inside')
    outside = join(root, 'outside')
    await Promise.all([mkdir(inside), mkdir(outside)])
  })

  afterEach(async () => {
    setSafeIoBeforeOpenHookForTests(null)
    setSafeIoAfterOpenHookForTests(null)
    await rm(root, { recursive: true, force: true })
  })

  test('reads valid regular files and rejects a final symlink', async () => {
    const regular = join(inside, 'regular.txt')
    const external = join(outside, 'secret.txt')
    const linked = join(inside, 'linked.txt')
    await writeFile(regular, 'regular content')
    await writeFile(external, 'external secret')
    await symlink(external, linked, 'file')

    expect(await readTextFileNoFollow(regular)).toBe('regular content')
    await expect(readTextFileNoFollow(linked)).rejects.toThrow()
  })

  test('writes new files and truncates existing regular files', async () => {
    const created = join(inside, 'created.txt')
    const existing = join(inside, 'existing.txt')
    await writeFile(existing, 'old content that must be truncated')

    await writeFileNoFollow(created, 'created')
    await writeFileNoFollow(existing, 'replaced')

    expect(await readFile(created, 'utf-8')).toBe('created')
    expect(await readFile(existing, 'utf-8')).toBe('replaced')
  })

  test('write rejects a final symlink without truncating its target', async () => {
    const external = join(outside, 'write-target.txt')
    const linked = join(inside, 'write-link.txt')
    await writeFile(external, 'outside sentinel')
    await symlink(external, linked, 'file')

    await expect(writeFileNoFollow(linked, 'pwned')).rejects.toThrow()
    expect(await readFile(external, 'utf-8')).toBe('outside sentinel')
  })

  test('appends to new and existing regular files without replacing content', async () => {
    const created = join(inside, 'created-append.txt')
    const existing = join(inside, 'existing-append.txt')
    await writeFile(existing, 'first')

    await appendFileNoFollow(created, 'new')
    await appendFileNoFollow(existing, '-second')

    expect(await readFile(created, 'utf-8')).toBe('new')
    expect(await readFile(existing, 'utf-8')).toBe('first-second')
  })

  test('append rejects a final symlink without changing its target', async () => {
    const external = join(outside, 'append-target.txt')
    const linked = join(inside, 'append-link.txt')
    await writeFile(external, 'outside sentinel')
    await symlink(external, linked, 'file')

    await expect(appendFileNoFollow(linked, '-pwned')).rejects.toThrow()
    expect(await readFile(external, 'utf-8')).toBe('outside sentinel')
  })

  test('streams a regular source to a new destination and returns its byte count and digest', async () => {
    const source = join(inside, 'source.txt')
    const created = join(inside, 'copy-created.txt')
    await writeFile(source, 'copied content')

    const result = await copyFileNoFollow(source, created)

    expect(await readFile(created, 'utf-8')).toBe('copied content')
    expect(result).toEqual({
      sizeBytes: Buffer.byteLength('copied content'),
      sha256: createHash('sha256').update('copied content').digest('hex'),
    })
  })

  test('copy refuses to overwrite an existing destination', async () => {
    const source = join(inside, 'exclusive-source.txt')
    const destination = join(inside, 'exclusive-destination.txt')
    await writeFile(source, 'new content')
    await writeFile(destination, 'sentinel')

    await expect(copyFileNoFollow(source, destination)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(destination, 'utf-8')).toBe('sentinel')
  })

  test('copy rejects final symlinks for its source and destination', async () => {
    const regularSource = join(inside, 'regular-source.txt')
    const externalSource = join(outside, 'external-source.txt')
    const linkedSource = join(inside, 'linked-source.txt')
    const externalDestination = join(outside, 'external-destination.txt')
    const linkedDestination = join(inside, 'linked-destination.txt')
    await writeFile(regularSource, 'regular source')
    await writeFile(externalSource, 'external source')
    await symlink(externalSource, linkedSource, 'file')
    await writeFile(externalDestination, 'outside sentinel')
    await symlink(externalDestination, linkedDestination, 'file')

    await expect(copyFileNoFollow(linkedSource, join(inside, 'copy.txt'))).rejects.toThrow()
    await expect(copyFileNoFollow(regularSource, linkedDestination)).rejects.toThrow()
    expect(await readFile(externalDestination, 'utf-8')).toBe('outside sentinel')
  })

  test('copy rejects a source that no longer matches the expected bigint identity', async () => {
    const source = join(inside, 'identity-source.txt')
    const destination = join(inside, 'identity-copy.txt')
    await writeFile(source, 'original')
    const expected = await lstat(source, { bigint: true })

    await writeFile(source, 'replacement')

    await expect(copyFileNoFollow(source, destination, {
      expectedSource: {
        dev: expected.dev,
        ino: expected.ino,
        size: expected.size,
        mtimeNs: expected.mtimeNs,
      },
    })).rejects.toThrow('identity')
    await expect(access(destination)).rejects.toThrow()
  })

  test('copy detects a source swap performed immediately before open', async () => {
    const source = join(inside, 'raced-source.txt')
    const destination = join(inside, 'raced-copy.txt')
    await writeFile(source, 'original')
    const expected = await lstat(source, { bigint: true })

    let swapped = false
    setSafeIoBeforeOpenHookForTests(async ({ operation, filePath }) => {
      if (!swapped && operation === 'copy-source' && filePath === source) {
        swapped = true
        await rm(source)
        await writeFile(source, 'replacement')
      }
    })

    await expect(copyFileNoFollow(source, destination, {
      expectedSource: {
        dev: expected.dev,
        ino: expected.ino,
        size: expected.size,
        mtimeNs: expected.mtimeNs,
      },
    })).rejects.toThrow('identity')
    expect(swapped).toBe(true)
    await expect(access(destination)).rejects.toThrow()
  })

  test('copy types a source swap performed after open as retryable source drift', async () => {
    const source = join(inside, 'after-open-source.txt')
    const destination = join(inside, 'after-open-copy.txt')
    await writeFile(source, 'original')
    const expected = await lstat(source, { bigint: true })

    let swapped = false
    setSafeIoAfterOpenHookForTests(async ({ operation, filePath }) => {
      if (!swapped && operation === 'copy-source' && filePath === source) {
        swapped = true
        await rm(source)
        await writeFile(source, 'replacement')
      }
    })

    await expect(copyFileNoFollow(source, destination, {
      expectedSource: {
        dev: expected.dev,
        ino: expected.ino,
        size: expected.size,
        mtimeNs: expected.mtimeNs,
      },
    })).rejects.toMatchObject({ code: 'SAFE_IO_SOURCE_CHANGED' })
    expect(swapped).toBe(true)
    await expect(access(destination)).rejects.toThrow()
  })

  test('copy enforces maxBytes before creating the destination', async () => {
    const source = join(inside, 'bounded-source.txt')
    const destination = join(inside, 'bounded-copy.txt')
    await writeFile(source, 'too large')

    await expect(copyFileNoFollow(source, destination, { maxBytes: 3 })).rejects.toThrow('maxBytes')
    await expect(access(destination)).rejects.toThrow()
  })

  test('copy streams a multi-chunk file without whole-buffer file APIs', async () => {
    const source = join(inside, 'large-source.bin')
    const destination = join(inside, 'large-copy.bin')
    const content = Buffer.alloc(1024 * 1024 + 17, 0x5a)
    await writeFile(source, content)

    const probe = await open(source, 'r')
    const prototype = Object.getPrototypeOf(probe) as { readFile: (...args: unknown[]) => Promise<unknown> }
    const originalReadFile = prototype.readFile
    await probe.close()
    prototype.readFile = async () => {
      throw new Error('whole-buffer readFile must not be used')
    }
    try {
      const result = await copyFileNoFollow(source, destination)
      expect(result).toEqual({
        sizeBytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      })
      expect(await readFile(destination)).toEqual(content)
    } finally {
      prototype.readFile = originalReadFile
    }
  })

  test('hashFileNoFollow streams a bounded regular file and rejects symlinks', async () => {
    const source = join(inside, 'hash-source.bin')
    const linked = join(inside, 'hash-link.bin')
    const content = Buffer.alloc(256 * 1024 + 3, 0xa5)
    await writeFile(source, content)
    await symlink(source, linked, 'file')

    expect(await hashFileNoFollow(source, content.byteLength)).toEqual({
      sizeBytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
    await expect(hashFileNoFollow(source, content.byteLength - 1)).rejects.toThrow('maxBytes')
    await expect(hashFileNoFollow(linked)).rejects.toThrow()
  })

  test('a destination swapped to a symlink immediately before open is rejected safely', async () => {
    const destination = join(inside, 'raced-destination.txt')
    const external = join(outside, 'race-target.txt')
    await writeFile(destination, 'old destination')
    await writeFile(external, 'outside sentinel')

    let swapped = false
    setSafeIoBeforeOpenHookForTests(async ({ operation, filePath }) => {
      if (!swapped && operation === 'write' && filePath === destination) {
        swapped = true
        await rm(destination)
        await symlink(external, destination, 'file')
      }
    })

    await expect(writeFileNoFollow(destination, 'pwned')).rejects.toThrow()
    expect(swapped).toBe(true)
    expect(await readFile(external, 'utf-8')).toBe('outside sentinel')
  })

  test('append does not recreate an existing destination removed before its second open', async () => {
    const destination = join(inside, 'removed-before-existing-open.txt')
    await writeFile(destination, 'existing content')

    let openCount = 0
    setSafeIoBeforeOpenHookForTests(async ({ operation, filePath }) => {
      if (operation === 'append' && filePath === destination) {
        openCount += 1
        if (openCount === 2) {
          await rm(destination)
        }
      }
    })

    await expect(appendFileNoFollow(destination, '-must-not-be-written')).rejects.toThrow()
    expect(openCount).toBe(2)
    await expect(access(destination)).rejects.toThrow()
  })

  test('append retries partial low-level writes until the full encoded payload is stored', async () => {
    const destination = join(inside, 'partial-append.txt')
    const payload = 'é🙂abc'
    await writeFile(destination, 'prefix:')

    let writeCalls = 0
    await withWriteInterceptor(destination, async (originalWrite, receiver, args) => {
      writeCalls += 1
      const [data, second, third, fourth] = args
      if (typeof data === 'string') {
        const partial = Buffer.from(data).subarray(0, 2)
        return originalWrite.call(receiver, partial, 0, partial.byteLength, second)
      }
      if (ArrayBuffer.isView(data) && typeof second === 'number' && typeof third === 'number') {
        return originalWrite.call(receiver, data, second, Math.min(third, 2), fourth)
      }
      return originalWrite.call(receiver, ...args)
    }, async () => {
      await appendFileNoFollow(destination, payload)
    })

    expect(await readFile(destination, 'utf-8')).toBe(`prefix:${payload}`)
    expect(writeCalls).toBeGreaterThan(1)
  })

  test('append rejects a zero-progress low-level write', async () => {
    const destination = join(inside, 'zero-progress-append.txt')
    await writeFile(destination, 'prefix:')

    await expect(withWriteInterceptor(destination, async (_originalWrite, _receiver, args) => ({
      bytesWritten: 0,
      buffer: args[0],
    }), async () => {
      await appendFileNoFollow(destination, 'payload')
    })).rejects.toThrow()
    expect(await readFile(destination, 'utf-8')).toBe('prefix:')
  })
})
