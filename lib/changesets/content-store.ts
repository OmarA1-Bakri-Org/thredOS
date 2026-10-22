import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { chmod, lstat, mkdir, open, readdir, rename, rm } from 'fs/promises'
import { join } from 'path'
import { copyFileNoFollow, hashFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { hashSha256Bytes } from '../workspaces/hash'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function plainDirectory(runtimeRoot: string, segments: readonly string[]): Promise<string> {
  let current = runtimeRoot
  for (let length = 0; length <= segments.length; length += 1) {
    if (length > 0) current = join(current, segments[length - 1]!)
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('CHANGE_SET_UNSAFE_STORAGE: nonplain directory')
    }
    await resolveExistingPathWithinRoot(runtimeRoot, ...segments.slice(0, length))
  }
  return current
}

async function ensurePlainDirectory(runtimeRoot: string, segments: readonly string[]): Promise<string> {
  for (let length = 1; length <= segments.length; length += 1) {
    const path = await resolvePathWithinRoot(runtimeRoot, ...segments.slice(0, length))
    await mkdir(path).catch(error => { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error })
    await plainDirectory(runtimeRoot, segments.slice(0, length))
  }
  return plainDirectory(runtimeRoot, segments)
}

export class ChangeSetContentStore {
  private readonly segments: string[]

  constructor(private readonly runtimeDataRoot: string, namespace: string, runId: string, attemptId: string) {
    this.segments = ['changesets', assertSafePathSegment(namespace, 'namespace'),
      assertSafePathSegment(runId, 'run id'), assertSafePathSegment(attemptId, 'attempt id')]
  }

  async stage(): Promise<StagedContent> {
    const parent = this.segments.slice(0, -1)
    await ensurePlainDirectory(this.runtimeDataRoot, parent)
    const stageName = assertSafePathSegment(`${this.segments.at(-1)}.staging-${randomUUID()}`, 'staging directory')
    const stageSegments = [...parent, stageName]
    const stageRoot = await resolvePathWithinRoot(this.runtimeDataRoot, ...stageSegments)
    await mkdir(stageRoot)
    await plainDirectory(this.runtimeDataRoot, stageSegments)
    await mkdir(join(stageRoot, 'blobs'))
    await plainDirectory(this.runtimeDataRoot, [...stageSegments, 'blobs'])
    return new StagedContent(this.runtimeDataRoot, stageSegments, this.segments)
  }

  async verify(ref: string, digest: string, size?: number): Promise<boolean> {
    const name = assertSafePathSegment(ref.replace(/^blobs\//, ''), 'blob digest')
    if (ref !== `blobs/${name}` || name !== digest.slice(7)) return false
    await plainDirectory(this.runtimeDataRoot, [...this.segments, 'blobs'])
    const path = await resolveExistingPathWithinRoot(this.runtimeDataRoot, ...this.segments, 'blobs', name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o222) !== 0) return false
    const hashed = await hashFileNoFollow(path)
    return `sha256:${hashed.sha256}` === digest && (size == null || hashed.sizeBytes === size)
  }

  async read(ref: string, digest: string, maxBytes: number): Promise<Buffer | null> {
    const name = assertSafePathSegment(ref.replace(/^blobs\//, ''), 'blob digest')
    if (ref !== `blobs/${name}` || name !== digest.slice(7)) throw new Error('CHANGE_SET_CONTENT_CORRUPT')
    await plainDirectory(this.runtimeDataRoot, [...this.segments, 'blobs'])
    const path = await resolveExistingPathWithinRoot(this.runtimeDataRoot, ...this.segments, 'blobs', name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o222) !== 0) {
      throw new Error('CHANGE_SET_CONTENT_CORRUPT')
    }
    if (stat.size > maxBytes) return null
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const data = await file.readFile()
      if (data.length !== stat.size || hashSha256Bytes(data) !== digest) throw new Error('CHANGE_SET_CONTENT_CORRUPT')
      return data
    } finally { await file.close() }
  }
}

export class StagedContent {
  constructor(
    private readonly runtimeRoot: string,
    private readonly stageSegments: string[],
    private readonly destinationSegments: string[],
  ) {}

