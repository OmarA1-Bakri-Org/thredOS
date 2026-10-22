import { readMergeValidationProcess } from './process-evidence'
import { allowHostedProcessControls, allowShellModel } from '../hosted'
import { createHash } from 'crypto'
import { lstat, mkdir, realpath } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod'
import { ChangeSetContentStore } from '../changesets/content-store'
import { assertChangeSetVisible } from '../changesets/operations'
import { ChangeSetRepository } from '../changesets/repository'
import type { ChangeSet } from '../changesets/schema'
import { hashFileNoFollow, readTextFileNoFollow } from '../security/safe-io'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readLocalWorkspace } from '../local-first/workspace'
import { enforceExecutablePayload } from '../policy/executable'
import { PolicyEngine } from '../policy/engine'
import { startProcess } from '../runner/wrapper'
import { ProcessController } from '../runtime/process-controller'
import { ProcessRepository } from '../runtime/process-repository'
import type { RuntimeCommandContext } from '../runtime/service-types'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { parseBootstrapCommand } from '../workspaces/bootstrap'
import { loadWorkspaceConfig } from '../workspaces/config'
import { createSnapshotManifest } from '../workspaces/manifest'
import { hashCanonicalJson } from '../workspaces/hash'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { verifyWorkspaceTree } from '../workspaces/providers/copy'
import { inspectCanonicalManifest } from '../workspaces/snapshot'
import { SnapshotRepository } from '../workspaces/snapshot-repository'
import { SnapshotManifestSchema, type SnapshotEntry, type SnapshotManifest } from '../workspaces/schema'
import { materializeMergePreview } from './preview'
import { MergeRecordRepository } from './repository'
import { MergePreviewSchema, type MergePlan, type MergePreview } from './schema'

const MaxTextBytes = 1024 * 1024
const CommandEvidenceSchema = z.object({
  schema_version: z.literal(1), merge_plan_id: z.string(), preview_id: z.string(), index: z.number().int(),
  command_sha256: z.string(), args_sha256: z.string(), cwd: z.string(), status: z.enum(['planned', 'passed', 'failed']),
  pid: z.number().nullable(), exit_code: z.number().nullable(), process_status: z.string().nullable(),
  stdout_sha256: z.string().nullable(), stderr_sha256: z.string().nullable(),
  started_at: z.string().datetime(), completed_at: z.string().datetime().nullable(),
}).strict()

const ValidationReceiptSchema = z.object({
  schema_version: z.literal(1), merge_plan_id: z.string(), plan_revision: z.number().int().nonnegative(),
  actor: z.string().min(1), idempotency_key: z.string().min(1),
  validation_command_count: z.number().int().nonnegative(),
  validation_commands_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policy_snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.enum(['running', 'completed', 'failed']), error_code: z.string().nullable(),
  created_at: z.string().datetime(), completed_at: z.string().datetime().nullable(),
}).strict()

export type MergeCapabilityCheck = (decision: MergePreview, canonical: SnapshotManifest,
  preview: SnapshotManifest) => void

export interface MergePreviewResult { plan: MergePlan; preview_id: string; preview_manifest: SnapshotManifest }

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function sameAbsolute(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

async function verifiedSmallText(root: string, entry: SnapshotEntry | undefined): Promise<string | undefined> {
  if (!entry || entry.kind !== 'file' || entry.size_bytes > MaxTextBytes) return undefined
  const path = await resolveExistingPathWithinRoot(root, ...entry.path.split('/'))
  const item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1) throw new Error('MERGE_SOURCE_PATH_CHANGED')
  const digest = await hashFileNoFollow(path)
  if (digest.sizeBytes !== entry.size_bytes || `sha256:${digest.sha256}` !== entry.sha256) {
    throw new Error('MERGE_SOURCE_PATH_CHANGED')
  }
  const text = await readTextFileNoFollow(path)
  return Buffer.byteLength(text) === entry.size_bytes && hash(text) === entry.sha256 ? text : undefined
}

export class MergeRuntimeOperations {
  private readonly controller: ProcessController
  constructor(private readonly basePath: string, private readonly capabilityCheck?: MergeCapabilityCheck,
    processStarter: typeof startProcess = startProcess) {
    this.controller = new ProcessController({ processes: new ProcessRepository(basePath), now: () => new Date().toISOString(), startProcess: processStarter })
  }

