import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import {
  chmod,
  lstat,
  mkdir,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
} from 'fs/promises'
import { promisify } from 'util'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { WorkspaceConfig } from './config-schema'
import { buildExclusionPolicy } from './exclusions'
import { createSnapshotManifest, verifySnapshotManifest } from './manifest'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from './paths'
import { SnapshotRepository } from './snapshot-repository'
import {
  compareSnapshotPathBytes,
  normalizeSnapshotRelativePath,
  normalizeSnapshotSymlinkTarget,
  type SnapshotEntry,
  type SnapshotManifest,
  type WorkspaceSnapshot,
} from './schema'
import { appendTraceEvent } from '@/lib/traces/writer'
import {
  SafeIoSourceChangedError,
  copyFileNoFollow,
  hashFileNoFollow,
} from '@/lib/security/safe-io'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'

const execFileAsync = promisify(execFile)

export type SnapshotCaptureErrorCode =
  | 'SNAPSHOT_SOURCE_BUSY'
  | 'SNAPSHOT_UNSAFE_PATH'
  | 'SNAPSHOT_STORAGE_CORRUPT'
  | 'SNAPSHOT_QUOTA_EXCEEDED'
  | 'SNAPSHOT_CAPTURE_FAILED'
  | 'SNAPSHOT_PERSIST_FAILED'

export class SnapshotCaptureError extends Error {
  constructor(
    public readonly code: SnapshotCaptureErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly evidence?: SnapshotCommitEvidence,
  ) {
    super(message)
    this.name = 'SnapshotCaptureError'
  }
}

export interface CaptureSnapshotRequest {
  canonicalRoot: string
  runtimeDataRoot: string
  localWorkspaceId: string
  workflowRunId: string
  config: WorkspaceConfig
  requiredIncludes?: readonly string[]
  alwaysExcludedRoots?: readonly string[]
  actor?: string
}

export interface SnapshotCaptureDependencies {
  now?: () => Date
  createId?: () => string
  afterAttemptCopied?: (attempt: number) => Promise<void> | void
  beforeEntryStat?: (context: {
    attempt: number
    phase: 'before-copy' | 'after-copy'
    path: string
  }) => Promise<void> | void
  appendTrace?: typeof appendTraceEvent
}

export interface SnapshotCommitEvidence {
  commit_status: 'committed'
  trace_status: 'persisted' | 'failed'
  warning_code?: 'SNAPSHOT_TRACE_PERSIST_FAILED'
  warning?: string
}

export interface CaptureSnapshotResult {
  snapshot: WorkspaceSnapshot
  manifest: SnapshotManifest
  reused: boolean
  evidence: SnapshotCommitEvidence
}

type SourceKind = 'file' | 'directory' | 'symlink'

interface SourceItem {
  path: string
  sourcePath: string
  kind: SourceKind
  size: bigint
  mode: number
  mtimeNs: bigint
  device: bigint
  inode: bigint
  symlinkTarget: string | null
  symlinkType: 'file' | 'dir' | null
  blocked: boolean
}

interface Discovery {
  items: SourceItem[]
  blockedSymlinkPaths: string[]
}

interface GitEvidence {
  head: string | null
  dirty: boolean | null
  trackedFiles: Set<string> | null
  trackedDirectories: Set<string> | null
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
}

function isSameOrWithin(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLocaleLowerCase('en-US') : candidate
  const fromRoot = relative(normalizedRoot, normalizedCandidate)
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
}

function sameAbsolutePath(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return false
  const leftSegments = left.split(/[\\/]/)
  const rightSegments = right.split(/[\\/]/)
  if (leftSegments.some(segment => segment === '.' || segment === '..')) return false
  if (rightSegments.some(segment => segment === '.' || segment === '..')) return false
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right
}

function snapshotId(createId: () => string): string {
  return assertSafePathSegment(`snapshot-${createId()}`, 'snapshot id')
}

async function ensurePlainDirectory(root: string, segment: string): Promise<string> {
  assertSafePathSegment(segment, 'snapshot directory')
  const path = await resolvePathWithinRoot(root, segment)
  await mkdir(path, { recursive: false }).catch(error => {
    if (!isAlreadyExists(error)) throw error
  })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SnapshotCaptureError('SNAPSHOT_UNSAFE_PATH', 'Snapshot runtime path is not a plain directory')
  }
  return resolveExistingPathWithinRoot(root, segment)
}

