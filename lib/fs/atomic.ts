import { randomUUID } from 'crypto'
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'

type BeforeRenameHook = (targetPath: string, tempPath: string) => Promise<void> | void
export type AtomicBoundaryStage = 'before-lock-open' | 'before-temp-open' | 'before-final-rename'
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

async function verifyFileIdentity(path: string, expected: Awaited<ReturnType<FileHandle['stat']>>): Promise<void> {
  const current = await lstat(path)
  if (current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`Refusing replaced filesystem entry: ${path}`)
  }
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
  const recoverable = age >= staleAfterMs || (observed.owner != null && !isProcessAlive(observed.owner.pid))
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

  while (!handle) {
    try {
      await atomicBoundaryHookForTests?.({ stage: 'before-lock-open', targetPath: lockPath })
      await verifyParentWithinRoot(normalized.allowedRoot, lockPath)
      handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(JSON.stringify(owner), 'utf-8')
      await handle.sync()
      const opened = await handle.stat()
      await verifyFileIdentity(lockPath, opened)
      await verifyParentWithinRoot(normalized.allowedRoot, lockPath)
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined)
        handle = undefined
      }
      if (!hasCode(error, 'EEXIST')) throw error
      if (await recoverOrphanedLock(lockPath, normalized.allowedRoot, staleAfterMs)) continue
      if (Date.now() >= deadline) throw new RuntimeLockTimeoutError(lockPath)
      await pause(5)
    }
  }

  const ownedStat = await handle.stat()
  try {
    return await operation()
  } finally {
    await handle.close()
    try {
      await verifyParentWithinRoot(normalized.allowedRoot, lockPath)
      await verifyFileIdentity(lockPath, ownedStat)
      await unlink(lockPath)
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error
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

  try {
    await atomicBoundaryHookForTests?.({ stage: 'before-temp-open', targetPath: filePath, tempPath })
    await verifyParentWithinRoot(options.allowedRoot, filePath)
    const handle = await open(tempPath, 'wx', 0o600)
    const opened = await handle.stat()
    try {
      await handle.writeFile(content, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await beforeRenameHookForTests?.(filePath, tempPath)
    await atomicBoundaryHookForTests?.({ stage: 'before-final-rename', targetPath: filePath, tempPath })
    await verifyParentWithinRoot(options.allowedRoot, filePath)
    await verifyFileIdentity(tempPath, opened)
    await rename(tempPath, filePath)
    await verifyParentWithinRoot(options.allowedRoot, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}
