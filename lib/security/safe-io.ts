import { constants } from 'fs'
import { lstat, open, type FileHandle } from 'fs/promises'

type SafeIoOperation = 'append' | 'copy-destination' | 'copy-source' | 'read' | 'write'
type BeforeOpenHook = (context: {
  operation: SafeIoOperation
  filePath: string
}) => Promise<void> | void

let beforeOpenHookForTests: BeforeOpenHook | null = null

export function setSafeIoBeforeOpenHookForTests(hook: BeforeOpenHook | null): void {
  beforeOpenHookForTests = hook
}

function withNoFollow(flags: number): number {
  return typeof constants.O_NOFOLLOW === 'number' ? flags | constants.O_NOFOLLOW : flags
}

function exclusiveCreateFlags(flags: number, fallback: string): number | string {
  return typeof constants.O_NOFOLLOW === 'number'
    ? flags | constants.O_NOFOLLOW
    : fallback
}

async function openPath(
  filePath: string,
  flags: number | string,
  operation: SafeIoOperation,
  mode?: number,
): Promise<FileHandle> {
  await beforeOpenHookForTests?.({ operation, filePath })
  return open(filePath, flags, mode)
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function verifyOpenedIdentity(filePath: string, handle: FileHandle): Promise<void> {
  const opened = await handle.stat()
  const current = await lstat(filePath)

  if (
    current.isSymbolicLink()
    || opened.dev !== current.dev
    || opened.ino !== current.ino
  ) {
    throw new Error(`Refusing unsafe final file path: ${filePath}`)
  }
}

async function openExistingVerified(
  filePath: string,
  flags: number,
  operation: SafeIoOperation,
): Promise<FileHandle> {
  const handle = await openPath(filePath, withNoFollow(flags), operation)
  try {
    await verifyOpenedIdentity(filePath, handle)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function openWritableVerified(
  filePath: string,
  existingFlags: number,
  createFallbackFlags: string,
  operation: 'append' | 'copy-destination' | 'write',
): Promise<FileHandle> {
  try {
    return await openPath(
      filePath,
      exclusiveCreateFlags(
        existingFlags | constants.O_CREAT | constants.O_EXCL,
        createFallbackFlags,
      ),
      operation,
      0o600,
    )
  } catch (error) {
    if (!isErrorWithCode(error, 'EEXIST')) {
      throw error
    }
  }

  return openExistingVerified(filePath, existingFlags, operation)
}

async function writeAll(
  handle: FileHandle,
  content: string,
  windowsStartPosition: number,
): Promise<void> {
  const encoded = Buffer.from(content, 'utf-8')
  let offset = 0

  while (offset < encoded.byteLength) {
    const remaining = encoded.byteLength - offset
    const position = process.platform === 'win32' ? windowsStartPosition + offset : null
    const { bytesWritten } = await handle.write(encoded, offset, remaining, position)
    if (bytesWritten <= 0 || bytesWritten > remaining) {
      throw new Error('Unable to complete safe file write: writer made no valid progress')
    }
    offset += bytesWritten
  }
}

export async function appendFileNoFollow(filePath: string, content: string): Promise<void> {
  const handle = await openWritableVerified(
    filePath,
    constants.O_WRONLY | constants.O_APPEND,
    'ax',
    'append',
  )
  try {
    const current = await handle.stat()
    await writeAll(handle, content, current.size)
  } finally {
    await handle.close()
  }
}

export async function readTextFileNoFollow(filePath: string): Promise<string> {
  const handle = await openExistingVerified(filePath, constants.O_RDONLY, 'read')
  try {
    return await handle.readFile('utf-8')
  } finally {
    await handle.close()
  }
}

export async function writeFileNoFollow(filePath: string, content: string): Promise<void> {
  const handle = await openWritableVerified(filePath, constants.O_WRONLY, 'wx', 'write')
  try {
    await handle.truncate(0)
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
}

export async function copyFileNoFollow(sourcePath: string, destinationPath: string): Promise<void> {
  const source = await openExistingVerified(sourcePath, constants.O_RDONLY, 'copy-source')
  try {
    const content = await source.readFile()
    const destination = await openWritableVerified(
      destinationPath,
      constants.O_WRONLY,
      'wx',
      'copy-destination',
    )
    try {
      await destination.truncate(0)
      await destination.writeFile(content)
    } finally {
      await destination.close()
    }
  } finally {
    await source.close()
  }
}