async function allocatePlainDirectory(root: string, segment: string): Promise<string> {
  assertSafePathSegment(segment, 'snapshot staging directory')
  const path = await resolvePathWithinRoot(root, segment)
  await mkdir(path, { recursive: false })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SnapshotCaptureError('SNAPSHOT_UNSAFE_PATH', 'Snapshot staging path is not a plain directory')
  }
  return resolveExistingPathWithinRoot(root, segment)
}

async function resolveSnapshotStorageRoot(runtimeDataRoot: string, namespace: string): Promise<string> {
  try {
    const snapshotsRoot = await ensurePlainDirectory(runtimeDataRoot, 'snapshots')
    return await ensurePlainDirectory(snapshotsRoot, namespace)
  } catch (error) {
    if (error instanceof SnapshotCaptureError) throw error
    throw new SnapshotCaptureError(
      'SNAPSHOT_UNSAFE_PATH',
      'Snapshot runtime namespace failed containment validation',
      error,
    )
  }
}

async function removeContainedPath(root: string, path: string): Promise<void> {
  let contained: string
  try {
    contained = await resolveExistingPathWithinRoot(root, relative(root, path))
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  await rm(contained, { recursive: true, force: true })
}

function portableRelativePath(root: string, absolutePath: string): string {
  const value = relative(root, absolutePath).split(sep).join('/')
  try {
    return normalizeSnapshotRelativePath(value, 'source entry path')
  } catch (error) {
    throw new SnapshotCaptureError(
      'SNAPSHOT_UNSAFE_PATH',
      error instanceof Error ? error.message : 'Source entry has an unsafe path',
      error,
    )
  }
}

function statMode(mode: bigint): number {
  return Number(mode) & 0o777
}

function sameStatIdentity(
  stat: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; mode: bigint },
  item: Pick<SourceItem, 'device' | 'inode' | 'size' | 'mtimeNs' | 'mode'>,
): boolean {
  return stat.dev === item.device
    && stat.ino === item.inode
    && stat.size === item.size
    && stat.mtimeNs === item.mtimeNs
    && statMode(stat.mode) === item.mode
}

async function assertSourceItemUnchanged(item: SourceItem): Promise<void> {
  const current = await lstat(item.sourcePath, { bigint: true })
  if (!sameStatIdentity(current, item)) {
    throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', `Source changed during capture: ${item.path}`)
  }
}

async function inspectSymlink(
  sourceRoot: string,
  sourcePath: string,
  target: string,
): Promise<{ blocked: boolean; portableTarget: string | null; targetType: 'file' | 'dir' | null }> {
  const lexicalTarget = resolve(dirname(sourcePath), target)
  if (!isSameOrWithin(sourceRoot, lexicalTarget)) {
    return { blocked: true, portableTarget: null, targetType: null }
  }

  let resolvedTarget = lexicalTarget
  let targetType: 'file' | 'dir' | null = null
  try {
    resolvedTarget = await realpath(lexicalTarget)
    if (!isSameOrWithin(sourceRoot, resolvedTarget)) {
      return { blocked: true, portableTarget: null, targetType: null }
    }
    const targetStat = await lstat(resolvedTarget)
    targetType = targetStat.isDirectory() ? 'dir' : 'file'
  } catch (error) {
    if (!isMissing(error)) {
      return { blocked: true, portableTarget: null, targetType: null }
    }
  }

  const portableTarget = isAbsolute(target) || process.platform === 'win32'
    ? relative(dirname(sourcePath), resolvedTarget).split(sep).join('/')
    : target
  try {
    return {
      blocked: false,
      portableTarget: normalizeSnapshotSymlinkTarget(
        portableRelativePath(sourceRoot, sourcePath),
        portableTarget,
      ),
      targetType,
    }
  } catch {
    return { blocked: true, portableTarget: null, targetType: null }
  }
}

