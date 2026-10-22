import { createHash } from 'crypto'
import { constants, type BigIntStats } from 'fs'
import { lstat, open, type FileHandle } from 'fs/promises'

type SafeIoOperation = 'append' | 'copy-destination' | 'copy-source' | 'read' | 'write'
type BeforeOpenHook = (context: {
  operation: SafeIoOperation
  filePath: string
}) => Promise<void> | void
type AfterOpenHook = BeforeOpenHook

let beforeOpenHookForTests: BeforeOpenHook | null = null
let afterOpenHookForTests: AfterOpenHook | null = null

export type SafeCopyExpectedIdentity = {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
}

export type SafeCopyOptions = {
  expectedSource?: SafeCopyExpectedIdentity
  maxBytes?: number
}

export type SafeCopyResult = {
  sizeBytes: number
  sha256: string
}

export class SafeIoSourceChangedError extends Error {
  readonly code = 'SAFE_IO_SOURCE_CHANGED'

  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'SafeIoSourceChangedError'
  }
}

type OpenedFileIdentity = SafeCopyExpectedIdentity & {
  mode: bigint
}

const STREAM_BUFFER_BYTES = 64 * 1024
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER)

export function setSafeIoBeforeOpenHookForTests(hook: BeforeOpenHook | null): void {
  beforeOpenHookForTests = hook
}

export function setSafeIoAfterOpenHookForTests(hook: AfterOpenHook | null): void {
  afterOpenHookForTests = hook
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
  const handle = await open(filePath, flags, mode)
  try {
    await afterOpenHookForTests?.({ operation, filePath })
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isSourcePathDriftError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.startsWith('Refusing unsafe final file path')) return true
  return 'code' in error && ['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP', 'EINVAL', 'ESTALE'].includes(String(error.code))
}

async function verifyOpenedIdentity(filePath: string, handle: FileHandle): Promise<void> {
  const opened = await handle.stat()
  const current = await lstat(filePath)

  if (current.isSymbolicLink() || !current.isFile()) {
    throw new Error(`Refusing unsafe final file path: ${filePath}`)
  }
  if (opened.dev !== current.dev || opened.ino !== current.ino) {
    throw new SafeIoSourceChangedError(`Source path was replaced before reading: ${filePath}`)
  }
}

function identityFromStats(stats: BigIntStats): OpenedFileIdentity {
  if (!stats.isFile()) {
    throw new Error('Refusing unsafe source: expected a regular file')
  }
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    mode: stats.mode,
  }
}

function identitiesMatch(
  left: SafeCopyExpectedIdentity,
  right: SafeCopyExpectedIdentity,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
}

function openedIdentitiesMatch(left: OpenedFileIdentity, right: OpenedFileIdentity): boolean {
  return identitiesMatch(left, right) && left.mode === right.mode
}

async function readVerifiedIdentity(filePath: string, handle: FileHandle): Promise<OpenedFileIdentity> {
  const opened = identityFromStats(await handle.stat({ bigint: true }))
  const currentStats = await lstat(filePath, { bigint: true })
  if (currentStats.isSymbolicLink() || !currentStats.isFile()) {
    throw new Error(`Refusing unsafe final file path: ${filePath}`)
  }
  const current = identityFromStats(currentStats)
  if (!openedIdentitiesMatch(opened, current)) {
    throw new Error(`Refusing unsafe final file path identity: ${filePath}`)
  }
  return opened
}

function validateExpectedIdentity(
  actual: OpenedFileIdentity,
  expected: SafeCopyExpectedIdentity | undefined,
  filePath: string,
): void {
  if (expected && !identitiesMatch(actual, expected)) {
    throw new SafeIoSourceChangedError(`Source identity does not match expected identity: ${filePath}`)
  }
}

function normalizeMaxBytes(maxBytes: number | undefined): bigint {
  if (maxBytes === undefined) {
    return MAX_SAFE_BYTES
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('maxBytes must be a non-negative safe integer')
  }
  return BigInt(maxBytes)
}

function enforceByteLimit(size: bigint, maxBytes: bigint): void {
  if (size > maxBytes) {
    throw new Error('File exceeds maxBytes')
  }
  if (size > MAX_SAFE_BYTES) {
    throw new Error('File byte count exceeds Number.MAX_SAFE_INTEGER')
  }
}