  async copy(path: string, digest: string, size: number): Promise<string> {
    const name = assertSafePathSegment(digest.slice(7), 'blob digest')
    const ref = `blobs/${name}`
    const blobRoot = await plainDirectory(this.runtimeRoot, [...this.stageSegments, 'blobs'])
    const destination = await resolvePathWithinRoot(this.runtimeRoot, ...this.stageSegments, 'blobs', name)
    if (destination !== join(blobRoot, name)) throw new Error('CHANGE_SET_UNSAFE_STORAGE: blob path mismatch')
    try {
      const result = await copyFileNoFollow(path, destination, { maxBytes: size })
      if (`sha256:${result.sha256}` !== digest || result.sizeBytes !== size) {
        throw new Error('CHANGE_SET_SOURCE_RACED: changed bytes differ from final manifest')
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (`sha256:${(await hashFileNoFollow(destination)).sha256}` !== digest) throw error
    }
    return ref
  }

  async classify(ref: string): Promise<'text' | 'binary'> {
    const name = assertSafePathSegment(ref.replace(/^blobs\//, ''), 'blob digest')
    if (ref !== `blobs/${name}`) throw new Error('CHANGE_SET_UNSAFE_STORAGE: invalid blob ref')
    await plainDirectory(this.runtimeRoot, [...this.stageSegments, 'blobs'])
    const path = await resolveExistingPathWithinRoot(this.runtimeRoot, ...this.stageSegments, 'blobs', name)
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat()
      if (stat.size > 64 * 1024) return 'binary'
      const data = await file.readFile()
      if (data.includes(0)) return 'binary'
      try { new TextDecoder('utf-8', { fatal: true }).decode(data); return 'text' } catch { return 'binary' }
    } finally { await file.close() }
  }

  async commit(): Promise<void> {
    const source = await plainDirectory(this.runtimeRoot, this.stageSegments)
    const parent = await plainDirectory(this.runtimeRoot, this.destinationSegments.slice(0, -1))
    const destination = await resolvePathWithinRoot(this.runtimeRoot, ...this.destinationSegments)
    if (destination !== join(parent, this.destinationSegments.at(-1)!)) throw new Error('CHANGE_SET_UNSAFE_STORAGE: destination mismatch')
    try {
      await lstat(destination)
      await this.verifyExisting(source)
      await this.dispose()
      await this.seal()
      return
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    await rename(source, destination)
    await this.seal()
  }

  private async verifyExisting(source: string): Promise<void> {
    const destination = await plainDirectory(this.runtimeRoot, this.destinationSegments)
    const sourceBlobRoot = await plainDirectory(this.runtimeRoot, [...this.stageSegments, 'blobs'])
    const destBlobRoot = await plainDirectory(this.runtimeRoot, [...this.destinationSegments, 'blobs'])
    const sourceNames = await readdir(sourceBlobRoot)
    const targetNames = await readdir(destBlobRoot)
    if (sourceNames.length !== targetNames.length || sourceNames.some(name => !targetNames.includes(name))) {
      throw new Error('CHANGE_SET_CONTENT_CONFLICT')
    }
    if (source !== join(this.runtimeRoot, ...this.stageSegments) || destination !== join(this.runtimeRoot, ...this.destinationSegments)) {
      throw new Error('CHANGE_SET_UNSAFE_STORAGE: content root mismatch')
    }
    for (const name of sourceNames) {
      assertSafePathSegment(name, 'blob digest')
      const path = await resolveExistingPathWithinRoot(this.runtimeRoot, ...this.destinationSegments, 'blobs', name)
      if (`sha256:${(await hashFileNoFollow(path)).sha256}` !== `sha256:${name}`) throw new Error('CHANGE_SET_CONTENT_CORRUPT')
    }
  }

  private async seal(): Promise<void> {
    const blobRoot = await plainDirectory(this.runtimeRoot, [...this.destinationSegments, 'blobs'])
    for (const name of await readdir(blobRoot)) {
      assertSafePathSegment(name, 'blob digest')
      const path = await resolveExistingPathWithinRoot(this.runtimeRoot, ...this.destinationSegments, 'blobs', name)
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw new Error('CHANGE_SET_UNSAFE_STORAGE: blob is not a plain file')
      }
      if (`sha256:${(await hashFileNoFollow(path)).sha256}` !== `sha256:${name}`) {
        throw new Error('CHANGE_SET_CONTENT_CORRUPT')
      }
      await chmod(path, 0o444)
    }
  }

  async dispose(): Promise<void> {
    try {
      await rm(await plainDirectory(this.runtimeRoot, this.stageSegments), { recursive: true, force: true })
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}
