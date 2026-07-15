import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendFileNoFollow,
  copyFileNoFollow,
  readTextFileNoFollow,
  setSafeIoBeforeOpenHookForTests,
  writeFileNoFollow,
} from './safe-io'

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

  test('copies regular sources to new and existing regular destinations', async () => {
    const source = join(inside, 'source.txt')
    const created = join(inside, 'copy-created.txt')
    const existing = join(inside, 'copy-existing.txt')
    await writeFile(source, 'copied content')
    await writeFile(existing, 'old destination content')

    await copyFileNoFollow(source, created)
    await copyFileNoFollow(source, existing)

    expect(await readFile(created, 'utf-8')).toBe('copied content')
    expect(await readFile(existing, 'utf-8')).toBe('copied content')
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
})