async function discoverSource(
  sourceRoot: string,
  shouldExclude: (path: string, directory?: boolean) => boolean,
  beforeEntryStat?: (path: string) => Promise<void> | void,
): Promise<Discovery> {
  const items: SourceItem[] = []
  const seenPortablePaths = new Set<string>()

  async function walk(directory: string, expectedDirectory?: SourceItem): Promise<void> {
    if (expectedDirectory) await assertSourceItemUnchanged(expectedDirectory)
    const resolvedDirectory = await realpath(directory)
    if (!isSameOrWithin(sourceRoot, resolvedDirectory)) {
      throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', 'Source directory escaped during capture')
    }
    const directoryIdentity = await lstat(directory, { bigint: true })
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) {
      throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', 'Source directory changed during capture')
    }
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => compareSnapshotPathBytes(left.name.normalize('NFC'), right.name.normalize('NFC')))

    for (const child of children) {
      const sourcePath = join(directory, child.name)
      const path = portableRelativePath(sourceRoot, sourcePath)
      await beforeEntryStat?.(path)
      const currentDirectory = await lstat(directory, { bigint: true })
      if (
        currentDirectory.dev !== directoryIdentity.dev
        || currentDirectory.ino !== directoryIdentity.ino
        || !currentDirectory.isDirectory()
        || currentDirectory.isSymbolicLink()
      ) {
        throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', 'Source directory changed during capture')
      }
      const stat = await lstat(sourcePath, { bigint: true })
      const kind: SourceKind = stat.isSymbolicLink()
        ? 'symlink'
        : stat.isDirectory()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : (() => { throw new SnapshotCaptureError('SNAPSHOT_UNSAFE_PATH', `Unsupported source entry type: ${path}`) })()

      if (shouldExclude(path, kind === 'directory')) {
        continue
      }
      if (seenPortablePaths.has(path)) {
        throw new SnapshotCaptureError(
          'SNAPSHOT_UNSAFE_PATH',
          `Multiple source entries normalize to the same portable path: ${path}`,
        )
      }
      seenPortablePaths.add(path)

      const rawTarget = kind === 'symlink' ? await readlink(sourcePath) : null
      const symlink = rawTarget == null
        ? { blocked: false, portableTarget: null, targetType: null }
        : await inspectSymlink(sourceRoot, sourcePath, rawTarget)
      const item: SourceItem = {
        path,
        sourcePath,
        kind,
        size: stat.size,
        mode: statMode(stat.mode),
        mtimeNs: stat.mtimeNs,
        device: stat.dev,
        inode: stat.ino,
        symlinkTarget: symlink.portableTarget,
        symlinkType: symlink.targetType,
        blocked: symlink.blocked,
      }
      items.push(item)
      if (kind === 'directory') await walk(sourcePath, item)
    }
  }

  await walk(sourceRoot)
  items.sort((left, right) => compareSnapshotPathBytes(left.path, right.path))
  return {
    items,
    blockedSymlinkPaths: items.filter(item => item.blocked).map(item => item.path),
  }
}

function sourceIdentity(item: SourceItem): string {
  return [
    item.path,
    item.kind,
    item.size.toString(),
    item.mode.toString(),
    item.mtimeNs.toString(),
    item.device.toString(),
    item.inode.toString(),
    item.symlinkTarget ?? '',
    item.symlinkType ?? '',
    item.blocked ? 'blocked' : 'allowed',
  ].join('\0')
}

function sameDiscovery(before: Discovery, after: Discovery): boolean {
  if (before.items.length !== after.items.length) return false
  return before.items.every((item, index) => sourceIdentity(item) === sourceIdentity(after.items[index]!))
}

function enforceDiscoveryLimits(discovery: Discovery, limits: WorkspaceConfig['workspace']): void {
  const included = discovery.items.filter(item => !item.blocked)
  if (included.length > limits.max_files) {
    throw new SnapshotCaptureError(
      'SNAPSHOT_QUOTA_EXCEEDED',
      `Snapshot contains ${included.length} entries, exceeding the configured file limit`,
    )
  }
  let totalBytes = BigInt(0)
  for (const item of included) {
    if (item.kind !== 'file') continue
    totalBytes += item.size
    if (totalBytes > BigInt(limits.max_bytes_each) || totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SnapshotCaptureError(
        'SNAPSHOT_QUOTA_EXCEEDED',
        'Snapshot bytes exceed the configured safe capture limit',
      )
    }
  }
}

