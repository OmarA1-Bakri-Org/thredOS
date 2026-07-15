import { lstat, realpath } from 'fs/promises'
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from 'path'

const PORTABLE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const WINDOWS_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i

function isContained(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
}

function containmentError(label: string, value: string): Error {
  return new Error(`${label} must remain within its allowed root: ${JSON.stringify(value)}`)
}

export function assertSafePathSegment(value: string, label = 'path segment'): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 255
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || /[\0-\x1F\x7F]/.test(value)
    || value.includes(':')
    || /^[A-Za-z]:/.test(value)
    || /[. ]$/.test(value)
    || WINDOWS_DEVICE_NAME.test(value)
    || !PORTABLE_SEGMENT.test(value)
  ) {
    throw new Error(`${label} must be a file-safe identifier`)
  }
  return value
}

export function assertPortableRelativePath(value: string, label = 'relative path'): string {
  const segments = typeof value === 'string' ? value.split('/') : []
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || posix.isAbsolute(value)
    || win32.isAbsolute(value)
    || /[\0-\x1F\x7F]/.test(value)
    || value.includes(':')
    || segments.some(segment => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.length > 255
      || /[. ]$/.test(segment)
      || WINDOWS_DEVICE_NAME.test(segment)
      || !/^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
    ))
  ) {
    throw new Error(`${label} must be a portable relative path`)
  }
  return value
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let current = target
  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

async function resolveAndVerify(root: string, segments: string[], requireExisting: boolean): Promise<string> {
  const lexicalRoot = resolve(root)
  const lexicalTarget = resolve(lexicalRoot, ...segments)
  if (!isContained(lexicalRoot, lexicalTarget)) {
    throw containmentError('path', lexicalTarget)
  }

  const realRoot = await realpath(lexicalRoot)
  const existingTarget = requireExisting ? lexicalTarget : await nearestExistingAncestor(lexicalTarget)
  const realTarget = await realpath(existingTarget)
  if (!isContained(realRoot, realTarget)) {
    throw containmentError('real path', realTarget)
  }
  return lexicalTarget
}

export async function resolvePathWithinRoot(root: string, ...segments: string[]): Promise<string> {
  return resolveAndVerify(root, segments, false)
}

export async function resolveExistingPathWithinRoot(root: string, ...segments: string[]): Promise<string> {
  return resolveAndVerify(root, segments, true)
}
