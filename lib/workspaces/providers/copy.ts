import { randomUUID } from 'crypto'
import {
  chmod,
  lstat,
  mkdir,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
} from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { copyFileNoFollow, hashFileNoFollow } from '@/lib/security/safe-io'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import type { SnapshotRepository } from '../snapshot-repository'
import { verifySnapshotManifest } from '../manifest'
import { canonicalizeProspectivePath } from '../paths'
import { WorkspaceQuotaError, WorkspaceQuotaTracker, assertProvisionQuota } from '../quotas'
import type { WorkspaceRepository } from '../repository'
import {
  compareSnapshotPathBytes,
  normalizeSnapshotRelativePath,
  normalizeSnapshotSymlinkTarget,
  type SnapshotEntry,
  type SnapshotManifest,
  type SurfaceWorkspace,
  type WorkspaceSnapshot,
} from '../schema'
import type {
  ProvisionWorkspaceRequest,
  SurfaceWorkspaceProvider,
  SurfaceWorkspaceState,
  WorkspaceProviderCapabilities,
} from './provider'

export type CopyWorkspaceErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_SOURCE_INVALID'
  | 'WORKSPACE_COPY_FAILED'
  | 'WORKSPACE_STORAGE_UNSAFE'
  | 'WORKSPACE_ACTIVE'
  | 'WORKSPACE_INVALID_STATE'
  | 'WORKSPACE_QUOTA_EXCEEDED'
  | 'WORKSPACE_RECOVERY_REQUIRED'

export class CopyWorkspaceError extends Error {
  constructor(
    public readonly code: CopyWorkspaceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CopyWorkspaceError'
  }
}

export interface CopyWorkspaceProviderOptions {
  repository: WorkspaceRepository
  workspacesRoot: string
  snapshotsRoot: string
  snapshotRepository: SnapshotRepository
  now?: () => Date
  createId?: () => string
  afterEntryCopied?: (entry: SnapshotEntry) => Promise<void> | void
}

function sameAbsolutePath(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return false
  if (left.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) return false
  if (right.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) return false
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right
}

function isSameOrWithin(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLocaleLowerCase('en-US') : candidate
  const fromRoot = relative(normalizedRoot, normalizedCandidate)
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function fileMode(value: bigint): number {
  return Number(value) & 0o777
}

function portableRelativePath(root: string, absolutePath: string): string {
  return normalizeSnapshotRelativePath(
    relative(root, absolutePath).split(sep).join('/'),
    'workspace tree path',
  )
}

async function listTreePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareSnapshotPathBytes(left.name.normalize('NFC'), right.name.normalize('NFC')))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const path = portableRelativePath(root, absolute)
      paths.push(path)
      const stat = await lstat(absolute)
      if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(absolute)
    }
  }
  await walk(root)
  return paths.sort(compareSnapshotPathBytes)
}

function normalizedReadlink(target: string): string {
  return process.platform === 'win32' ? target.replaceAll('\\', '/') : target
}