async function copyDiscovery(
  sourceRoot: string,
  discovery: Discovery,
  treeRoot: string,
  maxBytes: number,
): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = []
  await mkdir(treeRoot, { recursive: true })

  for (const item of discovery.items) {
    if (item.blocked) continue
    const segments = item.path.split('/')
    const destination = await resolvePathWithinRoot(treeRoot, ...segments)
    if (item.kind === 'directory') {
      await mkdir(destination, { recursive: false })
      const created = await lstat(destination)
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new SnapshotCaptureError('SNAPSHOT_UNSAFE_PATH', `Unsafe snapshot directory: ${item.path}`)
      }
      await resolveExistingPathWithinRoot(treeRoot, ...segments)
      entries.push({
        path: item.path,
        kind: 'directory',
        sha256: null,
        size_bytes: 0,
        mode: item.mode,
        symlink_target: null,
      })
      continue
    }

    await mkdir(dirname(destination), { recursive: true })
    if (segments.length > 1) {
      await resolveExistingPathWithinRoot(treeRoot, ...segments.slice(0, -1))
    }
    if (item.kind === 'symlink') {
      await symlink(item.symlinkTarget!, destination, item.symlinkType ?? undefined)
      entries.push({
        path: item.path,
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: item.mode,
        symlink_target: normalizeSnapshotSymlinkTarget(item.path, item.symlinkTarget!),
      })
      continue
    }

    await assertSourceItemUnchanged(item)
    const containedSource = await resolveExistingPathWithinRoot(sourceRoot, ...segments)
    if (containedSource !== item.sourcePath) {
      throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', `Source path changed during capture: ${item.path}`)
    }
    const copiedResult = await copyFileNoFollow(item.sourcePath, destination, {
      expectedSource: {
        dev: item.device,
        ino: item.inode,
        size: item.size,
        mtimeNs: item.mtimeNs,
      },
      maxBytes,
    })
    await assertSourceItemUnchanged(item)
    const copied = await lstat(destination, { bigint: true })
    if (!copied.isFile() || copied.size !== item.size || copiedResult.sizeBytes !== Number(item.size)) {
      throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', `Source changed while copying ${item.path}`)
    }
    entries.push({
      path: item.path,
      kind: 'file',
      sha256: `sha256:${copiedResult.sha256}`,
      size_bytes: copiedResult.sizeBytes,
      mode: item.mode,
      symlink_target: null,
    })
  }

  return entries
}

async function listTreePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  async function walk(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const absolute = join(directory, child.name)
      const path = portableRelativePath(root, absolute)
      paths.push(path)
      const stat = await lstat(absolute)
      if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(absolute)
    }
  }
  await walk(root)
  return paths.sort(compareSnapshotPathBytes)
}

async function verifyTree(treeRoot: string, manifest: SnapshotManifest): Promise<void> {
  verifySnapshotManifest(manifest)
  const expectedPaths = manifest.entries.map(entry => entry.path)
  const actualPaths = await listTreePaths(treeRoot)
  if (expectedPaths.length !== actualPaths.length || expectedPaths.some((path, index) => path !== actualPaths[index])) {
    throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', 'Snapshot tree paths do not match its manifest')
  }

  for (const entry of manifest.entries) {
    const path = join(treeRoot, ...entry.path.split('/'))
    const stat = await lstat(path, { bigint: true })
    if (entry.kind === 'file') {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', `Snapshot entry kind mismatch: ${entry.path}`)
      const hashed = await hashFileNoFollow(path, entry.size_bytes)
      if (Number(stat.size) !== entry.size_bytes || `sha256:${hashed.sha256}` !== entry.sha256) {
        throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', `Snapshot file verification failed: ${entry.path}`)
      }
    } else if (entry.kind === 'directory') {
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', `Snapshot entry kind mismatch: ${entry.path}`)
    } else {
      const rawTarget = stat.isSymbolicLink() ? await readlink(path) : null
      const target = rawTarget == null
        ? null
        : isAbsolute(rawTarget)
          ? relative(dirname(path), rawTarget).split(sep).join('/')
          : process.platform === 'win32'
            ? rawTarget.replaceAll('\\', '/')
            : rawTarget
      if (target !== entry.symlink_target) {
        throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', `Snapshot symlink verification failed: ${entry.path}`)
      }
    }
  }
}

