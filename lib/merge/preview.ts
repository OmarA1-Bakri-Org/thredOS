import { createHash, randomUUID } from 'crypto'
import { chmod, lstat, mkdir, readlink, realpath, rename, rm, stat, symlink, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { ChangeSetSchema, type ChangeSet } from '../changesets/schema'
import { copyFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { createSnapshotManifest, verifySnapshotManifest } from '../workspaces/manifest'
import { hashCanonicalJson } from '../workspaces/hash'
import { canonicalizeProspectivePath } from '../workspaces/paths'
import { verifyWorkspaceTree } from '../workspaces/providers/copy'
import { inspectCanonicalManifest, type CaptureSnapshotRequest } from '../workspaces/snapshot'
import { compareSnapshotPathBytes, normalizeSnapshotRelativePath, normalizeSnapshotSymlinkTarget,
  type SnapshotEntry, type SnapshotManifest } from '../workspaces/schema'
import { planThreeInputMerge } from './planner'
import type { MergePlanBinding, MergeRecordRepository } from './repository'
import type { MergePlan, MergePreview, ThreeInputMergeRequest } from './schema'

export interface MaterializeMergePreviewRequest {
  canonicalRoot: string
  runtimeDataRoot: string
  previewStorageRoot: string
  config: CaptureSnapshotRequest['config']
  localWorkspaceId?: string
  workflowRunId?: string
  plan: MergePlan
  records: MergeRecordRepository
  previewId: string
  mergeInput: ThreeInputMergeRequest
  readCandidateFile: (entry: SnapshotEntry) => Promise<Buffer>
  loadSelectedChangeSet: (id: string) => Promise<ChangeSet | null>
  persistValidationEvidence?: (decision: MergePreview, manifest: SnapshotManifest) => Promise<void>
  afterEntryCopied?: (entry: SnapshotEntry) => Promise<void> | void
  removePartialDirectory?: (path: string) => Promise<void>
}

export interface MaterializedMergePreview {
  id: string
  rootPath: string
  manifest: SnapshotManifest
  decision: MergePreview
}

function sameOrWithin(root: string, path: string): boolean {
  const left = process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root
  const right = process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
  const from = relative(left, right)
  return from === '' || (!isAbsolute(from) && from !== '..' && !from.startsWith(`..${sep}`))
}

function sameAbsolutePath(left: string, right: string): boolean {
  return sameOrWithin(left, right) && sameOrWithin(right, left)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function mergeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'MERGE_PREVIEW_FAILED'
  const code = error.message.split(':')[0]
  return /^MERGE_[A-Z_]+$/.test(code) ? code : 'MERGE_PREVIEW_FAILED'
}

async function assertSelectedChangeSets(request: MaterializeMergePreviewRequest, plan: MergePlan,
  binding: MergePlanBinding): Promise<void> {
  for (const selected of binding.selected_change_sets) {
    const raw = await request.loadSelectedChangeSet(selected.id)
    if (!raw) throw new Error('MERGE_SELECTION_STALE')
    const record = ChangeSetSchema.parse(raw)
    const computedRoot = hashCanonicalJson({
      baseline_snapshot_id: record.baseline_snapshot_id,
      baseline_manifest_hash: record.baseline_manifest_hash,
      final_workspace_manifest_hash: record.final_workspace_manifest_hash,
      entries: record.entries,
      validation_commands_required: record.validation.required_commands,
      path_scopes: record.path_scopes,
      path_scope_violations: record.path_scope_violations,
    })
    if (record.id !== selected.id || record.change_set_root_hash !== selected.change_set_root_hash
      || record.change_set_root_hash !== computedRoot
      || record.workflow_run_id !== plan.workflow_run_id || record.baseline_snapshot_id !== plan.baseline_snapshot_id
      || record.baseline_manifest_hash !== request.mergeInput.baseline.root_manifest_hash
      || record.final_workspace_manifest_hash !== binding.candidate_manifest_hash
      || !['selected', 'merge_ready'].includes(record.status) || record.decision?.action !== 'select'
      || record.validation.status !== 'passed' || record.output_contract_state !== 'passed'
      || record.path_scope_violations.length !== 0
      || !['approved', 'not_required'].includes(record.approval_state)) {
      throw new Error('MERGE_SELECTION_STALE')
    }
  }
}

async function assertNoHardlinkedFiles(treeRoot: string, canonicalRoot: string, manifest: SnapshotManifest): Promise<void> {
  for (const entry of manifest.entries) {
    if (entry.kind !== 'file') continue
    const path = await resolveExistingPathWithinRoot(treeRoot, ...entry.path.split('/'))
    const item = await lstat(path, { bigint: true })
    if (!item.isFile() || item.isSymbolicLink() || item.nlink !== BigInt(1)) throw new Error('MERGE_HARDLINK_DETECTED')
    try {
      const canonicalPath = await resolvePathWithinRoot(canonicalRoot, ...entry.path.split('/'))
      const canonicalItem = await lstat(canonicalPath, { bigint: true })
      if (canonicalItem.isFile() && item.dev === canonicalItem.dev && item.ino === canonicalItem.ino) {
        throw new Error('MERGE_HARDLINK_DETECTED')
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

async function plainExternalStorage(canonicalRoot: string, storageRoot: string): Promise<string> {
  if (!isAbsolute(canonicalRoot) || !isAbsolute(storageRoot)) throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
  const canonical = await canonicalizeProspectivePath(canonicalRoot)
  const lexical = resolve(storageRoot)
  const prospective = await canonicalizeProspectivePath(lexical)
  if (!sameAbsolutePath(prospective, lexical) || sameOrWithin(canonical, prospective) || sameOrWithin(prospective, canonical)) {
    throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
  }
  await mkdir(lexical, { recursive: true })
  const stat = await lstat(lexical)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
  return lexical
}

async function assertPlainOwnedDirectory(storageRoot: string, segment: string): Promise<string> {
  const path = await resolveExistingPathWithinRoot(storageRoot, segment)
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameAbsolutePath(await realpath(path), path)) {
    throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
  }
  return path
}

function assertSafeTree(entries: readonly SnapshotEntry[]): void {
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  for (const entry of entries) {
    const parts = entry.path.split('/')
    if (['.threados', '.git'].includes(parts[0]!.toLocaleLowerCase('en-US'))) {
      throw new Error('MERGE_CONTROL_PATH_FORBIDDEN')
    }
    for (let size = 1; size < parts.length; size += 1) {
      const parent = byPath.get(parts.slice(0, size).join('/'))
      if (!parent || parent.kind !== 'directory') throw new Error(`MERGE_INVALID_TREE: ${entry.path}`)
    }
  }
}

async function assertSourceParentsPlain(root: string, relativePath: string): Promise<void> {
  const parts = relativePath.split('/')
  for (let size = 1; size < parts.length; size += 1) {
    const parent = await resolveExistingPathWithinRoot(root, ...parts.slice(0, size))
    const stat = await lstat(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('MERGE_SOURCE_PATH_CHANGED')
  }
}

async function assertDestinationParentsPlain(storageRoot: string, stageId: string, relativePath: string): Promise<void> {
  const parts = ['tree', ...relativePath.split('/').slice(0, -1)]
  for (let size = 1; size <= parts.length; size += 1) {
    const lexical = join(storageRoot, stageId, ...parts.slice(0, size))
    const path = await resolveExistingPathWithinRoot(storageRoot, stageId, ...parts.slice(0, size))
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameAbsolutePath(await realpath(path), lexical)) {
      throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
    }
  }
}

async function copyCanonicalEntry(root: string, target: string, entry: SnapshotEntry): Promise<void> {
  await assertSourceParentsPlain(root, entry.path)
  // Resolve the plain parent without following the leaf. A valid internal symlink may be broken.
  const source = await resolvePathWithinRoot(root, ...entry.path.split('/'))
  const sourceStat = await lstat(source)
  if (entry.kind === 'file') {
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) {
      throw new Error('MERGE_SOURCE_PATH_CHANGED')
    }
    const copied = await copyFileNoFollow(source, target, { maxBytes: entry.size_bytes })
      .catch(() => { throw new Error('MERGE_STALE_CANONICAL') })
    if (copied.sizeBytes !== entry.size_bytes || `sha256:${copied.sha256}` !== entry.sha256) {
      throw new Error('MERGE_STALE_CANONICAL')
    }
    await chmod(target, entry.mode ?? 0o644)
    return
  }
  if (entry.kind === 'directory') {
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('MERGE_SOURCE_PATH_CHANGED')
    await mkdir(target)
    return
  }
  if (!sourceStat.isSymbolicLink()) throw new Error('MERGE_SOURCE_PATH_CHANGED')
  const sourceTarget = (await readlink(source)).replaceAll('\\', '/')
  if (normalizeSnapshotSymlinkTarget(entry.path, sourceTarget) !== entry.symlink_target) {
    throw new Error('MERGE_SOURCE_PATH_CHANGED')
  }
  let targetType: 'file' | 'dir' = 'file'
  if (process.platform === 'win32') {
    try { targetType = (await stat(resolve(dirname(source), sourceTarget))).isDirectory() ? 'dir' : 'file' } catch { /* broken internal link */ }
  }
  await symlink(sourceTarget, target, targetType)
}

function projectedManifest(canonical: SnapshotManifest, decision: MergePreview, previewId: string): SnapshotManifest {
  const projected = new Map(canonical.entries.map(entry => [entry.path, entry]))
  for (const item of decision.entries) {
    if (normalizeSnapshotRelativePath(item.path) !== item.path) throw new Error('MERGE_UNSAFE_PATH')
    if (item.decision === 'already_present') continue
    if (item.result) projected.set(item.path, item.result)
    else projected.delete(item.path)
  }
  const entries = [...projected.values()].sort((left, right) => compareSnapshotPathBytes(left.path, right.path))
  assertSafeTree(entries)
  return createSnapshotManifest(previewId, entries)
}

async function materializeTree(request: MaterializeMergePreviewRequest, decision: MergePreview,
  manifest: SnapshotManifest, storageRoot: string, stageId: string): Promise<void> {
  const stagingTree = await resolvePathWithinRoot(storageRoot, stageId, 'tree')
  await mkdir(stagingTree)
  const choices = new Map(decision.entries.map(entry => [entry.path, entry]))
  const candidates = new Map(request.mergeInput.candidate.entries.map(entry => [entry.path, entry]))
  for (const entry of manifest.entries) {
    await assertPlainOwnedDirectory(storageRoot, stageId)
    await assertDestinationParentsPlain(storageRoot, stageId, entry.path)
    const target = await resolvePathWithinRoot(storageRoot, stageId, 'tree', ...entry.path.split('/'))
    const choice = choices.get(entry.path)
    if (!choice || choice.decision === 'already_present') {
      await copyCanonicalEntry(request.canonicalRoot, target, entry)
    } else if (choice.decision === 'merged') {
      if (entry.kind !== 'file' || choice.merged_text == null) throw new Error('MERGE_INVALID_PLAN')
      await writeFile(target, choice.merged_text, { flag: 'wx', mode: entry.mode ?? 0o644 })
    } else if (choice.decision === 'candidate') {
      const candidate = candidates.get(entry.path)
      if (!candidate || JSON.stringify(candidate) !== JSON.stringify(entry)) throw new Error('MERGE_INVALID_PLAN')
      if (entry.kind === 'file') {
        const bytes = await request.readCandidateFile(entry)
        if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size_bytes
          || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== entry.sha256) {
          throw new Error('MERGE_CANDIDATE_HASH_MISMATCH')
        }
        await writeFile(target, bytes, { flag: 'wx', mode: entry.mode ?? 0o644 })
      } else if (entry.kind === 'directory') {
        await mkdir(target)
      } else {
        throw new Error('MERGE_UNSAFE_PLANNED_OPERATION')
      }
    } else {
      throw new Error('MERGE_UNSAFE_PLANNED_OPERATION')
    }
    await request.afterEntryCopied?.(entry)
  }
  for (const entry of [...manifest.entries].reverse()) {
    if (entry.kind === 'directory') await chmod(join(stagingTree, ...entry.path.split('/')), entry.mode ?? 0o755)
  }
}

/** Materializes a fresh, verified preview tree without writing any canonical project file. */
export async function materializeMergePreview(request: MaterializeMergePreviewRequest): Promise<MaterializedMergePreview> {
  const previewId = assertSafePathSegment(request.previewId, 'preview id')
  const decision = planThreeInputMerge(request.mergeInput)
  const plan = await request.records.getPlan(request.plan.id)
  const binding = await request.records.getPlanBinding(request.plan.id)
  if (!plan || plan.revision !== request.plan.revision || plan.status !== 'draft'
    || plan.preview_workspace_id !== null || plan.canonical_precondition_hash !== request.mergeInput.canonical.root_manifest_hash
    || plan.baseline_snapshot_id !== request.mergeInput.baseline.snapshot_id
    || JSON.stringify(plan.change_set_ids) !== JSON.stringify(decision.change_set_ids)
    || !binding || binding.candidate_manifest_hash !== decision.candidate_manifest_hash) {
    throw new Error('MERGE_PLAN_PRECONDITION_FAILED')
  }
  if (plan.change_set_ids.length !== 1 || binding.selected_change_sets.length !== 1) {
    throw new Error('MERGE_COMPOSITION_UNAVAILABLE')
  }
  await assertSelectedChangeSets(request, plan, binding)
  if (decision.conflicts.some(conflict => conflict.status !== 'resolved')) {
    await request.records.updatePlan(plan.id, plan.revision, value => ({ ...value, status: 'conflicted', conflicts: decision.conflicts }))
    throw new Error('MERGE_CONFLICTS_UNRESOLVED')
  }
  const inspectionRequest: CaptureSnapshotRequest = {
    canonicalRoot: request.canonicalRoot,
    runtimeDataRoot: request.runtimeDataRoot,
    localWorkspaceId: request.localWorkspaceId ?? 'local',
    workflowRunId: request.workflowRunId ?? plan.workflow_run_id,
    config: request.config,
  }
  const current = await inspectCanonicalManifest(inspectionRequest)
  if (current.rootManifestHash !== decision.canonical_precondition_hash) throw new Error('MERGE_STALE_CANONICAL')
  const manifest = projectedManifest(request.mergeInput.canonical, decision, previewId)
  const metrics = verifySnapshotManifest(manifest)
  if (metrics.fileCount > request.config.workspace.max_files || metrics.totalBytes > request.config.workspace.max_bytes_each) {
    throw new Error('MERGE_PREVIEW_QUOTA_EXCEEDED')
  }
  const storageRoot = await plainExternalStorage(request.canonicalRoot, request.previewStorageRoot)
  const finalContainer = await resolvePathWithinRoot(storageRoot, previewId)
  try { await lstat(finalContainer); throw new Error('MERGE_PREVIEW_EXISTS') } catch (error) { if (!isMissing(error)) throw error }
  const stageId = assertSafePathSegment(`staging-${previewId}-${randomUUID()}`, 'preview staging id')
  const stageContainer = await resolvePathWithinRoot(storageRoot, stageId)
  const finalTree = join(finalContainer, 'tree')
  let staged = false
  let published = false
  await request.records.createPreview({ schema_version: 1, id: previewId, revision: 0, merge_plan_id: plan.id,
    workflow_run_id: plan.workflow_run_id, status: 'creating', root_path: finalTree,
    canonical_precondition_hash: decision.canonical_precondition_hash,
    candidate_manifest_hash: decision.candidate_manifest_hash,
    decision_hash: hashCanonicalJson(decision),
    manifest_hash: null, error_code: null, created_at: new Date().toISOString(), ready_at: null })
  try {
    await mkdir(stageContainer)
    staged = true
    await assertPlainOwnedDirectory(storageRoot, stageId)
    const stageTree = join(stageContainer, 'tree')
    await materializeTree(request, decision, manifest, storageRoot, stageId)
    await verifyWorkspaceTree(stageTree, manifest, { verifyMode: true })
    await assertNoHardlinkedFiles(stageTree, request.canonicalRoot, manifest)
    const after = await inspectCanonicalManifest(inspectionRequest)
    if (after.rootManifestHash !== decision.canonical_precondition_hash) throw new Error('MERGE_STALE_CANONICAL')
    await rename(stageContainer, finalContainer)
    staged = false
    published = true
    await assertPlainOwnedDirectory(storageRoot, previewId)
    await verifyWorkspaceTree(finalTree, manifest, { verifyMode: true })
    await assertNoHardlinkedFiles(finalTree, request.canonicalRoot, manifest)
    await assertSelectedChangeSets(request, plan, binding)
    await request.persistValidationEvidence?.(decision, manifest)
    await request.records.updatePreview(previewId, 0, value => ({ ...value, status: 'ready',
      manifest_hash: manifest.root_manifest_hash, ready_at: new Date().toISOString() }))
    await request.records.updatePlan(plan.id, plan.revision, value => ({ ...value, status: 'ready', preview_workspace_id: previewId }))
    return { id: previewId, rootPath: finalTree, manifest, decision }
  } catch (error) {
    const recoveryErrors: unknown[] = []
    // Persist failure before cleanup: a locked or unremovable tree must never leave ready status behind.
    const latestPreview = await request.records.getPreview(previewId).catch(recoveryError => {
      recoveryErrors.push(recoveryError)
      return null
    })
    if (!latestPreview) recoveryErrors.push(new Error('MERGE_PREVIEW_RECORD_MISSING'))
    if (latestPreview && latestPreview.status !== 'failed') {
      await request.records.updatePreview(previewId, latestPreview.revision, value => ({ ...value, status: 'failed',
        manifest_hash: null, ready_at: null, error_code: mergeErrorCode(error) }))
        .catch(recoveryError => recoveryErrors.push(recoveryError))
    }
    const latestPlan = await request.records.getPlan(plan.id).catch(recoveryError => {
      recoveryErrors.push(recoveryError)
      return null
    })
    if (!latestPlan) recoveryErrors.push(new Error('MERGE_PLAN_RECORD_MISSING'))
    // A competing preview may have won the plan revision. This operation may only
    // fail the still-unclaimed draft it originally observed, never the winner.
    if (latestPlan && latestPlan.status === 'draft' && latestPlan.revision === plan.revision
      && latestPlan.preview_workspace_id === null) {
      await request.records.updatePlan(plan.id, latestPlan.revision, value => ({ ...value, status: 'failed', preview_workspace_id: null }))
        .catch(recoveryError => recoveryErrors.push(recoveryError))
    }
    const cleanup = request.removePartialDirectory ?? (path => rm(path, { recursive: true, force: true }))
    for (const segment of [staged ? stageId : null, published ? previewId : null]) {
      if (!segment) continue
      try {
        const existing = await resolveExistingPathWithinRoot(storageRoot, segment)
        const item = await lstat(existing)
        if (!item.isDirectory() || item.isSymbolicLink() || !sameAbsolutePath(await realpath(existing), existing)) {
          throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
        }
        await cleanup(existing)
      } catch (recoveryError) {
        if (!isMissing(recoveryError)) recoveryErrors.push(recoveryError)
      }
    }
    if (recoveryErrors.length > 0) throw new AggregateError([error, ...recoveryErrors], 'MERGE_PREVIEW_RECOVERY_REQUIRED')
    throw error
  }
}