async function openNewExclusive(filePath: string): Promise<FileHandle> {
  const handle = await openPath(
    filePath,
    exclusiveCreateFlags(
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      'wx',
    ),
    'copy-destination',
    0o600,
  )
  try {
    await readVerifiedIdentity(filePath, handle)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function streamFile(
  source: FileHandle,
  maxBytes: bigint,
  destination?: FileHandle,
): Promise<SafeCopyResult> {
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(STREAM_BUFFER_BYTES)
  let totalBytes = BigInt(0)

  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null)
    if (bytesRead === 0) {
      break
    }

    totalBytes += BigInt(bytesRead)
    enforceByteLimit(totalBytes, maxBytes)
    const chunk = buffer.subarray(0, bytesRead)
    digest.update(chunk)

    if (destination) {
      let written = 0
      while (written < bytesRead) {
        const { bytesWritten } = await destination.write(
          chunk,
          written,
          bytesRead - written,
          null,
        )
        if (bytesWritten <= 0 || bytesWritten > bytesRead - written) {
          throw new Error('Unable to complete safe file copy: writer made no valid progress')
        }
        written += bytesWritten
      }
    }
  }

  return {
    sizeBytes: Number(totalBytes),
    sha256: digest.digest('hex'),
  }
}

async function verifySourceUnchanged(
  filePath: string,
  handle: FileHandle,
  initial: OpenedFileIdentity,
): Promise<void> {
  let finalIdentity: OpenedFileIdentity
  try {
    finalIdentity = await readVerifiedIdentity(filePath, handle)
  } catch (error) {
    throw new SafeIoSourceChangedError(`Source path changed while reading: ${filePath}`, error)
  }
  if (!openedIdentitiesMatch(initial, finalIdentity)) {
    throw new SafeIoSourceChangedError(`Source identity changed while reading: ${filePath}`)
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

export async function readTextFileNoFollow(filePath: string, expectedSource?: SafeCopyExpectedIdentity): Promise<string> {
  let handle: FileHandle | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      handle = await openExistingVerified(filePath, constants.O_RDONLY, 'read')
      break
    } catch (error) {
      // Atomic JSON writers legitimately replace an inode. Retry a fresh,
      // no-follow open; pinned assets must fail on any identity replacement.
      if (expectedSource || !(error instanceof SafeIoSourceChangedError) || attempt === 2) throw error
    }
  }
  if (!handle) throw new Error('Unable to open a stable regular file')
  try {
    const initial = expectedSource ? await readVerifiedIdentity(filePath, handle) : undefined
    if (initial) validateExpectedIdentity(initial, expectedSource, filePath)
    const content = await handle.readFile('utf-8')
    if (initial) await verifySourceUnchanged(filePath, handle, initial)
    return content
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

export async function hashFileNoFollow(
  filePath: string,
  maxBytes?: number,
): Promise<SafeCopyResult> {
  const byteLimit = normalizeMaxBytes(maxBytes)
  const source = await openExistingVerified(filePath, constants.O_RDONLY, 'read')
  try {
    const initial = await readVerifiedIdentity(filePath, source)
    enforceByteLimit(initial.size, byteLimit)
    const result = await streamFile(source, byteLimit)
    await verifySourceUnchanged(filePath, source, initial)
    if (BigInt(result.sizeBytes) !== initial.size) {
      throw new Error(`Source size changed while reading: ${filePath}`)
    }
    return result
  } finally {
    await source.close()
  }
}

export async function copyFileNoFollow(
  sourcePath: string,
  destinationPath: string,
  options: SafeCopyOptions = {},
): Promise<SafeCopyResult> {
  const byteLimit = normalizeMaxBytes(options.maxBytes)
  let source: FileHandle
  try {
    source = await openExistingVerified(sourcePath, constants.O_RDONLY, 'copy-source')
  } catch (error) {
    if (options.expectedSource && isSourcePathDriftError(error)) {
      throw new SafeIoSourceChangedError(`Source path changed before copy: ${sourcePath}`, error)
    }
    throw error
  }
  try {
    let initial: OpenedFileIdentity
    try {
      initial = await readVerifiedIdentity(sourcePath, source)
    } catch (error) {
      if (options.expectedSource && isSourcePathDriftError(error)) {
        throw new SafeIoSourceChangedError(`Source path changed before copy: ${sourcePath}`, error)
      }
      throw error
    }
    validateExpectedIdentity(initial, options.expectedSource, sourcePath)
    enforceByteLimit(initial.size, byteLimit)

    const destination = await openNewExclusive(destinationPath)
    try {
      const result = await streamFile(source, byteLimit, destination)
      await verifySourceUnchanged(sourcePath, source, initial)
      if (BigInt(result.sizeBytes) !== initial.size) {
        throw new SafeIoSourceChangedError(`Source size changed while reading: ${sourcePath}`)
      }
      await readVerifiedIdentity(destinationPath, destination)
      return result
    } finally {
      await destination.close()
    }
  } finally {
    await source.close()
  }
}
