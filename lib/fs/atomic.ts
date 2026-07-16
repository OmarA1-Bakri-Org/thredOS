import { lstat, open, rename, unlink, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

type BeforeRenameHook = (targetPath: string, tempPath: string) => Promise<void> | void

let beforeRenameHookForTests: BeforeRenameHook | null = null

export function setAtomicBeforeRenameHookForTests(hook: BeforeRenameHook | null): void {
  beforeRenameHookForTests = hook
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * Serializes a filesystem transaction across processes. The lock is deliberately
 * a sibling of the protected record so a successful acquisition covers the same
 * directory entry namespace as the later atomic rename.
 */
export async function withExclusiveFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  timeoutMs = 5_000,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let handle

  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600)
      const opened = await handle.stat()
      const current = await lstat(lockPath)
      if (current.isSymbolicLink() || opened.dev !== current.dev || opened.ino !== current.ino) {
        throw new Error(`Refusing unsafe lock path: ${lockPath}`)
      }
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined)
        handle = undefined
      }
      if (!hasCode(error, 'EEXIST') || Date.now() >= deadline) throw error
      await pause(5)
    }
  }

  try {
    return await operation()
  } finally {
    await handle.close()
    await unlink(lockPath).catch(error => {
      if (!hasCode(error, 'ENOENT')) throw error
    })
  }
}

/**
 * Atomically writes a file by writing to a temp file first, then renaming.
 * This prevents partial writes from corrupting the file.
 *
 * @param filePath - The target file path
 * @param content - The content to write
 */
export async function writeFileAtomic(
  filePath: string,
  content: string
): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })

  const tempPath = join(dir, `.${randomUUID()}.tmp`)

  try {
    const handle = await open(tempPath, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await beforeRenameHookForTests?.(filePath, tempPath)
    await rename(tempPath, filePath)
  } catch (error) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath)
    } catch {
      // Ignore cleanup errors - temp file may not exist
    }
    throw error
  }
}