async function makeTreeReadOnly(treeRoot: string, manifest: SnapshotManifest): Promise<void> {
  for (const entry of [...manifest.entries].reverse()) {
    if (entry.kind === 'symlink') continue
    const path = await resolveExistingPathWithinRoot(treeRoot, ...entry.path.split('/'))
    const mode = entry.kind === 'directory'
      ? ((entry.mode ?? 0o755) & ~0o222) | 0o111
      : (entry.mode ?? 0o644) & ~0o222
    await chmod(path, mode)
  }
  await chmod(treeRoot, 0o555)
}

async function resolvePlainContentTree(snapshotsRoot: string, manifest: SnapshotManifest): Promise<string> {
  const digest = assertSafePathSegment(
    manifest.root_manifest_hash.slice('sha256:'.length),
    'snapshot content digest',
  )
  const finalRoot = await resolveExistingPathWithinRoot(snapshotsRoot, digest)
  const finalStat = await lstat(finalRoot)
  if (!finalStat.isDirectory() || finalStat.isSymbolicLink()) {
    throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', 'Snapshot content root is not a plain directory')
  }
  const tree = await resolveExistingPathWithinRoot(snapshotsRoot, digest, 'tree')
  const treeStat = await lstat(tree)
  if (!treeStat.isDirectory() || treeStat.isSymbolicLink()) {
    throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', 'Snapshot tree is not a plain directory')
  }
  return tree
}

async function promoteContentTree(
  stagingRoot: string,
  snapshotsRoot: string,
  manifest: SnapshotManifest,
): Promise<string> {
  const digest = manifest.root_manifest_hash.slice('sha256:'.length)
  assertSafePathSegment(digest, 'snapshot content digest')
  const finalRoot = await resolvePathWithinRoot(snapshotsRoot, digest)
  const stagingSegment = assertSafePathSegment(relative(snapshotsRoot, stagingRoot), 'snapshot staging id')
  const verifiedStagingRoot = await resolveExistingPathWithinRoot(snapshotsRoot, stagingSegment)
  const stagingStat = await lstat(verifiedStagingRoot)
  if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
    throw new SnapshotCaptureError('SNAPSHOT_UNSAFE_PATH', 'Snapshot staging root is not a plain directory')
  }
  const stagedTree = await resolveExistingPathWithinRoot(snapshotsRoot, stagingSegment, 'tree')
  await verifyTree(stagedTree, manifest)

  try {
    await rename(verifiedStagingRoot, finalRoot)
  } catch (error) {
    try {
      await lstat(finalRoot)
    } catch {
      throw error
    }
    const existingTree = await resolvePlainContentTree(snapshotsRoot, manifest)
    await verifyTree(existingTree, manifest)
    await makeTreeReadOnly(existingTree, manifest)
    await removeContainedPath(snapshotsRoot, stagingRoot)
    return existingTree
  }

  const promotedTree = await resolvePlainContentTree(snapshotsRoot, manifest)
  await verifyTree(promotedTree, manifest)
  await makeTreeReadOnly(promotedTree, manifest)
  return promotedTree
}

function parseGitPathSet(output: string): { files: Set<string>; directories: Set<string> } {
  const files = new Set<string>()
  const directories = new Set<string>()
  for (const rawPath of output.split('\0').filter(Boolean)) {
    const path = normalizeSnapshotRelativePath(rawPath, 'Git tracked path')
    files.add(path)
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return { files, directories }
}

async function gitEvidence(canonicalRoot: string, includeUntracked: boolean): Promise<GitEvidence> {
  try {
    const commands = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: canonicalRoot, timeout: 3_000, windowsHide: true, maxBuffer: 1_048_576 }),
      execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: canonicalRoot, timeout: 3_000, windowsHide: true, maxBuffer: 1_048_576 }),
      includeUntracked
        ? Promise.resolve({ stdout: '' })
        : execFileAsync('git', ['ls-files', '-z'], { cwd: canonicalRoot, timeout: 3_000, windowsHide: true, maxBuffer: 16_777_216 }),
    ])
    const tracked = includeUntracked ? null : parseGitPathSet(commands[2].stdout)
    return {
      head: commands[0].stdout.trim() || null,
      dirty: commands[1].stdout.length > 0,
      trackedFiles: tracked?.files ?? null,
      trackedDirectories: tracked?.directories ?? null,
    }
  } catch {
    return { head: null, dirty: null, trackedFiles: null, trackedDirectories: null }
  }
}