  async recoverValidation(planId: string, context: RuntimeCommandContext) {
    if (!['api', 'cli'].includes(context.interface)) throw new Error('MERGE_OPERATOR_REQUIRED')
    if (!context.policyConfirmed || !allowHostedProcessControls()) throw new Error('MERGE_CONFIRMATION_REQUIRED')
    const { canonicalRoot, runtimeDataRoot } = await this.roots()
    const plan = await new MergeRecordRepository(runtimeDataRoot).getPlan(assertSafePathSegment(planId, 'merge plan id'))
    if (!plan || !plan.preview_workspace_id) throw new Error('MERGE_PLAN_NOT_FOUND')
    const path = await resolveExistingPathWithinRoot(runtimeDataRoot, 'merge-validations', planId, 'validation-receipt.json')
    const receipt = ValidationReceiptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
    if (receipt.merge_plan_id !== planId) throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING')
    const pending: string[] = []
    for (let index = 0; index < receipt.validation_command_count; index++) {
      const id = `process-${plan.id}-${index}`
      if (this.controller.hasLiveHandle(id)) {
        try { if (!(await this.controller.cancel(id)).success) pending.push(id) } catch { pending.push(id) }
      }
      try {
        const binding = await ChangeSetRepository.identity(canonicalRoot, plan.change_set_ids[0]!)
        const process: import('../runtime/schema').ProcessRecord | null = binding ? await readMergeValidationProcess(canonicalRoot, { id, runId: plan.workflow_run_id,
          attemptId: binding.attemptId, workspaceId: plan.preview_workspace_id, ordinal: index }) : null
        if (!process || process.status !== 'exited' || process.workflow_run_id !== plan.workflow_run_id
          || process.workspace_id !== plan.preview_workspace_id || process.process_purpose !== 'validation'
          || process.process_ordinal !== index || this.controller.hasLiveHandle(id)) pending.push(id)
      } catch { pending.push(id) }
    }
    if (!pending.length && receipt.status === 'running') await writeFileAtomic(path, JSON.stringify({ ...receipt,
      status: 'failed', error_code: 'MERGE_VALIDATION_CANCELLED', completed_at: new Date().toISOString() }), { allowedRoot: runtimeDataRoot })
    return { schema_version: 1 as const, plan_id: planId,
      disposition: pending.length ? 'requires_review' as const : 'quiescent' as const, pending_process_ids: pending }
  }

  private async verifiedPreviewRoot(runtimeDataRoot: string, namespace: string,
    previewId: string, recordedRoot: string): Promise<string> {
    assertSafePathSegment(previewId, 'preview id')
    const segments = ['merge-preview-workspaces', namespace, previewId, 'tree']
    const expected = join(runtimeDataRoot, ...segments)
    if (!sameAbsolute(expected, recordedRoot)) throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
    for (let length = 0; length <= segments.length; length += 1) {
      const path = length === 0 ? runtimeDataRoot
        : await resolveExistingPathWithinRoot(runtimeDataRoot, ...segments.slice(0, length))
      const item = await lstat(path)
      if (!item.isDirectory() || item.isSymbolicLink() || !sameAbsolute(await realpath(path), path)) {
        throw new Error('MERGE_UNSAFE_PREVIEW_STORAGE')
      }
    }
    return expected
  }

