import { constants } from 'fs'
import { open } from 'fs/promises'
import { resolveExistingPathWithinRoot } from '../security/safe-path'
import { hashCanonicalJson } from '../workspaces/hash'
import { verifySnapshotManifest } from '../workspaces/manifest'
import { verifyWorkspaceTree } from '../workspaces/providers/copy'
import type { ExclusionPolicy } from '../workspaces/exclusions'
import { compareSnapshotPathBytes, normalizeSnapshotRelativePath, type SnapshotEntry, type SnapshotManifest, type WorkspaceSnapshot } from '../workspaces/schema'
import type { SurfaceWorkspace } from '../workspaces/schema'
import { ChangeSetContentStore } from './content-store'
import { scanFinalWorkspace, sameTreeScan } from './manifest'
import { ChangeSetRepository } from './repository'
import { ChangeSetSchema, type ChangeSet, type ChangeSetEntry } from './schema'

export interface CaptureChangeSetInput {
  canonicalRoot: string
  runtimeDataRoot: string
  namespace: string
  workflowRunId: string
  attemptId: string
  stepId: string
  surfaceId: string
  agentRef: string | null
  workspace: SurfaceWorkspace
  snapshot: WorkspaceSnapshot
  baselineManifest: SnapshotManifest
  exclusionPolicy: ExclusionPolicy
  maxFiles: number
  maxBytes: number
  pathScopes?: readonly string[]
  outputContractConfigured: boolean
  validationCommandsRequired?: number
  createdAt: string
}

function classify(data: Buffer): 'text' | 'binary' {
  if (data.includes(0)) return 'binary'
  try { new TextDecoder('utf-8', { fatal: true }).decode(data); return 'text' } catch { return 'binary' }
}

async function classifyBaselineFile(path: string, size: number): Promise<'text' | 'binary'> {
  if (size > 64 * 1024) return 'binary'
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const data = await file.readFile()
    if (data.length !== size) throw new Error('CHANGE_SET_BASELINE_RACED')
    return classify(data)
  } finally { await file.close() }
}

function changed(before: SnapshotEntry | undefined, after: SnapshotEntry | undefined): boolean {
  if (!before || !after) return true
  return before.kind !== after.kind || before.sha256 !== after.sha256 || before.mode !== after.mode
    || before.symlink_target !== after.symlink_target
}

function operation(before: SnapshotEntry | undefined, after: SnapshotEntry | undefined): ChangeSetEntry['operation'] {
  if (!before) return after?.kind === 'symlink' ? 'symlink' : 'add'
  if (!after) return 'delete'
  if (after.kind === 'symlink' && (before.kind !== 'symlink' || before.symlink_target !== after.symlink_target)) return 'symlink'
  if (before.kind === after.kind && before.sha256 === after.sha256 && before.symlink_target === after.symlink_target) return 'chmod'
  return 'modify'
}

function scopeAllows(path: string, scopes: readonly string[]): boolean {
  return scopes.some(scope => {
    if (!scope.endsWith('/**')) return path === scope
    const root = scope.slice(0, -3)
    return path === root || path.startsWith(`${root}/`)
  })
}

function normalizeScope(scope: string): string {
  const glob = scope.endsWith('/**')
  const root = normalizeSnapshotRelativePath(glob ? scope.slice(0, -3) : scope, 'path scope')
  return glob ? `${root}/**` : root
}

