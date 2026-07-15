import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import {
  assertPortableRelativePath,
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from './safe-path'

describe('safe path containment', () => {
  let testRoot: string
  let root: string
  let outside: string

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'thredos-safe-path-'))
    root = join(testRoot, 'root')
    outside = join(testRoot, 'outside')
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(outside, { recursive: true }),
    ])
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  test('accepts portable opaque identifiers', () => {
    for (const value of ['step-a', '1.0.0', '550e8400-e29b-41d4-a716-446655440000']) {
      expect(assertSafePathSegment(value)).toBe(value)
    }
  })

  test('accepts canonical relative paths and rejects backslash or mixed-separator forms', () => {
    expect(assertPortableRelativePath('.threados/prompts/step-a.md')).toBe('.threados/prompts/step-a.md')
    expect(assertPortableRelativePath('custom/nested/step-a.md')).toBe('custom/nested/step-a.md')

    for (const value of [
      '', '.', '..', '../escape.md', 'custom/../escape.md', '/absolute.md',
      'C:\\absolute.md', '\\\\server\\share.md', 'custom\\step.md', 'custom/dir\\step.md',
    ]) {
      expect(() => assertPortableRelativePath(value, 'prompt_file')).toThrow()
    }
  })

  test('rejects traversal, absolute, device, and Windows-unsafe identifiers', () => {
    const unsafe = [
      '', '.', '..', '../escape', '..\\escape', '/absolute', 'C:\\absolute',
      '\\\\server\\share', 'mixed/..\\escape', 'nul\0byte', 'CON', 'con.txt',
      'name:stream', 'trailing.', 'trailing ',
    ]

    for (const value of unsafe) {
      expect(() => assertSafePathSegment(value, 'test id')).toThrow()
    }
  })

  test('rejects lexical traversal while allowing canonical nested paths', async () => {
    const nested = await resolvePathWithinRoot(root, '.threados', 'prompts', 'step-a.md')
    expect(relative(root, nested)).toBe(join('.threados', 'prompts', 'step-a.md'))
    await expect(resolvePathWithinRoot(root, '..', 'escape.txt')).rejects.toThrow()
  })

  test('rejects an escaping symlink or Windows junction for future and existing targets', async () => {
    const linkPath = join(root, 'escape-link')
    try {
      await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return
      throw error
    }

    await writeFile(join(outside, 'secret.txt'), 'outside')
    await expect(resolvePathWithinRoot(root, 'escape-link', 'future.txt')).rejects.toThrow()
    await expect(resolveExistingPathWithinRoot(root, 'escape-link', 'secret.txt')).rejects.toThrow()
  })

  test('allows an internal symlink whose real target remains contained', async () => {
    const target = join(root, 'target')
    const linkPath = join(root, 'inside-link')
    await mkdir(target)
    await writeFile(join(target, 'safe.txt'), 'safe')
    try {
      await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return
      throw error
    }

    await expect(resolvePathWithinRoot(root, 'inside-link', 'future.txt')).resolves.toBe(join(linkPath, 'future.txt'))
    await expect(resolveExistingPathWithinRoot(root, 'inside-link', 'safe.txt')).resolves.toBe(join(linkPath, 'safe.txt'))
  })
})
