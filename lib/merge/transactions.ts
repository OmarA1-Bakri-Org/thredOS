import { readMergeValidationProcess } from './process-evidence'
import { lstat, open, realpath } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readLocalWorkspace } from '../local-first/workspace'
import { PolicyEngine } from '../policy/engine'
import { ProcessController } from '../runtime/process-controller'
import { ProcessRepository } from '../runtime/process-repository'
import { AttemptRepository } from '../runtime/attempt-repository'
import { RuntimeCommandContextSchema, type RuntimeCommandContext } from '../runtime/command-schema'
import { allowHostedProcessControls, allowShellModel } from '../hosted'
import { startProcess } from '../runner/wrapper'
import { parseBootstrapCommand } from '../workspaces/bootstrap'
import { enforceExecutablePayload } from '../policy/executable'
import { copyFileNoFollow, hashFileNoFollow, readTextFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { appendTraceEvent } from '../traces/writer'
import { agentRegistrationEvidence } from '../agents/execution'
import { loadWorkspaceConfig } from '../workspaces/config'
import { createSnapshotManifest } from '../workspaces/manifest'
import { hashCanonicalJson } from '../workspaces/hash'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { inspectCanonicalManifest } from '../workspaces/snapshot'
import { SnapshotManifestSchema, type SnapshotManifest, type SnapshotEntry } from '../workspaces/schema'
import { ChangeSetRepository } from '../changesets/repository'
import { assertChangeSetVisible } from '../changesets/operations'
import { consumeExactMergeApproval, inspectExactMergeApprovalSubject, type ExactMergeApprovalSubject } from './approval'
import { assertMergeFileCapabilities, type MergeMutationProvider } from './mutation-provider'
import { MergeRecordRepository } from './repository'
import { MergePreviewSchema, type MergeResult } from './schema'
import { MergeResultRepository, MergeTransactionRecordSchema, type MergeTransactionRecord,
  type MergeMutation, type MergeFileState } from './result-repository'

export const MergeApplyRequestSchema = z.object({ approval_id: z.string().min(1), plan_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()
export type MergeApplyRequest = z.infer<typeof MergeApplyRequestSchema>
export interface MergeRecoveryReport {
  schema_version: 1; result: MergeResult; disposition: 'terminal' | 'prepared' | 'rollback_available' | 'requires_review';
  reason_codes: string[]
}

function operatorContext(raw: RuntimeCommandContext): RuntimeCommandContext {
  const context = RuntimeCommandContextSchema.parse(raw)
  if (!['api', 'cli'].includes(context.interface) || /^(?:agent|ai-agent|model)(?:$|[:/\-@])/i.test(context.actor)) {
    throw new Error('MERGE_OPERATOR_REQUIRED')
  }
  if (!context.policyConfirmed) throw new Error('MERGE_CONFIRMATION_REQUIRED')
  if (!allowHostedProcessControls() || !allowShellModel()) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
  return context
}
function state(entry: SnapshotEntry | undefined, evidence: string): MergeFileState {
  if (!entry) return { kind: 'absent' }
  if (entry.kind !== 'file' || !entry.sha256 || entry.mode === null) throw new Error('MERGE_OPERATION_UNSUPPORTED')
  return { kind: 'file', sha256: entry.sha256, size_bytes: entry.size_bytes, mode: entry.mode, evidence_file: evidence }
}
function sameState(a: MergeFileState, b: MergeFileState): boolean {
  return a.kind === b.kind && (a.kind === 'absent' || (b.kind === 'file'
    && a.sha256 === b.sha256 && a.size_bytes === b.size_bytes && a.mode === b.mode))
}
function transientName(id: string, index: number, kind: string): string { return `threados-merge-${id}-${index}-${kind}` }

/** One canonical transaction lock serializes operator mutations across processes and plans. */
export class MergeTransactions {
  private readonly controller: ProcessController
  constructor(private readonly basePath: string, private readonly provider?: MergeMutationProvider) {
    this.controller = new ProcessController({ processes: new ProcessRepository(basePath), now: () => new Date().toISOString(), startProcess })
  }
  private available(): MergeMutationProvider {
    if (!this.provider) throw new Error('MERGE_APPLY_CAPABILITY_UNAVAILABLE')
    this.provider.assertAvailable()
    return this.provider
  }
  private async roots() {
    const canonicalRoot = await realpath(this.basePath)
    const local = await readLocalWorkspace(canonicalRoot)
    const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
    return { canonicalRoot, runtimeDataRoot, local, repo: new MergeResultRepository(runtimeDataRoot, canonicalRoot) }
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const { canonicalRoot, runtimeDataRoot, repo } = await this.roots()
    const path = await resolvePathWithinRoot(await repo.root(), `canonical-${hashCanonicalJson(canonicalRoot).slice(7)}.lock`)
    return withExclusiveFileLock(path, action, { allowedRoot: runtimeDataRoot, timeoutMs: 600_000 })
  }
  private async withSelectionLocks<T>(planId: string, action: () => Promise<T>): Promise<T> {
    const { canonicalRoot, runtimeDataRoot } = await this.roots()
    const plan = await new MergeRecordRepository(runtimeDataRoot).getPlan(planId)
    if (!plan || plan.change_set_ids.length !== 1) throw new Error('MERGE_PLAN_NOT_FOUND')
    const changes = await resolveExistingPathWithinRoot(canonicalRoot, '.threados', 'changesets')
    const state = await resolveExistingPathWithinRoot(canonicalRoot, '.threados', 'state')
    const changeLock = await resolvePathWithinRoot(changes, `${assertSafePathSegment(plan.change_set_ids[0]!, 'change set id')}.lock`)
    const visibilityLock = await resolvePathWithinRoot(state, 'thread-surfaces.json.lock')
    // Same locks as operator rejection/reveal. Apply linearizes before either can revoke its selection.
    return withExclusiveFileLock(visibilityLock, () => withExclusiveFileLock(changeLock, action,
      { allowedRoot: canonicalRoot, timeoutMs: 600_000 }), { allowedRoot: canonicalRoot, timeoutMs: 600_000 })
  }
  private async manifest(runId: string, ignore: readonly string[] = []): Promise<SnapshotManifest> {
    const { canonicalRoot, runtimeDataRoot, local } = await this.roots()
    const config = await loadWorkspaceConfig(canonicalRoot)
    const current = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot, localWorkspaceId: local.id, workflowRunId: runId, config })
    return createSnapshotManifest('canonical-current', current.entries.filter(entry => !ignore.includes(entry.path)))
  }
  async inspect(resultId: string): Promise<MergeResult | null> {
    const { repo } = await this.roots()
    const record = await repo.get(assertSafePathSegment(resultId, 'merge result id'))
    if (record && record.canonical_root_hash !== hashCanonicalJson((await this.roots()).canonicalRoot)) throw new Error('MERGE_RESULT_NOT_FOUND')
    return record?.result ?? null
  }
  async subject(planId: string, context: RuntimeCommandContext): Promise<ExactMergeApprovalSubject> {
    operatorContext(context)
    return inspectExactMergeApprovalSubject(this.basePath, planId)
  }
  private async selected(planId: string): Promise<void> {
    const { canonicalRoot, runtimeDataRoot, local } = await this.roots()
    const plans = new MergeRecordRepository(runtimeDataRoot)
    const plan = await plans.getPlan(planId), binding = await plans.getPlanBinding(planId)
    if (!plan || !binding || plan.change_set_ids.length !== 1) throw new Error('MERGE_SELECTION_STALE')
    const id = plan.change_set_ids[0]!
    const identity = await ChangeSetRepository.identity(canonicalRoot, id)
    if (!identity) throw new Error('MERGE_SELECTION_STALE')
    const namespace = resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, canonicalRoot).workspaceNamespace
    const selected = await new ChangeSetRepository({ canonicalRoot, runtimeDataRoot, namespace,
      runId: identity.runId, attemptId: identity.attemptId }).get(id)
    if (!selected || !['selected', 'merge_ready'].includes(selected.status) || selected.validation.status !== 'passed'
      || selected.output_contract_state !== 'passed' || selected.path_scope_violations.length
      || !['not_required', 'approved'].includes(selected.approval_state)
      || selected.workflow_run_id !== plan.workflow_run_id || selected.baseline_snapshot_id !== plan.baseline_snapshot_id
      || selected.change_set_root_hash !== binding.selected_change_sets[0]?.change_set_root_hash
      || selected.final_workspace_manifest_hash !== binding.candidate_manifest_hash) throw new Error('MERGE_SELECTION_STALE')
    await assertChangeSetVisible(canonicalRoot, selected.surface_id)
  }
  private async saveEvidence(source: string, target: string, expected: MergeFileState): Promise<void> {
    if (expected.kind !== 'file') return
    const item = await lstat(source, { bigint: true })
    if (!item.isFile() || item.isSymbolicLink() || item.nlink !== BigInt(1)) throw new Error('MERGE_SOURCE_PATH_CHANGED')
    if (Number(item.mode & BigInt(0o777)) !== expected.mode) throw new Error('MERGE_SOURCE_PATH_CHANGED')
    try {
      const existing = await lstat(target)
      const digest = await hashFileNoFollow(target)
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1
        || `sha256:${digest.sha256}` !== expected.sha256 || digest.sizeBytes !== expected.size_bytes) throw new Error('MERGE_PREPARED_EVIDENCE_CHANGED')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const copied = await copyFileNoFollow(source, target, { expectedSource: item, maxBytes: expected.size_bytes })
      if (`sha256:${copied.sha256}` !== expected.sha256 || copied.sizeBytes !== expected.size_bytes) throw new Error('MERGE_SOURCE_PATH_CHANGED')
    }
    const handle = await open(target, 'r+')
    try { await handle.sync() } finally { await handle.close() }
  }
  private async create(planId: string, request: MergeApplyRequest, context: RuntimeCommandContext,
    resultId: string): Promise<MergeTransactionRecord> {
    const { canonicalRoot, runtimeDataRoot, repo } = await this.roots()
    const plans = new MergeRecordRepository(runtimeDataRoot)
    await this.selected(planId)
    const subject = await inspectExactMergeApprovalSubject(canonicalRoot, planId)
    if (subject.planDigest !== request.plan_digest) throw new Error('MERGE_APPROVAL_PLAN_CHANGED')
    const plan = (await plans.getPlan(planId))!, preview = (await plans.getPreview(plan.preview_workspace_id!))!
    const evidence = await resolveExistingPathWithinRoot(runtimeDataRoot, 'merge-validations', plan.id)
    const after = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(await resolveExistingPathWithinRoot(evidence, 'preview-manifest.json'))))
    const decision = MergePreviewSchema.parse(JSON.parse(await readTextFileNoFollow(await resolveExistingPathWithinRoot(evidence, 'decision.json'))))
    const before = await this.manifest(plan.workflow_run_id)
    assertMergeFileCapabilities(decision, before, after)
    const directory = await repo.evidenceDirectory(resultId)
    const next = new Map(after.entries.map(entry => [entry.path, entry]))
    const old = new Map(before.entries.map(entry => [entry.path, entry]))
    const entries: MergeTransactionRecord['entries'] = []
    for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      if (JSON.stringify(old.get(path)) === JSON.stringify(next.get(path))) continue
      const index = entries.length
      const a = state(old.get(path), `${index}-before.bin`), b = state(next.get(path), `${index}-after.bin`)
      if (sameState(a, b)) continue
      const staged = transientName(resultId, index, 'next')
      if (old.has(staged) || next.has(staged) || old.has(transientName(resultId, index, 'held'))
        || next.has(transientName(resultId, index, 'held'))) throw new Error('MERGE_STAGE_COLLISION')
      entries.push({ path, before: a, after: b, staged_file: staged, staged_identity: null })
      await this.saveEvidence(await resolvePathWithinRoot(canonicalRoot, ...path.split('/')), join(directory, `${index}-before.bin`), a)
      await this.saveEvidence(await resolvePathWithinRoot(preview.root_path, ...path.split('/')), join(directory, `${index}-after.bin`), b)
    }
    await writeFileAtomic(join(directory, 'before-manifest.json'), JSON.stringify(before), { allowedRoot: runtimeDataRoot })
    await writeFileAtomic(join(directory, 'after-manifest.json'), JSON.stringify(after), { allowedRoot: runtimeDataRoot })
    return repo.create(MergeTransactionRecordSchema.parse({ schema_version: 1, revision: 0,
      plan_digest: request.plan_digest, preview_id: preview.id, decision_hash: preview.decision_hash,
      canonical_root_hash: hashCanonicalJson(canonicalRoot), canonical_precondition_hash: before.root_manifest_hash,
      preview_manifest_hash: after.root_manifest_hash, phase: 'prepared', entries,
      authority: { approval_id: request.approval_id, operator_actor: context.actor,
        idempotency_key: context.idempotencyKey, policy_hash: subject.policySnapshotHash,
        root_identity: await this.available().rootIdentity(canonicalRoot), validation_commands_hash: hashCanonicalJson((await loadWorkspaceConfig(canonicalRoot)).validate) }, operations: [],
      result: { schema_version: 1, id: resultId, merge_plan_id: planId, workflow_run_id: plan.workflow_run_id,
        filesystem_apply: { status: 'pending', rollback_ref: null, error_code: null, error_message: null },
        applied_change_set_ids: [], git_commit: { status: 'disabled', commit_sha: null, error_code: null, error_message: null },
        created_at: new Date().toISOString(), completed_at: null } }))
  }
  private async operation(record: MergeTransactionRecord, kind: MergeMutation['kind'], source: string,
    destination: string, expected: MergeFileState, contentFile?: string): Promise<MergeTransactionRecord> {
    if (expected.kind !== 'file') throw new Error('MERGE_OPERATION_UNSUPPORTED')
    const provider = this.available(), { canonicalRoot, repo } = await this.roots()
    if (hashCanonicalJson((await PolicyEngine.load(canonicalRoot)).getConfig()) !== record.authority?.policy_hash) throw new Error('MERGE_VALIDATION_CONFIG_CHANGED')
    const id = `${record.result.id}-${record.operations.length}`
    const operation: MergeMutation = { id, kind, source, destination, expected_sha256: expected.sha256,
      size_bytes: expected.size_bytes, mode: expected.mode, status: 'planned', helper_journal: null, pid: null, code: null }
    const planned = await repo.update(record.result.id, record.revision, current => ({ ...current, operations: [...current.operations, operation] }))
    // No provider call is permitted until its exact intent is durable.
    let result: Awaited<ReturnType<MergeMutationProvider['mutate']>>
    try { result = await provider.mutate({ canonicalRoot, evidenceRoot: await repo.evidenceDirectory(record.result.id), transaction: planned, operation, contentFile }) }
    catch { result = { status: 'indeterminate', journalPath: null, pid: null, code: 'MERGE_PROVIDER_OUTCOME_UNKNOWN' } }
    const saved = await repo.update(planned.result.id, planned.revision, current => ({ ...current,
      operations: current.operations.map(item => item.id === id ? { ...item, status: result.status,
        helper_journal: result.journalPath, pid: result.pid, code: result.code } : item) }))
    if (result.status !== 'succeeded') throw new Error(result.status === 'indeterminate' ? 'MERGE_RECOVERY_REQUIRED' : 'MERGE_MUTATION_FAILED')
    return saved
  }
  private async finish(record: MergeTransactionRecord, phase: 'applied' | 'rolled_back', errorCode: string | null = null) {
    const { repo, runtimeDataRoot } = await this.roots()
    const next = await repo.update(record.result.id, record.revision, current => ({ ...current, phase,
      result: { ...current.result, filesystem_apply: phase === 'applied' ? { status: 'applied', rollback_ref: current.result.id, error_code: null, error_message: null }
        : { status: 'rolled_back', rollback_ref: current.result.id, error_code: errorCode, error_message: null },
      applied_change_set_ids: phase === 'applied' ? current.result.applied_change_set_ids : [], completed_at: new Date().toISOString() } }))
    const plans = new MergeRecordRepository(runtimeDataRoot), plan = await plans.getPlan(record.result.merge_plan_id)
    if (plan && plan.status !== phase) await plans.updatePlan(plan.id, plan.revision, value => ({ ...value, status: phase }))
    await this.trace(next, phase)
    return next.result
  }
  private async trace(record: MergeTransactionRecord, status: string): Promise<void> {
    const { canonicalRoot, runtimeDataRoot } = await this.roots()
    const plan = await new MergeRecordRepository(runtimeDataRoot).getPlan(record.result.merge_plan_id)
    const id = plan?.change_set_ids[0]
    const identity = id ? await ChangeSetRepository.identity(canonicalRoot, id) : null
    const attempt = identity ? await new AttemptRepository(canonicalRoot).get(identity.attemptId) : null
    if (!attempt?.agent_registration) throw new Error('MERGE_IDENTITY_EVIDENCE_MISSING')
    await appendTraceEvent(canonicalRoot, record.result.workflow_run_id, {
      ts: new Date().toISOString(), run_id: record.result.workflow_run_id, surface_id: attempt.surface_id,
      attempt_id: attempt.id, agent_registration: agentRegistrationEvidence(attempt.agent_registration),
      actor: record.authority!.operator_actor, event_type: 'gate-evaluated',
      payload_ref: `merge-result:${record.result.id}:${status}`, policy_ref: record.authority!.policy_hash })
  }
  private async verifyState(path: string, expected: MergeFileState): Promise<void> {
    try {
      const item = await lstat(path)
      if (expected.kind === 'absent' || !item.isFile() || item.isSymbolicLink() || item.nlink !== 1) throw new Error('MERGE_ROLLBACK_PRECONDITION_FAILED')
      const digest = await hashFileNoFollow(path)
      if (`sha256:${digest.sha256}` !== expected.sha256 || digest.sizeBytes !== expected.size_bytes
        || (item.mode & 0o777) !== expected.mode) throw new Error('MERGE_ROLLBACK_PRECONDITION_FAILED')
    } catch (error) {
      if (expected.kind === 'absent' && error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
  }
  private ignored(record: MergeTransactionRecord): string[] {
    return record.entries.flatMap((_entry, index) => ['held', 'next', 'restore'].map(kind => transientName(record.result.id, index, kind)))
  }
  private async checkManifest(record: MergeTransactionRecord, expected: string): Promise<void> {
    if ((await this.manifest(record.result.workflow_run_id, this.ignored(record))).root_manifest_hash !== expected) {
      throw new Error('MERGE_CANONICAL_POSTCONDITION_FAILED')
    }
  }
  private async cleanupHeld(record: MergeTransactionRecord): Promise<MergeTransactionRecord> {
    const { canonicalRoot } = await this.roots()
    for (const [index, entry] of record.entries.entries()) {
      if (entry.before.kind !== 'file') continue
      const held = transientName(record.result.id, index, 'held')
      await this.verifyState(await resolvePathWithinRoot(canonicalRoot, held), entry.before)
      record = await this.operation(record, 'delete', held, '', entry.before)
    }
    return record
  }
  private async postChecks(record: MergeTransactionRecord, context: RuntimeCommandContext): Promise<void> {
    const { canonicalRoot } = await this.roots()
    const config = await loadWorkspaceConfig(canonicalRoot), policy = (await PolicyEngine.load(canonicalRoot)).getConfig()
    if (hashCanonicalJson(policy) !== record.authority?.policy_hash
      || hashCanonicalJson(config.validate) !== record.authority.validation_commands_hash) throw new Error('MERGE_VALIDATION_CONFIG_CHANGED')
    const plan = await new MergeRecordRepository((await this.roots()).runtimeDataRoot).getPlan(record.result.merge_plan_id)
    const identity = plan ? await ChangeSetRepository.identity(canonicalRoot, plan.change_set_ids[0]!) : null
    if (!identity) throw new Error('MERGE_SELECTION_STALE')
    for (const [index, source] of config.validate.entries()) {
      const parsed = parseBootstrapCommand(source), payload = { ...parsed, cwd: canonicalRoot }
      const allowed = enforceExecutablePayload(payload, policy, context.policyConfirmed)
      if (!allowed.allowed || allowed.confirmation_required) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
      const repo = (await this.roots()).repo
      const check = { id: `process-${record.result.id}-post-${index}`, attempt_id: identity.attemptId, ordinal: index, status: 'planned' as const }
      record = await repo.update(record.result.id, record.revision, current => ({ ...current, post_checks: [...current.post_checks, check] }))
      const controlled = await this.controller.start({ processId: check.id,
        workflowRunId: record.result.workflow_run_id, attemptId: identity.attemptId, workspaceId: null,
        processPurpose: 'validation', processOrdinal: index,
        runnerConfig: { stepId: `merge-post-${index}`, runId: record.result.workflow_run_id,
          command: parsed.command, args: parsed.args, cwd: canonicalRoot, timeout: 600_000, maxOutputBytes: 64 * 1024 } })
      const completion = await controlled.completion
      if (completion.process.status !== 'exited' || !completion.result) throw new Error('MERGE_POST_CHECK_RECOVERY_REQUIRED')
      const passed = completion.result.exitCode === 0 && completion.result.status === 'SUCCESS'
      record = await repo.update(record.result.id, record.revision, current => ({ ...current,
        post_checks: current.post_checks.map(item => item.id === check.id ? { ...item, status: passed ? 'passed' : 'failed' } : item) }))
      if (!passed) throw new Error('MERGE_POST_CHECK_FAILED')
    }
  }
  async apply(planId: string, raw: MergeApplyRequest, rawContext: RuntimeCommandContext): Promise<MergeResult> {
    const context = operatorContext(rawContext), request = MergeApplyRequestSchema.parse(raw)
    assertSafePathSegment(planId, 'merge plan id'); this.available()
    return this.locked(() => this.withSelectionLocks(planId, async () => {
      const { canonicalRoot, repo, runtimeDataRoot } = await this.roots()
      const resultId = `result-${hashCanonicalJson({ root: canonicalRoot, planId, actor: context.actor, key: context.idempotencyKey }).slice(7, 39)}`
      let record = await repo.get(resultId)
      if (record && (record.plan_digest !== request.plan_digest || record.authority?.approval_id !== request.approval_id
        || record.authority.operator_actor !== context.actor)) throw new Error('MERGE_IDEMPOTENCY_CONFLICT')
      if (record?.phase === 'applied' || record?.phase === 'rolled_back') return record.result
      for (const pending of await repo.list()) {
        if (pending.result.id !== resultId && pending.canonical_root_hash === hashCanonicalJson(canonicalRoot)
          && !['applied', 'rolled_back'].includes(pending.phase)) throw new Error('MERGE_RECOVERY_REQUIRED')
      }
      if (record && (record.phase !== 'prepared' || record.operations.length)) throw new Error('MERGE_RECOVERY_REQUIRED')
      if (!record) record = await this.create(planId, request, context, resultId)
      await this.selected(planId)
      await consumeExactMergeApproval(canonicalRoot, { planId, approvalId: request.approval_id,
        operatorActor: context.actor, planDigest: request.plan_digest, consumedBy: resultId }, { allowConsumedReceipt: true })
      // Consumption is durable before the first canonical stage or mutation.
      await this.checkManifest(record, record.canonical_precondition_hash)
      record = await repo.update(record.result.id, record.revision, current => ({ ...current, phase: 'applying' }))
      try {
        // Stage all candidate bytes before moving any target.
        for (const [index, entry] of record.entries.entries()) {
          if (entry.after.kind === 'file') record = await this.operation(record, 'stage', '', entry.staged_file!, entry.after,
            await repo.evidencePath(record.result.id, `${index}-after.bin`))
        }
        await this.checkManifest(record, record.canonical_precondition_hash)
        for (const [index, entry] of record.entries.entries()) {
          await this.verifyState(await resolvePathWithinRoot(canonicalRoot, ...entry.path.split('/')), entry.before)
          if (entry.before.kind === 'file') record = await this.operation(record, 'rename', entry.path,
            transientName(record.result.id, index, 'held'), entry.before)
          if (entry.after.kind === 'file') record = await this.operation(record, 'rename', entry.staged_file!, entry.path, entry.after)
        }
        await this.checkManifest(record, record.preview_manifest_hash)
        await this.postChecks(record, context)
        record = (await repo.get(record.result.id))!
        await this.checkManifest(record, record.preview_manifest_hash)
        record = await this.cleanupHeld(record)
        if ((await this.manifest(record.result.workflow_run_id)).root_manifest_hash !== record.preview_manifest_hash) throw new Error('MERGE_CANONICAL_POSTCONDITION_FAILED')
        const plan = (await new MergeRecordRepository(runtimeDataRoot).getPlan(planId))!
        record = await repo.update(record.result.id, record.revision, current => ({ ...current,
          result: { ...current.result, applied_change_set_ids: plan.change_set_ids } }))
        return this.finish(record, 'applied')
      } catch (error) {
        record = (await repo.get(resultId))!
        if (['applied', 'rolled_back'].includes(record.phase)) throw new Error('MERGE_PROJECTION_RECOVERY_REQUIRED')
        // An uncertain helper, child, or canonical drift never authorizes rollback.
        if (record.operations.some(item => ['planned', 'indeterminate'].includes(item.status))
          || await this.hasPendingPostCheck(record)) throw new Error('MERGE_RECOVERY_REQUIRED')
        try { return await this.restore(record, error instanceof Error ? error.message : 'MERGE_APPLY_FAILED') }
        catch { throw new Error('MERGE_RECOVERY_REQUIRED') }
      }
    }))
  }
  private async hasPendingPostCheck(record: MergeTransactionRecord): Promise<boolean> {
    for (const check of record.post_checks) {
      if (this.controller.hasLiveHandle(check.id)) return true
      try {
        const process = await readMergeValidationProcess(this.basePath, { id: check.id,
          runId: record.result.workflow_run_id, attemptId: check.attempt_id, workspaceId: null, ordinal: check.ordinal })
        if (!process || process.workflow_run_id !== record.result.workflow_run_id || process.workspace_id !== null
          || process.process_purpose !== 'validation' || process.process_ordinal !== check.ordinal || process.status !== 'exited') return true
      } catch { return true }
    }
    return false
  }
  /** Derive the precise known state solely by replaying successful durable operations. */
  private async expectedCurrent(record: MergeTransactionRecord): Promise<Map<string, MergeFileState>> {
    if (record.operations.some(item => ['planned', 'indeterminate'].includes(item.status))) throw new Error('MERGE_RECOVERY_REQUIRED')
    const paths = new Map(record.entries.map(entry => [entry.path, entry.before]))
    for (const operation of record.operations) {
      if (operation.status !== 'succeeded') continue
      const value: MergeFileState = { kind: 'file', sha256: operation.expected_sha256, size_bytes: operation.size_bytes,
        mode: operation.mode, evidence_file: 'operation' }
      if (operation.kind === 'stage') paths.set(operation.destination, value)
      else { paths.set(operation.source, { kind: 'absent' }); if (operation.kind === 'rename') paths.set(operation.destination, value) }
    }
    return paths
  }
  private async restore(record: MergeTransactionRecord, errorCode: string | null): Promise<MergeResult> {
    if (await this.hasPendingPostCheck(record)) throw new Error('MERGE_RECOVERY_REQUIRED')
    const { canonicalRoot, repo } = await this.roots()
    const expected = await this.expectedCurrent(record)
    // Check every affected path before the first rollback mutation. Unrelated user edits survive.
    for (const [path, value] of expected) await this.verifyState(await resolvePathWithinRoot(canonicalRoot, ...path.split('/')), value)
    if (record.phase !== 'rolling_back') record = await repo.update(record.result.id, record.revision, current => ({ ...current,
      phase: 'rolling_back', result: { ...current.result, completed_at: null,
        filesystem_apply: { status: 'pending', rollback_ref: null, error_code: null, error_message: null } } }))
    for (const [index, entry] of record.entries.entries()) {
      const current = expected.get(entry.path) ?? entry.before
      if (sameState(current, entry.before)) continue
      if (current.kind === 'file') record = await this.operation(record, 'delete', entry.path, '', current)
      if (entry.before.kind === 'file') {
        const staged = transientName(record.result.id, index, 'restore')
        const existing = expected.get(staged)
        if (!existing || existing.kind === 'absent') {
          record = await this.operation(record, 'stage', '', staged, entry.before, await repo.evidencePath(record.result.id, `${index}-before.bin`))
        } else {
          if (!sameState(existing, entry.before)) throw new Error('MERGE_ROLLBACK_PRECONDITION_FAILED')
          await this.verifyState(await resolvePathWithinRoot(canonicalRoot, staged), entry.before)
        }
        record = await this.operation(record, 'rename', staged, entry.path, entry.before)
      }
    }
    for (const [path, value] of await this.expectedCurrent(record)) {
      if (record.entries.some(entry => entry.path === path) || value.kind === 'absent') continue
      record = await this.operation(record, 'delete', path, '', value)
    }
    for (const entry of record.entries) await this.verifyState(await resolvePathWithinRoot(canonicalRoot, ...entry.path.split('/')), entry.before)
    return this.finish(record, 'rolled_back', errorCode)
  }
  async rollbackSubject(resultId: string, rawContext: RuntimeCommandContext): Promise<ExactMergeApprovalSubject> {
    operatorContext(rawContext)
    const { canonicalRoot, repo } = await this.roots()
    const record = await repo.get(resultId)
    if (record && record.canonical_root_hash !== hashCanonicalJson(canonicalRoot)) throw new Error('MERGE_RESULT_NOT_FOUND')
    if (!record?.authority || record.phase === 'rolled_back') throw new Error('MERGE_RESULT_NOT_ROLLBACKABLE')
    if (await this.hasPendingPostCheck(record)) throw new Error('MERGE_RECOVERY_REQUIRED')
    const expected = await this.expectedCurrent(record)
    for (const [path, value] of expected) await this.verifyState(await resolvePathWithinRoot(canonicalRoot, ...path.split('/')), value)
    const policyHash = hashCanonicalJson((await PolicyEngine.load(canonicalRoot)).getConfig())
    if (policyHash !== record.authority.policy_hash) throw new Error('MERGE_VALIDATION_CONFIG_CHANGED')
    const precondition = (await this.manifest(record.result.workflow_run_id)).root_manifest_hash
    return { planId: record.result.merge_plan_id, runId: record.result.workflow_run_id,
      targetRef: `merge-rollback:${record.result.id}`, canonicalPreconditionHash: precondition, policySnapshotHash: policyHash,
      planDigest: hashCanonicalJson({ schema_version: 1, action: 'rollback', transaction: record, precondition, policyHash }) }
  }
  async rollback(resultId: string, raw: MergeApplyRequest, rawContext: RuntimeCommandContext): Promise<MergeResult> {
    const context = operatorContext(rawContext), request = MergeApplyRequestSchema.parse(raw); this.available()
    return this.locked(async () => {
      const { canonicalRoot, repo } = await this.roots()
      let record = await repo.get(resultId)
      if (!record || record.canonical_root_hash !== hashCanonicalJson((await this.roots()).canonicalRoot)) throw new Error('MERGE_RESULT_NOT_FOUND')
      for (const other of await repo.list()) {
        if (other.result.id !== resultId && other.canonical_root_hash === record.canonical_root_hash
          && !['applied', 'rolled_back'].includes(other.phase)) throw new Error('MERGE_RECOVERY_REQUIRED')
      }
      const subject = await this.rollbackSubject(resultId, context)
      if (subject.planDigest !== request.plan_digest) throw new Error('MERGE_APPROVAL_PLAN_CHANGED')
      await consumeExactMergeApproval(canonicalRoot, { planId: record.result.merge_plan_id,
        approvalId: request.approval_id, operatorActor: context.actor, planDigest: request.plan_digest,
        consumedBy: `rollback-${record.result.id}` }, {
        resolveSubject: () => this.rollbackSubject(resultId, context), allowConsumedReceipt: true })
      record = await repo.update(record.result.id, record.revision, current => ({ ...current,
        rollback_authorities: [...current.rollback_authorities, { approval_id: request.approval_id,
          operator_actor: context.actor, plan_digest: request.plan_digest, policy_hash: subject.policySnapshotHash,
          idempotency_key: context.idempotencyKey }] }))
      return this.restore(record, null)
    })
  }
  async recover(resultId: string, rawContext: RuntimeCommandContext): Promise<MergeRecoveryReport> {
    operatorContext(rawContext)
    return this.locked(async () => {
      const { repo, runtimeDataRoot } = await this.roots()
      const record = await repo.get(resultId)
      if (!record || record.canonical_root_hash !== hashCanonicalJson((await this.roots()).canonicalRoot)) throw new Error('MERGE_RESULT_NOT_FOUND')
      const reasons: string[] = []
      // Retain custody and permit explicit cancellation retry for post-apply checks.
      for (const check of record.post_checks) {
        if (this.controller.hasLiveHandle(check.id)) {
          try {
            const stopped = await this.controller.cancel(check.id)
            if (!stopped.success) reasons.push('MERGE_POST_CHECK_CONTROL_FAILED')
          } catch { reasons.push('MERGE_POST_CHECK_CONTROL_FAILED') }
        }
      }
      if (await this.hasPendingPostCheck(record)) reasons.push('MERGE_POST_CHECK_PROCESS_UNVERIFIED')
      if (record.operations.some(item => ['planned', 'indeterminate'].includes(item.status))) reasons.push('MERGE_HELPER_OUTCOME_UNVERIFIED')
      if (reasons.length) return { schema_version: 1, result: record.result, disposition: 'requires_review', reason_codes: reasons }
      if (['applied', 'rolled_back'].includes(record.phase)) {
        const plans = new MergeRecordRepository(runtimeDataRoot), plan = await plans.getPlan(record.result.merge_plan_id)
        if (plan && plan.status !== record.phase) await plans.updatePlan(plan.id, plan.revision, value => ({ ...value, status: record.phase as 'applied' | 'rolled_back' }))
        return { schema_version: 1, result: record.result, disposition: 'terminal', reason_codes: [] }
      }
      return { schema_version: 1, result: record.result, disposition: record.phase === 'prepared' && !record.operations.length
        ? 'prepared' : 'rollback_available', reason_codes: [] }
    })
  }
}
