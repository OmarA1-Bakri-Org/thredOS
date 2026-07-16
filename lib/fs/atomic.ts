import { randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, type FileHandle } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'

type BeforeRenameHook = (targetPath: string, tempPath: string) => Promise<void> | void
export type AtomicBoundaryStage =
  | 'before-lock-open'
  | 'after-lock-precheck-before-open'
  | 'after-lock-open-before-write'
  | 'before-temp-open'
  | 'after-temp-precheck-before-open'
  | 'after-temp-open-before-write'
  | 'before-final-rename'
  | 'after-final-precheck-before-rename'
export interface AtomicBoundaryContext {
  stage: AtomicBoundaryStage
  targetPath: string
  tempPath?: string
}
type AtomicBoundaryHook = (context: AtomicBoundaryContext) => Promise<void> | void

export interface ExclusiveLockOptions {
  allowedRoot?: string
  timeoutMs?: number
  staleAfterMs?: number
}

export interface AtomicWriteOptions {
  allowedRoot?: string
}

interface LockOwner {
  pid: number
  created_at_ms: number
  token: string
}

interface ParentIdentity {
  realPath: string
  stat: Awaited<ReturnType<FileHandle['stat']>>
}

let beforeRenameHookForTests: BeforeRenameHook | null = null
let atomicBoundaryHookForTests: AtomicBoundaryHook | null = null

export function setAtomicBeforeRenameHookForTests(hook: BeforeRenameHook | null): void {
  beforeRenameHookForTests = hook
}

export function setAtomicBoundaryHookForTests(hook: AtomicBoundaryHook | null): void {
  atomicBoundaryHookForTests = hook
}

export class RuntimeLockTimeoutError extends Error {
  readonly code = 'RUNTIME_LOCK_TIMEOUT'

  constructor(lockPath: string) {
    super(`Timed out waiting for live runtime lock: ${lockPath}`)
    this.name = 'RuntimeLockTimeoutError'
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

function pathSegmentsWithin(root: string, target: string): string[] {
  const fromRoot = relative(resolve(root), resolve(target))
  if (fromRoot === '' || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    if (fromRoot === '') return []
    throw new Error(`Atomic path must remain within its allowed root: ${target}`)
  }
  return fromRoot.split(sep)
}

async function verifyParentWithinRoot(root: string | undefined, target: string): Promise<void> {
  if (!root) return
  const segments = pathSegmentsWithin(root, target)
  if (segments.length === 0) throw new Error('Atomic target cannot replace its allowed root')
  const rootReal = await realpath(root)
  const parentReal = await realpath(dirname(target))
  const fromRoot = relative(rootReal, parentReal)
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Atomic parent escaped its allowed root: ${dirname(target)}`)
  }
}

async function captureParentIdentity(root: string | undefined, target: string): Promise<ParentIdentity> {
  await verifyParentWithinRoot(root, target)
  const parentReal = await realpath(dirname(target))
  const parentStat = await lstat(parentReal)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Atomic parent is not a real directory: ${dirname(target)}`)
  }
  return { realPath: parentReal, stat: parentStat }
}

async function verifyParentIdentity(
  root: string | undefined,
  target: string,
  expected: ParentIdentity,
): Promise<void> {
  const current = await captureParentIdentity(root, target)
  if (current.realPath !== expected.realPath || !sameFileIdentity(current.stat, expected.stat)) {
    throw new Error(`Refusing replaced atomic parent: ${dirname(target)}`)
  }
}

async function verifyFileIdentity(path: string, expected: Awaited<ReturnType<FileHandle['stat']>>): Promise<void> {
  const current = await lstat(path)
  if (current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`Refusing replaced filesystem entry: ${path}`)
  }
}

