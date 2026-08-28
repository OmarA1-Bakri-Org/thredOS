import { lstat, realpath } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir } from 'os'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
  posix,
} from 'path'
import { assertSafePathSegment } from '@/lib/security/safe-path'

export interface RuntimeRootEnvironment {
  platform?: NodeJS.Platform
  env?: Readonly<Record<string, string | undefined>>
  homeDirectory?: string
}

export interface ResolveRuntimeRootOptions extends RuntimeRootEnvironment {
  canonicalRoot: string
  override?: string | null
}

export interface WorkspaceRuntimePaths {
  runtimeDataRoot: string
  workspaceNamespace: string
  snapshotsRoot: string
  workspacesRoot: string
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  const normalized = pathApi(platform).normalize(value)
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function isSameOrWithin(root: string, target: string, platform: NodeJS.Platform): boolean {
  const paths = pathApi(platform)
  const fromRoot = paths.relative(
    normalizeForComparison(root, platform),
    normalizeForComparison(target, platform),
  )
  return fromRoot === '' || (!paths.isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${paths.sep}`))
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let current = target
  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if (!isMissing(error)) throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

export async function canonicalizeProspectivePath(target: string): Promise<string> {
  const lexical = resolve(target)
  const ancestor = await nearestExistingAncestor(lexical)
  const canonicalAncestor = await realpath(ancestor)
  const suffix = relative(ancestor, lexical)
  return suffix ? resolve(canonicalAncestor, suffix) : canonicalAncestor
}

export function resolveDefaultRuntimeDataRoot({
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
}: RuntimeRootEnvironment = {}): string {
  const paths = pathApi(platform)
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (!localAppData || !paths.isAbsolute(localAppData)) {
      throw new Error('LOCALAPPDATA must be an absolute path to resolve the thredOS runtime root')
    }
    return paths.join(localAppData, 'thredOS', 'runtime')
  }

  const dataHome = env.XDG_DATA_HOME
  if (dataHome) {
    if (!paths.isAbsolute(dataHome)) throw new Error('XDG_DATA_HOME must be an absolute path')
    return paths.join(dataHome, 'thredos')
  }
  if (!homeDirectory || !paths.isAbsolute(homeDirectory)) {
    throw new Error('HOME must be an absolute path to resolve the thredOS runtime root')
  }
  return paths.join(homeDirectory, '.local', 'share', 'thredos')
}

export async function resolveRuntimeDataRoot({
  canonicalRoot,
  override,
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
}: ResolveRuntimeRootOptions): Promise<string> {
  if (platform !== process.platform) {
    throw new Error('Runtime-root validation must use the host platform path semantics')
  }
  const candidate = override ?? resolveDefaultRuntimeDataRoot({ platform, env, homeDirectory })
  if (!isAbsolute(candidate)) throw new Error('runtime_data_root must be absolute')

  const lexicalProject = resolve(canonicalRoot)
  const lexicalCandidate = resolve(candidate)
  if (
    isSameOrWithin(lexicalProject, lexicalCandidate, platform)
    || isSameOrWithin(lexicalCandidate, lexicalProject, platform)
  ) {
    throw new Error('runtime_data_root must not overlap the canonical project root')
  }
  const canonicalProject = await canonicalizeProspectivePath(canonicalRoot)
  const canonicalCandidate = await canonicalizeProspectivePath(candidate)
  if (
    isSameOrWithin(canonicalProject, canonicalCandidate, platform)
    || isSameOrWithin(canonicalCandidate, canonicalProject, platform)
  ) {
    throw new Error('runtime_data_root must not overlap the canonical project root')
  }

  const segments = canonicalCandidate.split(sep).filter(Boolean)
  if (segments.some(segment => segment.toLocaleLowerCase('en-US') === '.threados')) {
    throw new Error('runtime_data_root must not be placed under a .threados directory')
  }
  return canonicalCandidate
}

export function resolveWorkspaceRuntimePaths(
  runtimeDataRoot: string,
  localWorkspaceId: string,
  canonicalProjectRoot: string,
): WorkspaceRuntimePaths {
  let idNamespace: string
  try {
    idNamespace = assertSafePathSegment(localWorkspaceId, 'local workspace id')
    if (idNamespace.length > 230) throw new Error('local workspace id is too long for a runtime namespace')
  } catch {
    if (!localWorkspaceId) throw new Error('local workspace id must not be empty')
    idNamespace = `workspace-${createHash('sha256').update(localWorkspaceId).digest('hex').slice(0, 16)}`
  }
  const rootIdentity = process.platform === 'win32'
    ? canonicalProjectRoot.toLocaleLowerCase('en-US')
    : canonicalProjectRoot
  const rootDigest = createHash('sha256').update(rootIdentity).digest('hex').slice(0, 16)
  const namespace = `${idNamespace}-${rootDigest}`
  return {
    runtimeDataRoot,
    workspaceNamespace: namespace,
    snapshotsRoot: join(runtimeDataRoot, 'snapshots', namespace),
    workspacesRoot: join(runtimeDataRoot, 'workspaces', namespace),
  }
}