function newSnapshotRecord(input: {
  id: string
  localWorkspaceId: string
  workflowRunId: string
  sourceRoot: string
  contentRoot: string | null
  status: 'ready' | 'failed'
  rootManifestHash: string | null
  exclusionPolicyHash: string
  manifest: SnapshotManifest
  blockedSymlinkPaths: string[]
  retries: number
  git: GitEvidence
  createdAt: string
  verifiedAt: string | null
  errorCode: string | null
}): WorkspaceSnapshot {
  const metrics = verifySnapshotManifest(input.manifest)
  return {
    schema_version: 1,
    id: input.id,
    local_workspace_id: input.localWorkspaceId,
    workflow_run_id: input.workflowRunId,
    source_root: input.sourceRoot,
    content_root: input.contentRoot,
    manifest_ref: input.status === 'ready' ? `.threados/snapshots/${input.id}/manifest.json` : null,
    status: input.status,
    root_manifest_hash: input.rootManifestHash,
    exclusion_policy_hash: input.exclusionPolicyHash,
    file_count: input.status === 'ready' ? metrics.fileCount : 0,
    total_bytes: input.status === 'ready' ? metrics.totalBytes : 0,
    git_head: input.git.head,
    git_dirty: input.git.dirty,
    created_at: input.createdAt,
    verified_at: input.verifiedAt,
    error_code: input.errorCode,
    directory_count: input.status === 'ready' ? metrics.directoryCount : 0,
    symlink_count: input.status === 'ready' ? metrics.symlinkCount : 0,
    blocked_symlink_paths: input.blockedSymlinkPaths,
    source_retry_count: input.retries,
  }
}

async function appendSnapshotTrace(
  request: CaptureSnapshotRequest,
  snapshot: WorkspaceSnapshot,
  eventType: 'snapshot-created' | 'snapshot-reused' | 'snapshot-failed',
  traceAppender: typeof appendTraceEvent,
  timestamp: string,
): Promise<SnapshotCommitEvidence> {
  try {
    await traceAppender(request.canonicalRoot, request.workflowRunId, {
      ts: timestamp,
      run_id: request.workflowRunId,
      surface_id: snapshot.id,
      actor: request.actor ?? 'threados-runtime',
      event_type: eventType,
      payload_ref: snapshot.manifest_ref ?? `.threados/snapshots/${snapshot.id}`,
      policy_ref: snapshot.exclusion_policy_hash,
    })
    return { commit_status: 'committed', trace_status: 'persisted' }
  } catch {
    return {
      commit_status: 'committed',
      trace_status: 'failed',
      warning_code: 'SNAPSHOT_TRACE_PERSIST_FAILED',
      warning: 'Snapshot committed, but snapshot trace projection persistence failed.',
    }
  }
}

function asCaptureError(error: unknown): SnapshotCaptureError {
  if (error instanceof SnapshotCaptureError) return error
  return new SnapshotCaptureError(
    'SNAPSHOT_CAPTURE_FAILED',
    error instanceof Error ? error.message : 'Snapshot capture failed',
    error,
  )
}

function isRetryableSourceError(error: unknown): boolean {
  return error instanceof SafeIoSourceChangedError
    || error instanceof SnapshotCaptureError && error.code === 'SNAPSHOT_SOURCE_BUSY'
    || error instanceof Error
      && 'code' in error
      && ['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP', 'EINVAL', 'ESTALE'].includes(String(error.code))
}

