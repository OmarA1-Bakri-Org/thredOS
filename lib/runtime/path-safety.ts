import { isAbsolute, relative, resolve } from 'path'

function isPathInsideBase(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function resolvePathWithinBase(basePath: string, inputPath: string, label = 'path'): string {
  const resolvedBase = resolve(basePath)
  const resolvedTarget = resolve(resolvedBase, inputPath)
  if (!isPathInsideBase(resolvedBase, resolvedTarget)) {
    throw new Error(`${label} must stay within the workspace`)
  }
  return resolvedTarget
}

export function resolveAbsoluteOrWithinBase(basePath: string, inputPath: string, label = 'path'): string {
  const resolvedBase = resolve(basePath)
  const resolvedTarget = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(resolvedBase, inputPath)

  if (!isPathInsideBase(resolvedBase, resolvedTarget)) {
    throw new Error(`${label} must stay within the workspace`)
  }

  return resolvedTarget
}

export function assertSafePathSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error(`${label} must be a single path segment`)
  }
  return value
}