function sameFileIdentity(
  left: Awaited<ReturnType<FileHandle['stat']>>,
  right: Awaited<ReturnType<FileHandle['stat']>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function isWithinResolvedRoot(root: string, target: string): boolean {
  const fromRoot = relative(resolve(root), resolve(target))
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
}

async function findOwnedEntryWithinRoot(
  root: string,
  expected: Awaited<ReturnType<FileHandle['stat']>>,
): Promise<string | null> {
  const rootReal = await realpath(root)
  const queue: Array<{ path: string; depth: number }> = [{ path: rootReal, depth: 0 }]
  const maximumEntries = 4_096
  const maximumDepth = 16
  let visitedEntries = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    let entries: Dirent<string>[]
    try {
      const currentStat = await lstat(current.path)
      if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) continue
      const currentReal = await realpath(current.path)
      if (!isWithinResolvedRoot(rootReal, currentReal)) continue
      entries = await readdir(current.path, { withFileTypes: true })
    } catch (error) {
      if (hasCode(error, 'ENOENT')) continue
      throw error
    }

    for (const entry of entries) {
      visitedEntries += 1
      if (visitedEntries > maximumEntries) {
        throw new Error(`Owned-entry cleanup exceeded ${maximumEntries} entries within ${root}`)
      }
      const candidate = join(current.path, entry.name)
      let candidateStat: Awaited<ReturnType<typeof lstat>>
      try {
        candidateStat = await lstat(candidate)
      } catch (error) {
        if (hasCode(error, 'ENOENT')) continue
        throw error
      }
      if (candidateStat.isSymbolicLink()) continue
      if (candidateStat.dev === expected.dev && candidateStat.ino === expected.ino) return candidate
      if (candidateStat.isDirectory() && current.depth < maximumDepth) {
        const candidateReal = await realpath(candidate).catch(() => null)
        if (candidateReal && isWithinResolvedRoot(rootReal, candidateReal)) {
          queue.push({ path: candidate, depth: current.depth + 1 })
        }
      }
    }
  }
  return null
}

async function cleanupOwnedEntry(
  lexicalPath: string,
  expected: Awaited<ReturnType<FileHandle['stat']>>,
  allowedRoot: string | undefined,
  allowEscapedEmptyLexicalCleanup = false,
): Promise<boolean> {
  try {
    await verifyParentWithinRoot(allowedRoot, lexicalPath)
    await verifyFileIdentity(lexicalPath, expected)
    await unlink(lexicalPath)
    return true
  } catch {
    // A containing directory may have been renamed after the entry was opened.
  }
  if (allowEscapedEmptyLexicalCleanup && Number(expected.size) === 0) {
    try {
      await verifyFileIdentity(lexicalPath, expected)
      await unlink(lexicalPath)
      return true
    } catch {
      // Never search outside the allowed root; only the exact empty entry we opened is eligible.
    }
  }
  if (!allowedRoot) return false
  const relocated = await findOwnedEntryWithinRoot(allowedRoot, expected)
  if (!relocated) return false
  await verifyParentWithinRoot(allowedRoot, relocated)
  await verifyFileIdentity(relocated, expected)
  await unlink(relocated)
  return true
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !hasCode(error, 'ESRCH')
  }
}

async function readLockOwner(lockPath: string): Promise<{ owner: LockOwner | null; stat: Awaited<ReturnType<FileHandle['stat']>> }> {
  const handle = await open(lockPath, 'r')
  try {
    const opened = await handle.stat()
    await verifyFileIdentity(lockPath, opened)
    const raw = await handle.readFile('utf-8')
    const value: unknown = JSON.parse(raw)
    const owner = typeof value === 'object' && value != null
      && Number.isInteger((value as Partial<LockOwner>).pid)
      && typeof (value as Partial<LockOwner>).created_at_ms === 'number'
      && typeof (value as Partial<LockOwner>).token === 'string'
      ? value as LockOwner
      : null
    return { owner, stat: opened }
  } catch (error) {
    if (error instanceof SyntaxError) {
      const opened = await handle.stat()
      return { owner: null, stat: opened }
    }
    throw error
  } finally {
    await handle.close()
  }
}

async function recoverOrphanedLock(
  lockPath: string,
  allowedRoot: string | undefined,
  staleAfterMs: number,
): Promise<boolean> {
  await verifyParentWithinRoot(allowedRoot, lockPath)
  let observed: Awaited<ReturnType<typeof readLockOwner>>
  try {
    observed = await readLockOwner(lockPath)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true
    throw error
  }
  const age = Date.now() - (observed.owner?.created_at_ms ?? Number(observed.stat.mtimeMs))
  const recoverable = observed.owner == null
    ? age >= staleAfterMs
    : !isProcessAlive(observed.owner.pid)
  if (!recoverable) return false
  await verifyParentWithinRoot(allowedRoot, lockPath)
  await verifyFileIdentity(lockPath, observed.stat)
  await unlink(lockPath)
  return true
}

