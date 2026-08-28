import { createHash } from 'crypto'
import { isAbsolute, relative, resolve, sep } from 'path'
import ignore from 'ignore'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import type { WorkspaceConfig } from './config-schema'
import { DEFAULT_SNAPSHOT_EXCLUSIONS } from './config-schema'
import { canonicalizeProspectivePath } from './paths'

const ALWAYS_EXCLUDED_DIRECTORIES = ['.git', '.threados'] as const

export interface ExclusionPolicyOptions {
  canonicalRoot: string
  config: WorkspaceConfig
  requiredIncludes?: string[]
  alwaysExcludedRoots?: string[]
}

export interface ExclusionPolicy {
  exclusionPolicyHash: string
  orderedPatterns: readonly string[]
  hardExcludedPaths: readonly string[]
  shouldExclude(relativePath: string, directory?: boolean): boolean
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  const segments = normalized.split('/')
  if (
    !normalized
    || isAbsolute(value)
    || /[\0-\x1F\x7F]/.test(normalized)
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Snapshot path must be a contained relative path: ${JSON.stringify(value)}`)
  }
  return normalized
}

function isPathPrefix(parent: string, candidate: string): boolean {
  const normalizedParent = parent.toLocaleLowerCase('en-US')
  const normalizedCandidate = candidate.toLocaleLowerCase('en-US')
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

async function readThreadosIgnore(canonicalRoot: string): Promise<string[]> {
  try {
    const path = await resolveExistingPathWithinRoot(canonicalRoot, '.threadosignore')
    return (await readTextFileNoFollow(path)).split(/\r?\n/)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

async function containedHardRoot(canonicalRoot: string, candidateRoot: string): Promise<string | null> {
  const lexicalCanonical = resolve(canonicalRoot)
  const lexicalCandidate = resolve(candidateRoot)
  const lexicalRelative = relative(lexicalCanonical, lexicalCandidate)
  if (lexicalRelative === '') throw new Error('An excluded runtime root cannot equal the canonical project root')
  if (!isAbsolute(lexicalRelative) && lexicalRelative !== '..' && !lexicalRelative.startsWith(`..${sep}`)) {
    return normalizeRelativePath(lexicalRelative)
  }

  const canonical = await canonicalizeProspectivePath(canonicalRoot)
  const candidate = await canonicalizeProspectivePath(candidateRoot)
  const fromCanonical = relative(canonical, candidate)
  if (fromCanonical === '') throw new Error('An excluded runtime root cannot equal the canonical project root')
  if (isAbsolute(fromCanonical) || fromCanonical === '..' || fromCanonical.startsWith(`..${sep}`)) return null
  return normalizeRelativePath(fromCanonical)
}

function policyHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

function explicitWorkspaceExclusions(patterns: readonly string[]): string[] {
  const defaults = [...DEFAULT_SNAPSHOT_EXCLUSIONS]
  if (
    patterns.length >= defaults.length
    && defaults.every((pattern, index) => patterns[index] === pattern)
  ) {
    return patterns.slice(defaults.length)
  }
  return [...patterns]
}

function buildRequiredIncludePatterns(
  requiredIncludes: readonly string[],
  userMatcher: ReturnType<typeof ignore>,
): string[] {
  const patterns: string[] = []
  const seen = new Set<string>()

  for (const requiredPath of requiredIncludes) {
    if (userMatcher.ignores(requiredPath)) continue
    const pattern = `!${requiredPath}`
    if (!seen.has(pattern)) {
      seen.add(pattern)
      patterns.push(pattern)
    }
  }

  return patterns
}

function normalizeMatcherInput(relativePath: string, directory: boolean): string {
  return directory ? `${relativePath}/` : relativePath
}

function isExplicitlyIgnored(
  matcher: ReturnType<typeof ignore>,
  relativePath: string,
  directory: boolean,
): boolean {
  return matcher.ignores(normalizeMatcherInput(relativePath, directory))
}

function matchesRequiredInclude(requiredPath: string, candidatePath: string): boolean {
  return candidatePath === requiredPath || candidatePath.startsWith(`${requiredPath}/`)
}

function isRequiredInclude(requiredIncludes: readonly string[], relativePath: string): boolean {
  for (const requiredPath of requiredIncludes) {
    if (matchesRequiredInclude(requiredPath, relativePath)) {
      return true
    }
  }
  return false
}

function isRequiredAncestorDirectory(requiredIncludes: readonly string[], relativePath: string): boolean {
  for (const requiredPath of requiredIncludes) {
    if (requiredPath.startsWith(`${relativePath}/`)) {
      return true
    }
  }
  return false
}

export async function buildExclusionPolicy({
  canonicalRoot,
  config,
  requiredIncludes = [],
  alwaysExcludedRoots = [],
}: ExclusionPolicyOptions): Promise<ExclusionPolicy> {
  const projectPatterns = await readThreadosIgnore(canonicalRoot)
  const normalizedRequiredIncludes = requiredIncludes.map(normalizeRelativePath)
  const explicitUserPatterns = [
    ...explicitWorkspaceExclusions(config.snapshot.exclusions),
    ...projectPatterns,
  ]
  const explicitUserMatcher = ignore().add(explicitUserPatterns)
  const activeRequiredIncludes = normalizedRequiredIncludes
    .filter(path => !explicitUserMatcher.ignores(path))
  const orderedPatterns = [
    ...DEFAULT_SNAPSHOT_EXCLUSIONS,
    ...explicitUserPatterns,
    ...buildRequiredIncludePatterns(activeRequiredIncludes, explicitUserMatcher),
  ]
  const matcher = ignore().add(orderedPatterns)
  const hardExcludedPaths = [
    ...ALWAYS_EXCLUDED_DIRECTORIES,
    ...(await Promise.all(alwaysExcludedRoots.map(root => containedHardRoot(canonicalRoot, root))))
      .filter((value): value is string => value !== null),
  ].map(path => normalizeRelativePath(path))
    .sort((left, right) => left.localeCompare(right))

  const exclusionPolicyHash = policyHash({
    schema_version: 1,
    ordered_patterns: orderedPatterns,
    hard_excluded_paths: hardExcludedPaths,
  })

  return {
    exclusionPolicyHash,
    orderedPatterns,
    hardExcludedPaths,
    shouldExclude(relativePath, directory = false) {
      const normalized = normalizeRelativePath(relativePath)
      if (hardExcludedPaths.some(root => isPathPrefix(root, normalized))) return true
      if (isExplicitlyIgnored(explicitUserMatcher, normalized, directory)) return true
      if (directory && isRequiredAncestorDirectory(activeRequiredIncludes, normalized)) return false
      if (isRequiredInclude(activeRequiredIncludes, normalized)) return false
      return matcher.ignores(normalizeMatcherInput(normalized, directory))
    },
  }
}