export async function verifyWorkspaceTree(
  treeRoot: string,
  manifest: SnapshotManifest,
  options: { requireImmutable?: boolean; verifyMode?: boolean } = {},
): Promise<void> {
  verifySnapshotManifest(manifest)
  const rootStat = await lstat(treeRoot, { bigint: true })
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Workspace tree root is not a plain directory')
  }
  if (options.requireImmutable && (fileMode(rootStat.mode) & 0o222) !== 0) {
    throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Snapshot tree root is writable')
  }

  const expected = manifest.entries.map(entry => entry.path)
  const actual = await listTreePaths(treeRoot)
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Workspace tree paths do not match the snapshot manifest')
  }

  for (const entry of manifest.entries) {
    const absolute = join(treeRoot, ...entry.path.split('/'))
    const stat = await lstat(absolute, { bigint: true })
    if (entry.kind === 'file') {
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace entry kind mismatch: ${entry.path}`)
      }
      if (options.requireImmutable && (fileMode(stat.mode) & 0o222) !== 0) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Snapshot file is writable: ${entry.path}`)
      }
      const hashed = await hashFileNoFollow(absolute, entry.size_bytes)
      if (hashed.sizeBytes !== entry.size_bytes || `sha256:${hashed.sha256}` !== entry.sha256) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace file verification failed: ${entry.path}`)
      }
      if (options.verifyMode && process.platform !== 'win32' && fileMode(stat.mode) !== (entry.mode ?? 0o644)) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace file mode mismatch: ${entry.path}`)
      }
      continue
    }

    if (entry.kind === 'directory') {
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace entry kind mismatch: ${entry.path}`)
      }
      if (options.requireImmutable && (fileMode(stat.mode) & 0o222) !== 0) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Snapshot directory is writable: ${entry.path}`)
      }
      if (options.verifyMode && process.platform !== 'win32' && fileMode(stat.mode) !== (entry.mode ?? 0o755)) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace directory mode mismatch: ${entry.path}`)
      }
      continue
    }

    if (!stat.isSymbolicLink()) {
      throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace entry kind mismatch: ${entry.path}`)
    }
    const target = normalizedReadlink(await readlink(absolute))
    const normalized = normalizeSnapshotSymlinkTarget(entry.path, target)
    if (normalized !== entry.symlink_target) {
      throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Workspace symlink target mismatch: ${entry.path}`)
    }
  }
}

async function ensurePlainRoot(path: string): Promise<string> {
  const lexical = resolve(path)
  const prospective = await canonicalizeProspectivePath(lexical)
  if (!sameAbsolutePath(lexical, prospective)) {
    throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace storage root resolves through a symlink')
  }
  await mkdir(lexical, { recursive: true })
  const stat = await lstat(lexical)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace storage root is not a plain directory')
  }
  const resolved = await realpath(lexical)
  if (!sameAbsolutePath(lexical, resolved)) {
    throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace storage root is not canonical')
  }
  return resolved
}

async function ensureRunDirectory(workspacesRoot: string, workflowRunId: string): Promise<string> {
  const runId = assertSafePathSegment(workflowRunId, 'workflow run id')
  const candidate = await resolvePathWithinRoot(workspacesRoot, runId)
  await mkdir(candidate).catch(error => {
    if (!isExists(error)) throw error
  })
  const stat = await lstat(candidate)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace run root is not a plain directory')
  }
  return resolveExistingPathWithinRoot(workspacesRoot, runId)
}

export function copyWorkspaceTreePath(
  workspacesRoot: string,
  workflowRunId: string,
  workspaceId: string,
): string {
  return join(
    workspacesRoot,
    assertSafePathSegment(workflowRunId, 'workflow run id'),
    assertSafePathSegment(workspaceId, 'workspace id'),
    'tree',
  )
}

async function removeOwnedDirectory(root: string, path: string): Promise<void> {
  try {
    const contained = await resolveExistingPathWithinRoot(root, relative(root, path))
    await rm(contained, { recursive: true, force: true })
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

function sourceError(error: unknown): CopyWorkspaceError {
  if (error instanceof CopyWorkspaceError) return error
  if (error instanceof WorkspaceQuotaError) {
    return new CopyWorkspaceError('WORKSPACE_QUOTA_EXCEEDED', error.message, error)
  }
  return new CopyWorkspaceError(
    'WORKSPACE_COPY_FAILED',
    error instanceof Error ? error.message : 'Workspace copy failed',
    error,
  )
}

async function assertVerifiedSnapshotSource(
  snapshot: WorkspaceSnapshot,
  manifest: SnapshotManifest,
  snapshotsRoot: string,
): Promise<string> {
  if (manifest.entries.some(entry => (
    entry.path === '.threados'
    || entry.path.startsWith('.threados/')
    || entry.path === '.git'
    || entry.path.startsWith('.git/')
  ))) {
    throw new CopyWorkspaceError(
      'WORKSPACE_SOURCE_INVALID',
      'Workspace snapshot contains prohibited control metadata',
    )
  }
  if (
    snapshot.status !== 'ready'
    || snapshot.content_root == null
    || snapshot.root_manifest_hash !== manifest.root_manifest_hash
    || snapshot.id !== manifest.snapshot_id
  ) {
    throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Workspace source is not a verified ready snapshot')
  }
  const verifiedSnapshotsRoot = await ensurePlainRoot(snapshotsRoot)
  const digest = assertSafePathSegment(
    manifest.root_manifest_hash.slice('sha256:'.length),
    'snapshot content digest',
  )
  const expectedContentRoot = await resolveExistingPathWithinRoot(
    verifiedSnapshotsRoot,
    digest,
    'tree',
  )
  if (!sameAbsolutePath(snapshot.content_root, expectedContentRoot)) {
    throw new CopyWorkspaceError(
      'WORKSPACE_SOURCE_INVALID',
      'Workspace snapshot content root is not its canonical content-addressed path',
    )
  }
  const sourceRoot = await realpath(snapshot.source_root)
  const contentRoot = expectedContentRoot
  if (isSameOrWithin(sourceRoot, contentRoot) || isSameOrWithin(contentRoot, sourceRoot)) {
    throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Workspace source must be an external immutable snapshot tree')
  }
  await verifyWorkspaceTree(contentRoot, manifest, { requireImmutable: true })
  return contentRoot
}

async function copyManifestTree(
  sourceRoot: string,
  destinationRoot: string,
  manifest: SnapshotManifest,
  limits: ProvisionWorkspaceRequest['limits'],
  afterEntryCopied?: (entry: SnapshotEntry) => Promise<void> | void,
): Promise<void> {
  const tracker = new WorkspaceQuotaTracker(limits)
  await mkdir(destinationRoot)

  for (const entry of manifest.entries) {
    tracker.recordEntry(entry.size_bytes, entry.kind === 'file')
    const destination = join(destinationRoot, ...entry.path.split('/'))
    const source = join(sourceRoot, ...entry.path.split('/'))
    if (entry.kind === 'directory') {
      await mkdir(destination)
    } else if (entry.kind === 'file') {
      const result = await copyFileNoFollow(source, destination, { maxBytes: entry.size_bytes })
      if (result.sizeBytes !== entry.size_bytes || `sha256:${result.sha256}` !== entry.sha256) {
        throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', `Snapshot file changed during copy: ${entry.path}`)
      }
      const sourceIdentity = await lstat(source, { bigint: true })
      const destinationIdentity = await lstat(destination, { bigint: true })
      if (sourceIdentity.dev === destinationIdentity.dev && sourceIdentity.ino === destinationIdentity.ino) {
        throw new CopyWorkspaceError('WORKSPACE_COPY_FAILED', `Hardlink detected while copying ${entry.path}`)
      }
      await chmod(destination, entry.mode ?? 0o644)
    } else {
      const target = normalizeSnapshotSymlinkTarget(entry.path, entry.symlink_target!)
      let targetType: 'file' | 'dir' | undefined
      if (process.platform === 'win32') {
        try {
          targetType = (await stat(resolve(dirname(source), target))).isDirectory() ? 'dir' : 'file'
        } catch {
          targetType = 'file'
        }
      }
      await symlink(target, destination, targetType)
    }
    await afterEntryCopied?.(entry)
  }

  for (const entry of [...manifest.entries].reverse()) {
    if (entry.kind !== 'directory') continue
    await chmod(join(destinationRoot, ...entry.path.split('/')), entry.mode ?? 0o755)
  }
}

export class CopyWorkspaceProvider implements SurfaceWorkspaceProvider {
  readonly id = 'copy' as const
  private readonly manifests = new Map<string, SnapshotManifest>()
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly options: CopyWorkspaceProviderOptions) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  capabilities(): WorkspaceProviderCapabilities {
    return {
      provider: 'copy',
      isolationLabel: 'THREADOS_SCOPED',
      supportsInternalSymlinks: true,
      usesHardlinks: false,
      requiresGit: false,
    }
  }

  async provision(request: ProvisionWorkspaceRequest): Promise<SurfaceWorkspace> {
    const workspace = await this.options.repository.get(request.workspaceId)
    if (!workspace) throw new CopyWorkspaceError('WORKSPACE_NOT_FOUND', `workspace ${request.workspaceId} was not found`)
    if (workspace.status !== 'planned') {
      throw new CopyWorkspaceError('WORKSPACE_INVALID_STATE', `workspace ${workspace.id} is not planned`)
    }
    if (workspace.snapshot_id !== request.snapshot.id) {
      throw new CopyWorkspaceError('WORKSPACE_SOURCE_INVALID', 'Workspace record does not bind the requested snapshot')
    }

    let stagingContainer: string | null = null
    let finalContainer: string | null = null
    let promoted = false
    let current = workspace
    try {
      const storedSnapshot = await this.options.snapshotRepository.get(request.snapshot.id)
      const storedManifest = await this.options.snapshotRepository.getManifest(request.snapshot.id)
      if (
        !storedSnapshot
        || !storedManifest
        || storedSnapshot.content_root !== request.snapshot.content_root
        || storedSnapshot.root_manifest_hash !== request.snapshot.root_manifest_hash
        || storedManifest.root_manifest_hash !== request.manifest.root_manifest_hash
        || storedManifest.snapshot_id !== request.manifest.snapshot_id
      ) {
        throw new CopyWorkspaceError(
          'WORKSPACE_SOURCE_INVALID',
          'Workspace source does not match the canonical snapshot repository',
        )
      }
      verifySnapshotManifest(request.manifest)
      assertProvisionQuota(
        await this.options.repository.list(),
        request.manifest,
        request.limits,
        { excludeWorkspaceId: workspace.id },
      )
      const sourceRoot = await assertVerifiedSnapshotSource(
        storedSnapshot,
        storedManifest,
        this.options.snapshotsRoot,
      )
      const workspacesRoot = await ensurePlainRoot(this.options.workspacesRoot)
      if (isSameOrWithin(sourceRoot, workspacesRoot) || isSameOrWithin(workspacesRoot, sourceRoot)) {
        throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace storage must not overlap snapshot storage')
      }
      const runRoot = await ensureRunDirectory(workspacesRoot, workspace.workflow_run_id)
      const workspaceId = assertSafePathSegment(workspace.id, 'workspace id')
      const stagingId = assertSafePathSegment(
        `staging-${workspaceId}-${this.createId()}`,
        'workspace staging id',
      )
      stagingContainer = await resolvePathWithinRoot(runRoot, stagingId)
      finalContainer = await resolvePathWithinRoot(runRoot, workspaceId)
      try {
        await lstat(finalContainer)
        throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', `Workspace destination already exists: ${workspace.id}`)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await mkdir(stagingContainer)
      const stagingTree = join(stagingContainer, 'tree')

      current = await this.options.repository.update(workspace.id, current.revision, value => ({
        ...value,
        status: 'materializing',
      }))
      await copyManifestTree(
        sourceRoot,
        stagingTree,
        request.manifest,
        request.limits,
        this.options.afterEntryCopied,
      )
      await verifyWorkspaceTree(stagingTree, request.manifest, { verifyMode: true })
      await rename(stagingContainer, finalContainer)
      promoted = true
      stagingContainer = null
      const finalTree = join(finalContainer, 'tree')
      await verifyWorkspaceTree(finalTree, request.manifest, { verifyMode: true })
      if (!sameAbsolutePath(finalTree, workspace.root_path)) {
        throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace record root does not match provider destination')
      }

      const metrics = verifySnapshotManifest(request.manifest)
      const ready = await this.options.repository.update(workspace.id, current.revision, value => ({
        ...value,
        status: 'ready',
        manifest_hash: request.manifest.root_manifest_hash,
        file_count: metrics.fileCount,
        total_bytes: metrics.totalBytes,
        ready_at: this.now().toISOString(),
        error_code: null,
      }))
      this.manifests.set(workspace.id, request.manifest)
      return ready
    } catch (rawError) {
      const error = sourceError(rawError)
      const recoveryErrors: unknown[] = []
      const cleanupRoot = await ensurePlainRoot(this.options.workspacesRoot).catch(cleanupError => {
        recoveryErrors.push(cleanupError)
        return null
      })
      if (stagingContainer) {
        if (cleanupRoot) {
          await removeOwnedDirectory(cleanupRoot, stagingContainer)
            .catch(cleanupError => recoveryErrors.push(cleanupError))
        }
      }
      if (promoted && finalContainer && cleanupRoot) {
        await removeOwnedDirectory(cleanupRoot, finalContainer)
          .catch(cleanupError => recoveryErrors.push(cleanupError))
      }
      const latest = await this.options.repository.get(workspace.id)
      const ownsLatestState = latest != null
        && latest.id === current.id
        && latest.revision === current.revision
        && latest.status === current.status
      if (ownsLatestState && latest.status !== 'failed' && latest.status !== 'cleaned') {
        await this.options.repository.update(workspace.id, latest.revision, value => ({
          ...value,
          status: 'failed',
          manifest_hash: null,
          file_count: 0,
          total_bytes: 0,
          reserved_bytes: recoveryErrors.length > 0 ? value.reserved_bytes : 0,
          ready_at: null,
          cleaned_at: null,
          error_code: recoveryErrors.length > 0 ? 'WORKSPACE_RECOVERY_REQUIRED' : error.code,
        })).catch(persistenceError => recoveryErrors.push(persistenceError))
      }
      if (recoveryErrors.length > 0) {
        throw new CopyWorkspaceError(
          'WORKSPACE_RECOVERY_REQUIRED',
          `Workspace provisioning failed and cleanup or failure persistence also failed: ${error.message}`,
          new AggregateError([rawError, ...recoveryErrors]),
        )
      }
      throw error
    }
  }

  async inspect(workspaceId: string): Promise<SurfaceWorkspaceState> {
    const workspace = await this.options.repository.get(workspaceId)
    if (!workspace) throw new CopyWorkspaceError('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} was not found`)
    let treeExists = false
    try {
      const stat = await lstat(workspace.root_path)
      treeExists = stat.isDirectory() && !stat.isSymbolicLink()
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (!treeExists) {
      return { workspace, treeExists: false, manifestValid: null, hasUsefulOutput: null, issue: 'missing_tree' }
    }

    const manifest = this.manifests.get(workspace.id)
      ?? await this.options.snapshotRepository.getManifest(workspace.snapshot_id)
      ?? null
    if (!manifest) {
      return { workspace, treeExists: true, manifestValid: null, hasUsefulOutput: null, issue: 'manifest_unavailable' }
    }
    try {
      await verifyWorkspaceTree(workspace.root_path, manifest, { verifyMode: false })
      return { workspace, treeExists: true, manifestValid: true, hasUsefulOutput: false, issue: null }
    } catch (error) {
      return {
        workspace,
        treeExists: true,
        manifestValid: false,
        hasUsefulOutput: true,
        issue: error instanceof Error ? error.message : 'invalid_manifest',
      }
    }
  }

  async freeze(workspaceId: string): Promise<SurfaceWorkspace> {
    const workspace = await this.options.repository.get(workspaceId)
    if (!workspace) throw new CopyWorkspaceError('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} was not found`)
    if (workspace.status !== 'ready' && workspace.status !== 'active') {
      throw new CopyWorkspaceError('WORKSPACE_INVALID_STATE', `workspace ${workspaceId} cannot be frozen from ${workspace.status}`)
    }
    return this.options.repository.update(workspace.id, workspace.revision, current => ({
      ...current,
      status: 'frozen',
    }))
  }

  async destroy(workspaceId: string): Promise<void> {
    let workspace = await this.options.repository.get(workspaceId)
    if (!workspace) throw new CopyWorkspaceError('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} was not found`)
    if (workspace.status === 'active') {
      throw new CopyWorkspaceError('WORKSPACE_ACTIVE', `workspace ${workspaceId} is active and cannot be destroyed`)
    }
    if (workspace.status === 'materializing') {
      throw new CopyWorkspaceError(
        'WORKSPACE_INVALID_STATE',
        `workspace ${workspaceId} is materializing and cannot be destroyed`,
      )
    }
    if (workspace.status === 'cleaned') return

    const expectedRoot = copyWorkspaceTreePath(
      this.options.workspacesRoot,
      workspace.workflow_run_id,
      workspace.id,
    )
    if (!sameAbsolutePath(expectedRoot, workspace.root_path)) {
      throw new CopyWorkspaceError('WORKSPACE_STORAGE_UNSAFE', 'Workspace record root does not match provider storage')
    }
    if (workspace.status !== 'cleaning') {
      workspace = await this.options.repository.update(workspace.id, workspace.revision, current => ({
        ...current,
        status: 'cleaning',
        error_code: null,
      }))
    }
    const container = dirname(workspace.root_path)
    try {
      const cleanupRoot = await ensurePlainRoot(this.options.workspacesRoot)
      await removeOwnedDirectory(cleanupRoot, container)
    } catch (error) {
      const latest = await this.options.repository.get(workspace.id) ?? workspace
      await this.options.repository.update(latest.id, latest.revision, current => ({
        ...current,
        status: 'failed',
        error_code: 'WORKSPACE_RECOVERY_REQUIRED',
      })).catch(() => undefined)
      throw new CopyWorkspaceError(
        'WORKSPACE_RECOVERY_REQUIRED',
        `workspace ${workspaceId} cleanup failed and requires recovery`,
        error,
      )
    }
    workspace = await this.options.repository.get(workspace.id) ?? workspace
    try {
      await this.options.repository.update(workspace.id, workspace.revision, current => ({
        ...current,
        status: 'cleaned',
        reserved_bytes: 0,
        cleaned_at: this.now().toISOString(),
        error_code: null,
      }))
    } catch (error) {
      throw new CopyWorkspaceError(
        'WORKSPACE_RECOVERY_REQUIRED',
        `workspace ${workspaceId} tree was removed but cleaned state was not persisted`,
        error,
      )
    }
    this.manifests.delete(workspace.id)
  }
}