/** Serializes a filesystem transaction across processes using an owned sibling lock. */
export async function withExclusiveFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: number | ExclusiveLockOptions = {},
): Promise<T> {
  const normalized = typeof options === 'number' ? { timeoutMs: options } : options
  const timeoutMs = normalized.timeoutMs ?? 5_000
  const staleAfterMs = normalized.staleAfterMs ?? 30_000
  if (!normalized.allowedRoot) await mkdir(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  const owner: LockOwner = { pid: process.pid, created_at_ms: Date.now(), token: randomUUID() }
  let handle: FileHandle | undefined
  let ownedStat: Awaited<ReturnType<FileHandle['stat']>> | undefined
  let metadataWriteStarted = false

  while (!handle) {
    try {
      await atomicBoundaryHookForTests?.({ stage: 'before-lock-open', targetPath: lockPath })
      const parentIdentity = await captureParentIdentity(normalized.allowedRoot, lockPath)
      await atomicBoundaryHookForTests?.({ stage: 'after-lock-precheck-before-open', targetPath: lockPath })
      handle = await open(lockPath, 'wx', 0o600)
      ownedStat = await handle.stat()
      await atomicBoundaryHookForTests?.({ stage: 'after-lock-open-before-write', targetPath: lockPath })
      await verifyParentIdentity(normalized.allowedRoot, lockPath, parentIdentity)
      await verifyFileIdentity(lockPath, ownedStat)
      metadataWriteStarted = true
      await handle.writeFile(JSON.stringify(owner), 'utf-8')
      await handle.sync()
      if (!sameFileIdentity(await handle.stat(), ownedStat)) throw new Error(`Runtime lock handle changed: ${lockPath}`)
      await verifyFileIdentity(lockPath, ownedStat)
      await verifyParentIdentity(normalized.allowedRoot, lockPath, parentIdentity)
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined)
        handle = undefined
      }
      if (ownedStat) {
        await cleanupOwnedEntry(lockPath, ownedStat, normalized.allowedRoot, !metadataWriteStarted)
        ownedStat = undefined
      }
      metadataWriteStarted = false
      if (!hasCode(error, 'EEXIST')) throw error
      if (await recoverOrphanedLock(lockPath, normalized.allowedRoot, staleAfterMs)) continue
      if (Date.now() >= deadline) throw new RuntimeLockTimeoutError(lockPath)
      await pause(5)
    }
  }

  if (!ownedStat) throw new Error(`Runtime lock ownership was not established: ${lockPath}`)
  try {
    return await operation()
  } finally {
    await handle.close()
    if (!await cleanupOwnedEntry(lockPath, ownedStat, normalized.allowedRoot)) {
      throw new Error(`Owned runtime lock escaped its allowed cleanup root: ${lockPath}`)
    }
  }
}

/** Writes a complete sibling temp file and atomically replaces the destination. */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = dirname(filePath)
  if (!options.allowedRoot) await mkdir(dir, { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  let handle: FileHandle | undefined
  let opened: Awaited<ReturnType<FileHandle['stat']>> | undefined
  let contentWriteStarted = false

  try {
    await atomicBoundaryHookForTests?.({ stage: 'before-temp-open', targetPath: filePath, tempPath })
    const parentIdentity = await captureParentIdentity(options.allowedRoot, filePath)
    await atomicBoundaryHookForTests?.({ stage: 'after-temp-precheck-before-open', targetPath: filePath, tempPath })
    handle = await open(tempPath, 'wx', 0o600)
    opened = await handle.stat()
    await atomicBoundaryHookForTests?.({ stage: 'after-temp-open-before-write', targetPath: filePath, tempPath })
    await verifyParentIdentity(options.allowedRoot, filePath, parentIdentity)
    await verifyFileIdentity(tempPath, opened)
    contentWriteStarted = true
    await handle.writeFile(content, 'utf-8')
    await handle.sync()
    if (!sameFileIdentity(await handle.stat(), opened)) throw new Error(`Atomic temp handle changed: ${tempPath}`)
    await beforeRenameHookForTests?.(filePath, tempPath)
    await atomicBoundaryHookForTests?.({ stage: 'before-final-rename', targetPath: filePath, tempPath })
    await verifyParentIdentity(options.allowedRoot, filePath, parentIdentity)
    await verifyFileIdentity(tempPath, opened)
    await atomicBoundaryHookForTests?.({ stage: 'after-final-precheck-before-rename', targetPath: filePath, tempPath })
    if (!sameFileIdentity(await handle.stat(), opened)) throw new Error(`Atomic temp handle changed: ${tempPath}`)
    await rename(tempPath, filePath)
    await verifyParentIdentity(options.allowedRoot, filePath, parentIdentity)
    await verifyFileIdentity(filePath, opened)
    if (!sameFileIdentity(await handle.stat(), opened)) throw new Error(`Atomic destination handle changed: ${filePath}`)
    await handle.close()
    handle = undefined
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (opened) await cleanupOwnedEntry(tempPath, opened, options.allowedRoot, !contentWriteStarted)
    throw error
  }
}