export async function captureChangeSet(input: CaptureChangeSetInput): Promise<ChangeSet> {
  const { snapshot, baselineManifest, workspace } = input
  verifySnapshotManifest(baselineManifest)
  if (snapshot.status !== 'ready' || !snapshot.content_root || snapshot.id !== baselineManifest.snapshot_id
    || snapshot.root_manifest_hash !== baselineManifest.root_manifest_hash
    || snapshot.exclusion_policy_hash !== input.exclusionPolicy.exclusionPolicyHash
    || workspace.snapshot_id !== snapshot.id || workspace.attempt_id !== input.attemptId
    || workspace.workflow_run_id !== input.workflowRunId || workspace.surface_id !== input.surfaceId
    || workspace.status !== 'active' || workspace.manifest_hash !== baselineManifest.root_manifest_hash) {
    throw new Error('CHANGE_SET_BASELINE_MISMATCH')
  }
  await verifyWorkspaceTree(snapshot.content_root, baselineManifest, { requireImmutable: true })
  const id = `change-set-${input.attemptId}`
  const scopes = input.pathScopes?.map(normalizeScope) ?? null
  const repository = new ChangeSetRepository({
    canonicalRoot: input.canonicalRoot, runtimeDataRoot: input.runtimeDataRoot,
    namespace: input.namespace, runId: input.workflowRunId, attemptId: input.attemptId,
  })
  const existing = await repository.get(id)
  if (existing) {
    if (existing.workflow_run_id !== input.workflowRunId || existing.attempt_id !== input.attemptId
      || existing.step_id !== input.stepId || existing.surface_id !== input.surfaceId
      || existing.agent_ref !== input.agentRef || existing.workspace_id !== workspace.id
      || existing.baseline_snapshot_id !== snapshot.id
      || existing.baseline_manifest_hash !== baselineManifest.root_manifest_hash
      || JSON.stringify(existing.path_scopes) !== JSON.stringify(scopes)) {
      throw new Error('CHANGE_SET_IDENTITY_MISMATCH')
    }
    const recorded = await repository.getManifest(id)
    if (!recorded || recorded.root_manifest_hash !== existing.final_workspace_manifest_hash) throw new Error('CHANGE_SET_RECORD_CORRUPT')
    const current = await scanFinalWorkspace(workspace.root_path, snapshot.id, { maxFiles: input.maxFiles, maxBytes: input.maxBytes }, input.exclusionPolicy)
    if (current.manifest.root_manifest_hash !== recorded.root_manifest_hash) throw new Error('CHANGE_SET_CONFLICT: workspace changed after capture')
    const verified = await scanFinalWorkspace(workspace.root_path, snapshot.id, { maxFiles: input.maxFiles, maxBytes: input.maxBytes }, input.exclusionPolicy)
    if (!sameTreeScan(current, verified)) throw new Error('CHANGE_SET_SOURCE_RACED: workspace changed during verification')
    return existing
  }
  const first = await scanFinalWorkspace(workspace.root_path, snapshot.id, { maxFiles: input.maxFiles, maxBytes: input.maxBytes }, input.exclusionPolicy)
  const baseline = new Map(baselineManifest.entries.map(entry => [entry.path, entry]))
  const final = new Map(first.manifest.entries.map(entry => [entry.path, entry]))
  const paths = [...new Set([...baseline.keys(), ...final.keys()])].sort(compareSnapshotPathBytes)
  const content = new ChangeSetContentStore(input.runtimeDataRoot, input.namespace, input.workflowRunId, input.attemptId)
  const stage = await content.stage()
  try {
    const entries: ChangeSetEntry[] = []
    for (const path of paths) {
      const before = baseline.get(path)
      const after = final.get(path)
      if (!changed(before, after)) continue
      let contentRef: string | null = null
      let kind: 'text' | 'binary' = 'text'
      if (after?.kind === 'file') {
        const source = await resolveExistingPathWithinRoot(workspace.root_path, ...path.split('/'))
        contentRef = await stage.copy(source, after.sha256!, after.size_bytes)
        kind = await stage.classify(contentRef)
        if (before?.kind === 'file') {
          const baselineSource = await resolveExistingPathWithinRoot(snapshot.content_root, ...path.split('/'))
          if (await classifyBaselineFile(baselineSource, before.size_bytes) === 'binary') kind = 'binary'
        }
      } else if (before?.kind === 'file') {
        const source = await resolveExistingPathWithinRoot(snapshot.content_root, ...path.split('/'))
        kind = await classifyBaselineFile(source, before.size_bytes)
      }
      entries.push({
        path, operation: operation(before, after), before_sha256: before?.sha256 ?? null,
        after_sha256: after?.sha256 ?? null, content_kind: kind,
        size_bytes_before: before?.size_bytes ?? 0, size_bytes_after: after?.size_bytes ?? 0,
        lines_added: null, lines_deleted: null, patch_ref: null, content_ref: contentRef,
        before_kind: before?.kind ?? null, after_kind: after?.kind ?? null,
        mode_before: before?.mode ?? null, mode_after: after?.mode ?? null,
        symlink_target_before: before?.symlink_target ?? null, symlink_target_after: after?.symlink_target ?? null,
      })
    }
    const second = await scanFinalWorkspace(workspace.root_path, snapshot.id, { maxFiles: input.maxFiles, maxBytes: input.maxBytes }, input.exclusionPolicy)
    if (!sameTreeScan(first, second)) throw new Error('CHANGE_SET_SOURCE_RACED: final workspace changed during capture')
    const violations = scopes == null ? [] : entries.filter(entry => !scopeAllows(entry.path, scopes)).map(entry => entry.path)
    const semantic = {
      baseline_snapshot_id: snapshot.id,
      baseline_manifest_hash: baselineManifest.root_manifest_hash,
      final_workspace_manifest_hash: first.manifest.root_manifest_hash,
      entries,
      validation_commands_required: input.validationCommandsRequired ?? 0,
      path_scopes: scopes,
      path_scope_violations: violations,
    }
    const value = ChangeSetSchema.parse({
      schema_version: 2, revision: 0, id, workflow_run_id: input.workflowRunId, attempt_id: input.attemptId,
      step_id: input.stepId, surface_id: input.surfaceId, agent_ref: input.agentRef, workspace_id: workspace.id,
      baseline_snapshot_id: snapshot.id, baseline_manifest_hash: baselineManifest.root_manifest_hash,
      final_workspace_manifest_ref: `.threados/changesets/${id}.manifest.json`,
      final_workspace_manifest_hash: first.manifest.root_manifest_hash,
      change_set_root_hash: hashCanonicalJson(semantic), created_at: input.createdAt,
      entries, total_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes_after, 0),
      total_lines_added: null, total_lines_deleted: null, path_scope_violations: violations,
      path_scopes: scopes,
      validation: { status: violations.length ? 'failed' : 'pending', evidence_refs: [],
        required_commands: input.validationCommandsRequired ?? 0 },
      output_contract_state: 'pending',
      approval_state: 'pending', status: 'captured',
      decision: null,
    })
    await stage.commit()
    return await repository.create(value, first.manifest)
  } catch (error) {
    await stage.dispose()
    throw error
  }
}