export async function captureSnapshot(
  request: CaptureSnapshotRequest,
  dependencies: SnapshotCaptureDependencies = {},
): Promise<CaptureSnapshotResult> {
  const now = dependencies.now ?? (() => new Date())
  const createId = dependencies.createId ?? randomUUID
  const traceAppender = dependencies.appendTrace ?? appendTraceEvent
  const createdAt = now().toISOString()
  const sourceRoot = await realpath(request.canonicalRoot)
  let runtimeDataRoot: string
  try {
    runtimeDataRoot = await resolveRuntimeDataRoot({
      canonicalRoot: sourceRoot,
      override: request.runtimeDataRoot,
    })
  } catch (error) {
    throw new SnapshotCaptureError(
      'SNAPSHOT_UNSAFE_PATH',
      error instanceof Error ? error.message : 'Snapshot runtime root is unsafe',
      error,
    )
  }
  await mkdir(runtimeDataRoot, { recursive: true })
  const runtimePaths = resolveWorkspaceRuntimePaths(
    runtimeDataRoot,
    request.localWorkspaceId,
    sourceRoot,
  )
  let snapshotsRoot = await resolveSnapshotStorageRoot(
    runtimeDataRoot,
    runtimePaths.workspaceNamespace,
  )
  const policy = await buildExclusionPolicy({
    canonicalRoot: sourceRoot,
    config: request.config,
    requiredIncludes: [...(request.requiredIncludes ?? [])],
    alwaysExcludedRoots: [runtimeDataRoot, ...(request.alwaysExcludedRoots ?? [])],
  })
  const repository = new SnapshotRepository(sourceRoot)
  const git = await gitEvidence(sourceRoot, request.config.snapshot.include_untracked)
  const shouldExclude = (path: string, directory = false): boolean => {
    if (policy.shouldExclude(path, directory)) return true
    if (request.config.snapshot.include_untracked || git.trackedFiles == null || git.trackedDirectories == null) {
      return false
    }
    return directory ? !git.trackedDirectories.has(path) : !git.trackedFiles.has(path)
  }
  const id = snapshotId(createId)
  let retries = 0
  let lastDiscovery: Discovery = { items: [], blockedSymlinkPaths: [] }
  let latestStagingRoot: string | null = null

  try {
    while (true) {
      snapshotsRoot = await resolveSnapshotStorageRoot(
        runtimeDataRoot,
        runtimePaths.workspaceNamespace,
      )
      let discovery: Discovery
      let manifest: SnapshotManifest
      try {
        discovery = await discoverSource(sourceRoot, shouldExclude, path => (
          dependencies.beforeEntryStat?.({
            attempt: retries + 1,
            phase: 'before-copy',
            path,
          })
        ))
        enforceDiscoveryLimits(discovery, request.config.workspace)
        lastDiscovery = discovery
        const stagingSegment = assertSafePathSegment(`staging-${createId()}`, 'snapshot staging id')
        latestStagingRoot = await allocatePlainDirectory(snapshotsRoot, stagingSegment)
        const treeRoot = await allocatePlainDirectory(latestStagingRoot, 'tree')
        const entries = await copyDiscovery(
          sourceRoot,
          discovery,
          treeRoot,
          request.config.workspace.max_bytes_each,
        )
        manifest = createSnapshotManifest(id, entries)
        await dependencies.afterAttemptCopied?.(retries + 1)
        const after = await discoverSource(sourceRoot, shouldExclude, path => (
          dependencies.beforeEntryStat?.({
            attempt: retries + 1,
            phase: 'after-copy',
            path,
          })
        ))
        enforceDiscoveryLimits(after, request.config.workspace)
        if (!sameDiscovery(discovery, after)) {
          throw new SnapshotCaptureError('SNAPSHOT_SOURCE_BUSY', 'Source changed during capture')
        }
      } catch (error) {
        if (latestStagingRoot) {
          const currentSnapshotsRoot = await resolveSnapshotStorageRoot(
            runtimeDataRoot,
            runtimePaths.workspaceNamespace,
          )
          await removeContainedPath(currentSnapshotsRoot, latestStagingRoot)
        }
        latestStagingRoot = null
        if (!isRetryableSourceError(error)) throw error
        if (retries >= request.config.snapshot.max_source_retries) {
          throw new SnapshotCaptureError(
            'SNAPSHOT_SOURCE_BUSY',
            `Source did not stabilize after ${retries + 1} capture attempts`,
            error,
          )
        }
        retries += 1
        continue
      }

      const identical = (await repository.list()).find(snapshot => (
        snapshot.status === 'ready'
        && snapshot.root_manifest_hash === manifest.root_manifest_hash
        && snapshot.exclusion_policy_hash === policy.exclusionPolicyHash
        && snapshot.source_root === sourceRoot
        && snapshot.local_workspace_id === request.localWorkspaceId
        && snapshot.workflow_run_id === request.workflowRunId
        && snapshot.git_head === git.head
        && snapshot.git_dirty === git.dirty
        && JSON.stringify(snapshot.blocked_symlink_paths) === JSON.stringify(discovery.blockedSymlinkPaths)
      ))
      if (identical?.content_root) {
        const existingManifest = await repository.getManifest(identical.id)
        if (!existingManifest) throw new SnapshotCaptureError('SNAPSHOT_STORAGE_CORRUPT', 'Reusable snapshot manifest is missing')
        const expectedContentRoot = await resolvePlainContentTree(snapshotsRoot, existingManifest)
        if (!sameAbsolutePath(identical.content_root, expectedContentRoot)) {
          throw new SnapshotCaptureError(
            'SNAPSHOT_STORAGE_CORRUPT',
            'Reusable snapshot content root does not match its content-addressed location',
          )
        }
        await verifyTree(expectedContentRoot, existingManifest)
        await removeContainedPath(snapshotsRoot, latestStagingRoot)
        latestStagingRoot = null
        const evidence = await appendSnapshotTrace(
          request,
          identical,
          'snapshot-reused',
          traceAppender,
          now().toISOString(),
        )
        return {
          snapshot: { ...identical, content_root: expectedContentRoot },
          manifest: existingManifest,
          reused: true,
          evidence,
        }
      }

      const contentRoot = await promoteContentTree(latestStagingRoot, snapshotsRoot, manifest)
      latestStagingRoot = null
      const snapshot = newSnapshotRecord({
        id,
        localWorkspaceId: request.localWorkspaceId,
        workflowRunId: request.workflowRunId,
        sourceRoot,
        contentRoot,
        status: 'ready',
        rootManifestHash: manifest.root_manifest_hash,
        exclusionPolicyHash: policy.exclusionPolicyHash,
        manifest,
        blockedSymlinkPaths: discovery.blockedSymlinkPaths,
        retries,
        git,
        createdAt,
        verifiedAt: now().toISOString(),
        errorCode: null,
      })
      await repository.create(snapshot, manifest)
      const evidence = await appendSnapshotTrace(
        request,
        snapshot,
        'snapshot-created',
        traceAppender,
        now().toISOString(),
      )
      return { snapshot, manifest, reused: false, evidence }
    }

  } catch (rawError) {
    if (latestStagingRoot) {
      await resolveSnapshotStorageRoot(runtimeDataRoot, runtimePaths.workspaceNamespace)
        .then(root => removeContainedPath(root, latestStagingRoot!))
        .catch(() => undefined)
    }
    const error = asCaptureError(rawError)
    const failureManifest = createSnapshotManifest(id, [])
    const failed = newSnapshotRecord({
      id,
      localWorkspaceId: request.localWorkspaceId,
      workflowRunId: request.workflowRunId,
      sourceRoot,
      contentRoot: null,
      status: 'failed',
      rootManifestHash: null,
      exclusionPolicyHash: policy.exclusionPolicyHash,
      manifest: failureManifest,
      blockedSymlinkPaths: lastDiscovery.blockedSymlinkPaths,
      retries,
      git,
      createdAt,
      verifiedAt: null,
      errorCode: error.code,
    })
    try {
      await repository.create(failed, failureManifest)
    } catch (persistenceError) {
      throw new SnapshotCaptureError(
        'SNAPSHOT_PERSIST_FAILED',
        `Snapshot capture failed and failure evidence could not be persisted: ${error.message}`,
        persistenceError,
      )
    }
    const failureEvidence = await appendSnapshotTrace(
      request,
      failed,
      'snapshot-failed',
      traceAppender,
      now().toISOString(),
    )
    if (failureEvidence.trace_status === 'failed') {
      throw new SnapshotCaptureError(
        error.code,
        error.message,
        error.cause,
        failureEvidence,
      )
    }
    throw error
  }
}