  private async assertNoLinkedPreviewFiles(previewRoot: string, manifest: SnapshotManifest): Promise<void> {
    for (const entry of manifest.entries) {
      if (entry.kind !== 'file') continue
      const path = await resolveExistingPathWithinRoot(previewRoot, ...entry.path.split('/'))
      const item = await lstat(path)
      if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1) {
        throw new Error('MERGE_PREVIEW_CHANGED')
      }
    }
  }

  private async roots() {
    const canonicalRoot = await realpath(this.basePath)
    const local = await readLocalWorkspace(canonicalRoot)
    const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
    const namespace = resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, canonicalRoot).workspaceNamespace
    return { canonicalRoot, runtimeDataRoot, namespace, local }
  }

  async inspect(planId: string): Promise<MergePlan | null> {
    const { canonicalRoot, runtimeDataRoot, namespace } = await this.roots()
    const plan = await new MergeRecordRepository(runtimeDataRoot).getPlan(assertSafePathSegment(planId, 'merge plan id'))
    if (plan) await this.assertSelectedVisible(canonicalRoot, runtimeDataRoot, namespace, plan.change_set_ids[0]!)
    return plan
  }

  private async assertSelectedVisible(canonicalRoot: string, runtimeDataRoot: string,
    namespace: string, changeSetId: string): Promise<void> {
    const identity = await ChangeSetRepository.identity(canonicalRoot, changeSetId)
    if (!identity) throw new Error('MERGE_SELECTION_STALE')
    const record = await new ChangeSetRepository({ canonicalRoot, runtimeDataRoot, namespace,
      runId: identity.runId, attemptId: identity.attemptId }).get(changeSetId)
    if (!record) throw new Error('MERGE_SELECTION_STALE')
    await assertChangeSetVisible(canonicalRoot, record.surface_id)
  }

  async previewSelected(changeSetId: string, idempotencyKey: string): Promise<MergePreviewResult> {
    assertSafePathSegment(changeSetId, 'change set id')
    if (!idempotencyKey.trim()) throw new Error('MERGE_IDEMPOTENCY_KEY_REQUIRED')
    const { canonicalRoot, runtimeDataRoot, namespace, local } = await this.roots()
    const identity = await ChangeSetRepository.identity(canonicalRoot, changeSetId)
    if (!identity) throw new Error('MERGE_CHANGE_SET_NOT_FOUND')
    const changeSets = new ChangeSetRepository({ canonicalRoot, runtimeDataRoot, namespace,
      runId: identity.runId, attemptId: identity.attemptId })
    const selected = await changeSets.get(changeSetId)
    if (selected) await assertChangeSetVisible(canonicalRoot, selected.surface_id)
    const candidate = await changeSets.getManifest(changeSetId)
    if (!selected || !candidate || !['selected', 'merge_ready'].includes(selected.status)
      || selected.decision?.action !== 'select' || selected.validation.status !== 'passed'
      || selected.output_contract_state !== 'passed' || selected.path_scope_violations.length
      || !['approved', 'not_required'].includes(selected.approval_state)
      || candidate.root_manifest_hash !== selected.final_workspace_manifest_hash) {
      throw new Error('MERGE_SELECTION_STALE')
    }
    const snapshots = new SnapshotRepository(canonicalRoot)
    const [snapshot, baseline, config] = await Promise.all([
      snapshots.get(selected.baseline_snapshot_id), snapshots.getManifest(selected.baseline_snapshot_id),
      loadWorkspaceConfig(canonicalRoot),
    ])
    if (!snapshot?.content_root || !baseline || baseline.root_manifest_hash !== selected.baseline_manifest_hash) {
      throw new Error('MERGE_BASELINE_UNAVAILABLE')
    }
    const inspected = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
      localWorkspaceId: local.id, workflowRunId: selected.workflow_run_id, config })
    const canonical = createSnapshotManifest('canonical-current', inspected.entries)
    const records = new MergeRecordRepository(runtimeDataRoot)
    const key = hash(`${changeSetId}\0${idempotencyKey}`).slice(7, 31)
    const planId = `merge-${key}`
    const previewId = `preview-${key}`
    const existing = await records.getPlan(planId)
    if (existing) {
      const priorPreview = await records.getPreview(previewId)
      const binding = await records.getPlanBinding(planId)
      if (existing.change_set_ids.length !== 1 || existing.change_set_ids[0] !== changeSetId
        || existing.canonical_precondition_hash !== canonical.root_manifest_hash
        || binding?.selected_change_sets[0]?.change_set_root_hash !== selected.change_set_root_hash
        || binding.candidate_manifest_hash !== candidate.root_manifest_hash
        || !priorPreview || priorPreview.status !== 'ready') throw new Error('MERGE_IDEMPOTENCY_CONFLICT')
      const replayRoot = await this.verifiedPreviewRoot(runtimeDataRoot, namespace, previewId, priorPreview.root_path)
      const evidenceRoot = await resolvePathWithinRoot(runtimeDataRoot, 'merge-validations', planId)
      let savedManifest: SnapshotManifest
      let savedDecision: MergePreview
      try {
        savedManifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(
          await resolveExistingPathWithinRoot(evidenceRoot, 'preview-manifest.json'))))
        savedDecision = MergePreviewSchema.parse(JSON.parse(await readTextFileNoFollow(
          await resolveExistingPathWithinRoot(evidenceRoot, 'decision.json'))))
      } catch { throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING') }
      if (savedManifest.snapshot_id !== previewId
        || savedManifest.root_manifest_hash !== priorPreview.manifest_hash
        || hashCanonicalJson(savedDecision) !== priorPreview.decision_hash) {
        throw new Error('MERGE_PREVIEW_CHANGED')
      }
      await verifyWorkspaceTree(replayRoot, savedManifest, { verifyMode: true })
      await this.assertNoLinkedPreviewFiles(replayRoot, savedManifest)
      return { plan: existing, preview_id: previewId, preview_manifest: savedManifest }
    }
    const plan = await records.createPlan({ schema_version: 1, id: planId, revision: 0,
      workflow_run_id: selected.workflow_run_id, baseline_snapshot_id: selected.baseline_snapshot_id,
      change_set_ids: [selected.id], canonical_precondition_hash: canonical.root_manifest_hash,
      preview_workspace_id: null, conflicts: [], status: 'draft', created_at: new Date().toISOString(),
      validated_at: null }, { candidate_manifest_hash: candidate.root_manifest_hash,
      selected_change_sets: [{ id: selected.id, change_set_root_hash: selected.change_set_root_hash }] })
    const blobs = new ChangeSetContentStore(runtimeDataRoot, namespace, identity.runId, identity.attemptId)
    const changed = new Map(selected.entries.map(entry => [entry.path, entry]))
    const baselineEntries = new Map(baseline.entries.map(entry => [entry.path, entry]))
    const canonicalEntries = new Map(canonical.entries.map(entry => [entry.path, entry]))
    const candidateEntries = new Map(candidate.entries.map(entry => [entry.path, entry]))
    const text: { baseline: Record<string, string>; canonical: Record<string, string>; candidate: Record<string, string> } =
      { baseline: {}, canonical: {}, candidate: {} }
    for (const item of selected.entries) {
      if (item.content_kind !== 'text') continue
      const before = await verifiedSmallText(snapshot.content_root, baselineEntries.get(item.path))
      const current = await verifiedSmallText(canonicalRoot, canonicalEntries.get(item.path))
      const after = candidateEntries.get(item.path)
      let candidateText: string | undefined
      if (after?.kind === 'file' && after.size_bytes <= MaxTextBytes && item.content_ref) {
        const bytes = await blobs.read(item.content_ref, after.sha256!, MaxTextBytes)
        if (!bytes) throw new Error('MERGE_CANDIDATE_CONTENT_UNAVAILABLE')
        const decoded = bytes.toString('utf8')
        if (Buffer.from(decoded, 'utf8').equals(bytes)) candidateText = decoded
      }
      if (before !== undefined) text.baseline[item.path] = before
      if (current !== undefined) text.canonical[item.path] = current
      if (candidateText !== undefined) text.candidate[item.path] = candidateText
    }
    const result = await materializeMergePreview({ canonicalRoot, runtimeDataRoot, config, plan, records,
      localWorkspaceId: local.id, workflowRunId: selected.workflow_run_id, previewId,
      previewStorageRoot: join(runtimeDataRoot, 'merge-preview-workspaces', namespace),
      mergeInput: { baseline, canonical, candidate, changeSetIds: [selected.id], text,
        candidateOperations: selected.entries.map(item => ({ path: item.path, operation: item.operation,
          content_kind: item.content_kind })) },
      loadSelectedChangeSet: async id => id === selected.id ? await changeSets.get(id) : null,
      persistValidationEvidence: async (decision, manifest) => {
        const evidenceRoot = await resolvePathWithinRoot(runtimeDataRoot, 'merge-validations', plan.id)
        await mkdir(evidenceRoot, { recursive: true })
        await writeFileAtomic(await resolvePathWithinRoot(evidenceRoot, 'decision.json'),
          JSON.stringify(decision), { allowedRoot: runtimeDataRoot })
        await writeFileAtomic(await resolvePathWithinRoot(evidenceRoot, 'preview-manifest.json'),
          JSON.stringify(manifest), { allowedRoot: runtimeDataRoot })
      },
      readCandidateFile: async entry => {
        const changedEntry = changed.get(entry.path)
        if (!changedEntry?.content_ref || changedEntry.after_sha256 !== entry.sha256) {
          throw new Error('MERGE_CANDIDATE_CONTENT_UNAVAILABLE')
        }
        const bytes = await blobs.read(changedEntry.content_ref, entry.sha256!, entry.size_bytes)
        if (!bytes) throw new Error('MERGE_CANDIDATE_CONTENT_UNAVAILABLE')
        return bytes
      },
    })
    return { plan: (await records.getPlan(planId))!, preview_id: result.id, preview_manifest: result.manifest }
  }

  async validate(planId: string, context: RuntimeCommandContext): Promise<MergePlan> {
    if (!allowHostedProcessControls() || !allowShellModel()) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
    const { runtimeDataRoot } = await this.roots()
    const safePlanId = assertSafePathSegment(planId, 'merge plan id')
    const evidenceRoot = await resolvePathWithinRoot(runtimeDataRoot, 'merge-validations', safePlanId)
    await mkdir(evidenceRoot, { recursive: true })
    return withExclusiveFileLock(await resolvePathWithinRoot(evidenceRoot, 'validation.lock'),
      () => this.validateLocked(safePlanId, context), { allowedRoot: runtimeDataRoot, timeoutMs: 11 * 60 * 1000 })
  }

  private async validateLocked(planId: string, context: RuntimeCommandContext): Promise<MergePlan> {
    const { canonicalRoot, runtimeDataRoot, namespace, local } = await this.roots()
    const records = new MergeRecordRepository(runtimeDataRoot)
    const plan = await records.getPlan(assertSafePathSegment(planId, 'merge plan id'))
    if (!plan || !['ready', 'validated'].includes(plan.status) || !plan.preview_workspace_id) {
      throw new Error('MERGE_PLAN_NOT_READY')
    }
    const preview = await records.getPreview(plan.preview_workspace_id)
    if (!preview || preview.status !== 'ready' || preview.merge_plan_id !== plan.id) throw new Error('MERGE_PREVIEW_NOT_READY')
    const previewRoot = await this.verifiedPreviewRoot(runtimeDataRoot, namespace, preview.id, preview.root_path)
    const config = await loadWorkspaceConfig(canonicalRoot)
    const policy = (await PolicyEngine.load(canonicalRoot)).getConfig()
    const commandsHash = hashCanonicalJson(config.validate)
    const policyHash = hashCanonicalJson(policy)
    const current = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
      localWorkspaceId: local.id, workflowRunId: plan.workflow_run_id, config })
    const canonical = createSnapshotManifest('canonical-current', current.entries)
    if (canonical.root_manifest_hash !== plan.canonical_precondition_hash) throw new Error('MERGE_STALE_CANONICAL')
    const evidenceRoot = await resolvePathWithinRoot(runtimeDataRoot, 'merge-validations', plan.id)
    const receiptPath = await resolvePathWithinRoot(evidenceRoot, 'validation-receipt.json')
    let receipt: z.infer<typeof ValidationReceiptSchema> | null = null
    try { receipt = ValidationReceiptSchema.parse(JSON.parse(await readTextFileNoFollow(receiptPath))) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    if (receipt) {
      if (receipt.merge_plan_id !== plan.id || receipt.actor !== context.actor
        || receipt.idempotency_key !== context.idempotencyKey
        || receipt.plan_revision !== (plan.status === 'validated' ? plan.revision - 1 : plan.revision)) {
        throw new Error('MERGE_IDEMPOTENCY_CONFLICT')
      }
      if (receipt.validation_command_count !== config.validate.length
        || receipt.validation_commands_hash !== commandsHash
        || receipt.policy_snapshot_hash !== policyHash) throw new Error('MERGE_VALIDATION_CONFIG_CHANGED')
      if (receipt.status === 'running') throw new Error('MERGE_VALIDATION_RECOVERY_REQUIRED')
      if (receipt.status === 'failed') throw new Error(receipt.error_code ?? 'MERGE_VALIDATION_FAILED')
    } else if (plan.status === 'validated') {
      throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING')
    }
    const previewManifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(
      await resolveExistingPathWithinRoot(evidenceRoot, 'preview-manifest.json'))))
    const decision = MergePreviewSchema.parse(JSON.parse(await readTextFileNoFollow(
      await resolveExistingPathWithinRoot(evidenceRoot, 'decision.json'))))
    if (previewManifest.root_manifest_hash !== preview.manifest_hash || previewManifest.snapshot_id !== preview.id
      || hashCanonicalJson(decision) !== preview.decision_hash
      || decision.canonical_precondition_hash !== plan.canonical_precondition_hash
      || JSON.stringify(decision.change_set_ids) !== JSON.stringify(plan.change_set_ids)) {
      throw new Error('MERGE_PREVIEW_CHANGED')
    }
    // The apply engine defines the operations it can safely commit. Until its capability
    // checker is wired, validation remains unavailable rather than certifying an unsafe plan.
    if (!this.capabilityCheck) throw new Error('MERGE_APPLY_CAPABILITY_UNAVAILABLE')
    const binding = await records.getPlanBinding(plan.id)
    const selectedId = binding?.selected_change_sets[0]?.id
    if (!selectedId) throw new Error('MERGE_SELECTION_STALE')
    const identity = await ChangeSetRepository.identity(canonicalRoot, selectedId)
    if (!identity) throw new Error('MERGE_SELECTION_STALE')
    const changeSets = new ChangeSetRepository({ canonicalRoot, runtimeDataRoot,
      namespace: resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, canonicalRoot).workspaceNamespace,
      runId: identity.runId, attemptId: identity.attemptId })
    const selected = await changeSets.get(selectedId)
    if (selected) await assertChangeSetVisible(canonicalRoot, selected.surface_id)
    if (!selected || !this.matchesSelected(plan, binding.selected_change_sets[0]!, selected)) {
      throw new Error('MERGE_SELECTION_STALE')
    }
    this.capabilityCheck(decision, canonical, previewManifest)
    await verifyWorkspaceTree(previewRoot, previewManifest, { verifyMode: true })
    await this.assertNoLinkedPreviewFiles(previewRoot, previewManifest)
    const completedReplay = receipt?.status === 'completed'
    let receiptCompleted = completedReplay
    if (!receipt) {
      receipt = ValidationReceiptSchema.parse({ schema_version: 1, merge_plan_id: plan.id,
        plan_revision: plan.revision, actor: context.actor, idempotency_key: context.idempotencyKey,
        validation_command_count: config.validate.length, validation_commands_hash: commandsHash,
        policy_snapshot_hash: policyHash,
        status: 'running', error_code: null, created_at: new Date().toISOString(), completed_at: null })
      await writeFileAtomic(receiptPath, JSON.stringify(receipt), { allowedRoot: runtimeDataRoot })
    }
    try {
    for (const [index, source] of config.validate.entries()) {
      const parsed = parseBootstrapCommand(source)
      await this.verifiedPreviewRoot(runtimeDataRoot, namespace, preview.id, preview.root_path)
      const executable = { command: parsed.command, args: parsed.args, cwd: previewRoot }
      const allowed = enforceExecutablePayload(executable, policy, context.policyConfirmed === true)
      if (!allowed.allowed || allowed.confirmation_required) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
      const evidencePath = await resolvePathWithinRoot(evidenceRoot, `${index}.json`)
      if (completedReplay) {
        const saved = CommandEvidenceSchema.parse(JSON.parse(await readTextFileNoFollow(evidencePath)))
        const process = await readMergeValidationProcess(canonicalRoot, { id: `process-${plan.id}-${index}`,
          runId: plan.workflow_run_id, attemptId: identity.attemptId, workspaceId: preview.id, ordinal: index })
        if (saved.status !== 'passed' || saved.command_sha256 !== hash(parsed.command)
          || saved.args_sha256 !== hash(JSON.stringify(parsed.args)) || !sameAbsolute(saved.cwd, previewRoot)
          || process?.status !== 'exited' || process.exit_code !== 0 || process.pid !== saved.pid
          || process.process_purpose !== 'validation' || process.workspace_id !== preview.id) {
          throw new Error('MERGE_VALIDATION_EVIDENCE_MISSING')
        }
        continue
      }
      const started = new Date().toISOString()
      const planned = CommandEvidenceSchema.parse({ schema_version: 1, merge_plan_id: plan.id,
        preview_id: preview.id, index, command_sha256: hash(parsed.command),
        args_sha256: hash(JSON.stringify(parsed.args)), cwd: previewRoot,
        status: 'planned', pid: null, exit_code: null, process_status: null,
        stdout_sha256: null, stderr_sha256: null, started_at: started, completed_at: null })
      await writeFileAtomic(evidencePath, JSON.stringify(planned), { allowedRoot: runtimeDataRoot })
      const controlled = await this.controller.start({ processId: `process-${plan.id}-${index}`,
        workflowRunId: plan.workflow_run_id, attemptId: identity.attemptId, workspaceId: preview.id,
        processPurpose: 'validation', processOrdinal: index,
        runnerConfig: { stepId: `merge-validation-${index}`, runId: plan.workflow_run_id,
          command: parsed.command, args: parsed.args, cwd: previewRoot, timeout: 10 * 60 * 1000,
          maxOutputBytes: 64 * 1024 } })
      const completion = await controlled.completion
      const result = completion.result
      if (!result || completion.process.status !== 'exited') throw new Error('MERGE_VALIDATION_RECOVERY_REQUIRED')
      const passed = result?.status === 'SUCCESS' && result.exitCode === 0
        && completion.process.status === 'exited'
      await writeFileAtomic(evidencePath, JSON.stringify(CommandEvidenceSchema.parse({ ...planned,
        status: passed ? 'passed' : 'failed', pid: controlled.handle.pid, exit_code: result?.exitCode ?? null,
        process_status: completion.process.status, stdout_sha256: result ? hash(result.stdout) : null,
        stderr_sha256: result ? hash(result.stderr) : null,
        completed_at: new Date().toISOString() })), { allowedRoot: runtimeDataRoot })
      const afterCommand = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
        localWorkspaceId: local.id, workflowRunId: plan.workflow_run_id, config })
      if (afterCommand.rootManifestHash !== plan.canonical_precondition_hash) {
        throw new Error('MERGE_STALE_CANONICAL')
      }
      if (!passed) throw new Error('MERGE_VALIDATION_FAILED')
    }
    await this.verifiedPreviewRoot(runtimeDataRoot, namespace, preview.id, preview.root_path)
    await verifyWorkspaceTree(previewRoot, previewManifest, { verifyMode: true })
    await this.assertNoLinkedPreviewFiles(previewRoot, previewManifest)
    const after = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
      localWorkspaceId: local.id, workflowRunId: plan.workflow_run_id, config })
    if (after.rootManifestHash !== plan.canonical_precondition_hash) throw new Error('MERGE_STALE_CANONICAL')
    if (!completedReplay) {
      await writeFileAtomic(receiptPath, JSON.stringify(ValidationReceiptSchema.parse({ ...receipt,
        status: 'completed', error_code: null, completed_at: new Date().toISOString() })),
      { allowedRoot: runtimeDataRoot })
      receiptCompleted = true
    }
    if (plan.status === 'validated') return plan
    return records.updatePlan(plan.id, plan.revision, value => ({ ...value, status: 'validated',
      validated_at: new Date().toISOString() }))
    } catch (error) {
      if (!receiptCompleted && !(error instanceof Error && error.message === 'MERGE_VALIDATION_RECOVERY_REQUIRED')
        && !config.validate.some((_source, index) => this.controller.hasLiveHandle(`process-${plan.id}-${index}`))) {
        const code = error instanceof Error && /^MERGE_[A-Z_]+$/.test(error.message.split(':')[0]!)
          ? error.message.split(':')[0]! : 'MERGE_VALIDATION_FAILED'
        await writeFileAtomic(receiptPath, JSON.stringify(ValidationReceiptSchema.parse({ ...receipt,
          status: 'failed', error_code: code, completed_at: new Date().toISOString() })),
        { allowedRoot: runtimeDataRoot })
      }
      throw error
    }
  }

  private matchesSelected(plan: MergePlan, binding: { id: string; change_set_root_hash: string }, record: ChangeSet): boolean {
    return record.id === binding.id && record.change_set_root_hash === binding.change_set_root_hash
      && record.workflow_run_id === plan.workflow_run_id && record.baseline_snapshot_id === plan.baseline_snapshot_id
      && ['selected', 'merge_ready'].includes(record.status) && record.decision?.action === 'select'
      && record.validation.status === 'passed' && record.output_contract_state === 'passed'
      && record.path_scope_violations.length === 0 && ['approved', 'not_required'].includes(record.approval_state)
  }
}
