import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, readFile, realpath, readdir, rm, rmdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join, relative, resolve } from 'path'
import type { Approval } from '../contracts/schemas'
import { appendApproval, readApprovals, resolvePendingApproval } from '../approvals/repository'
import { appendGateDecision, readGateDecisions } from '../gates/repository'
import { readLocalWorkspace } from '../local-first/workspace'
import { PolicyEngine } from '../policy/engine'
import { RunRepository } from '../runtime/run-repository'
import type { WorkflowRun } from '../runtime/schema'
import { loadWorkspaceConfig, writeWorkspaceConfig } from '../workspaces/config'
import { createDefaultWorkspaceConfig } from '../workspaces/config-schema'
import { createSnapshotManifest } from '../workspaces/manifest'
import { hashCanonicalJson, hashSha256Bytes } from '../workspaces/hash'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { inspectCanonicalManifest } from '../workspaces/snapshot'
import { createTempDir } from '../../test/helpers/setup'
import { consumeExactMergeApproval, inspectExactMergeApprovalSubject, MergeApprovalError } from './approval'
import { MergeRecordRepository } from './repository'

const when = '2026-09-29T00:00:00.000Z'
const digest = (character: string) => `sha256:${character.repeat(64)}`

async function cleanOwnedTempDir(path: string): Promise<void> {
  const tempRoot = await realpath(tmpdir())
  const target = resolve(path)
  const withinTemp = relative(tempRoot, target)
  if (!withinTemp.startsWith('threados-test-') || isAbsolute(withinTemp)
    || withinTemp.includes('..')) throw new Error('Refusing to remove a non-test directory')
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const actual = await realpath(target)
      if (relative(tempRoot, actual) !== withinTemp) throw new Error('Test directory was redirected')
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      if (!(error instanceof Error && 'code' in error
        && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(String(error.code))) || attempt === 11) throw error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200 * (attempt + 1)))
    }
  }
}

describe('exact merge-plan approval gate', () => {
  let root: string
  let runtimeRoot: string
  let policyHash: string
  let subject: Awaited<ReturnType<typeof inspectExactMergeApprovalSubject>>

  beforeEach(async () => {
    root = await createTempDir()
    runtimeRoot = await createTempDir()
    await writeWorkspaceConfig(root, { ...createDefaultWorkspaceConfig(),
      runtime_data_root: runtimeRoot })
    policyHash = hashCanonicalJson((await PolicyEngine.load(root)).getConfig())
    const local = await readLocalWorkspace(root)
    expect(await resolveRuntimeDataRoot({ canonicalRoot: root,
      override: local.runtimeDataRoot })).toBe(runtimeRoot)
    const run: WorkflowRun = {
      schema_version: 2, id: 'run-approval', revision: 0, sequence_id: 'sequence-1',
      sequence_snapshot_hash: digest('1'), target: { kind: 'runnable' }, strategy: 'sequential',
      status: 'awaiting_review', max_concurrency: 1, policy_snapshot_hash: policyHash,
      baseline_snapshot_id: null, attempt_ids: [], created_by: 'operator', created_via: 'cli',
      created_at: when, started_at: when, ended_at: null, cancellation_requested_at: null,
      summary: null, error_code: null, error_message: null,
    }
    await new RunRepository(root).create(run)
    const config = await loadWorkspaceConfig(root)
    const current = await inspectCanonicalManifest({ canonicalRoot: root, runtimeDataRoot: runtimeRoot,
      localWorkspaceId: local.id, workflowRunId: run.id, config })
    const wHash = createSnapshotManifest('canonical-current', current.entries).root_manifest_hash
    const previewManifest = createSnapshotManifest('preview-1', [])
    const decision = { schema_version: 1, baseline_snapshot_id: 'baseline-1',
      baseline_manifest_hash: digest('a'), candidate_snapshot_id: 'candidate-1',
      candidate_manifest_hash: digest('b'), canonical_precondition_hash: wHash,
      change_set_ids: ['change-1'], entries: [], conflicts: [] }
    const namespace = resolveWorkspaceRuntimePaths(runtimeRoot, local.id, root).workspaceNamespace
    const previewRoot = join(runtimeRoot, 'merge-preview-workspaces', namespace, 'preview-1', 'tree')
    await mkdir(previewRoot, { recursive: true })
    const records = new MergeRecordRepository(runtimeRoot)
    await records.createPlan({ schema_version: 1, id: 'merge-1', revision: 0,
      workflow_run_id: run.id, baseline_snapshot_id: 'baseline-1', change_set_ids: ['change-1'],
      canonical_precondition_hash: wHash, preview_workspace_id: null, conflicts: [], status: 'draft',
      created_at: when, validated_at: null }, { candidate_manifest_hash: digest('b'),
      selected_change_sets: [{ id: 'change-1', change_set_root_hash: digest('c') }] })
    await records.createPreview({ schema_version: 1, id: 'preview-1', revision: 0,
      merge_plan_id: 'merge-1', workflow_run_id: run.id, canonical_precondition_hash: wHash,
      candidate_manifest_hash: digest('b'), decision_hash: hashCanonicalJson(decision), status: 'creating',
      root_path: previewRoot, manifest_hash: null,
      error_code: null, created_at: when, ready_at: null })
    await records.updatePreview('preview-1', 0, currentPreview => ({ ...currentPreview,
      status: 'ready', manifest_hash: previewManifest.root_manifest_hash, ready_at: when }))
    await records.updatePlan('merge-1', 0, plan => ({ ...plan, status: 'ready',
      preview_workspace_id: 'preview-1' }))
    await records.updatePlan('merge-1', 1, plan => ({ ...plan, status: 'validated',
      validated_at: when }))
    const evidenceRoot = join(runtimeRoot, 'merge-validations', 'merge-1')
    await mkdir(evidenceRoot, { recursive: true })
    await writeFile(join(evidenceRoot, 'decision.json'), JSON.stringify(decision))
    await writeFile(join(evidenceRoot, 'preview-manifest.json'), JSON.stringify(previewManifest))
    await writeFile(join(evidenceRoot, 'validation-receipt.json'), JSON.stringify({
      schema_version: 1, merge_plan_id: 'merge-1', plan_revision: 1,
      actor: 'operator-approver', idempotency_key: 'validation-1',
      validation_command_count: config.validate.length,
      validation_commands_hash: hashCanonicalJson(config.validate),
      policy_snapshot_hash: policyHash, status: 'completed', error_code: null,
      created_at: when, completed_at: when,
    }))
    subject = await inspectExactMergeApprovalSubject(root, 'merge-1')
  })

  afterEach(async () => {
    const outcomes = await Promise.allSettled([cleanOwnedTempDir(root), cleanOwnedTempDir(runtimeRoot)])
    const failure = outcomes.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  })

  async function approved(overrides: Partial<Approval> = {}, resolver = 'operator-approver'): Promise<Approval> {
    const pending: Approval = { id: 'approval-1', action_type: 'side_effect',
      target_ref: subject.targetRef, requested_by: 'operator-requester', status: 'pending',
      approved_by: null, approved_at: null, notes: null,
      subject_digest: subject.planDigest, payload_ref: subject.targetRef,
      policy_ref: subject.policySnapshotHash,
      precondition_hash: subject.canonicalPreconditionHash,
      expires_at: '2026-10-01T00:00:00.000Z', ...overrides }
    await appendApproval(root, subject.runId, pending)
    return resolvePendingApproval(root, subject.runId, pending.id, current => ({ ...current,
      status: 'approved', approved_by: resolver,
      approved_at: '2026-09-29T00:00:01.000Z' }))
  }

  function consume(overrides: Partial<Parameters<typeof consumeExactMergeApproval>[1]> = {},
    dependencies: Parameters<typeof consumeExactMergeApproval>[2] = {}) {
    return consumeExactMergeApproval(root, { planId: subject.planId, approvalId: 'approval-1',
      operatorActor: 'operator-approver', planDigest: subject.planDigest,
      consumedBy: 'threados-runtime', ...overrides }, {
      clock: () => new Date('2026-09-29T00:00:02.000Z'), ...dependencies,
    })
  }

  test('consumes exactly once and persists a gate decision bound to the approved plan', async () => {
    await approved()
    const result = await consume()
    expect(result.approval.consumed_by).toBe('threados-runtime')
    expect(result.subject.planDigest).toBe(subject.planDigest)
    const approvals = await readApprovals(root, subject.runId)
    expect(approvals).toHaveLength(3)
    expect(approvals.at(-1)?.consumed_at).toBe('2026-09-29T00:00:02.000Z')
    const decisions = await readGateDecisions(root, subject.runId)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ status: 'PASS', subject_ref: 'merge:merge-1',
      gate_type: 'approval_present', evidence_refs: expect.arrayContaining([subject.planDigest]) })
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_ALREADY_CONSUMED' })
  })

  test('repairs a consumed approval after gate evidence append fails, then rejects replay', async () => {
    await approved()
    await expect(consume({}, { appendDecision: async () => { throw new Error('injected append failure') } }))
      .rejects.toThrow('injected append failure')
    expect((await readApprovals(root, subject.runId)).filter(item => item.consumed_at)).toHaveLength(1)
    expect(await readGateDecisions(root, subject.runId)).toHaveLength(0)
    const repaired = await consume({}, { clock: () => new Date('2026-10-02T00:00:00.000Z') })
    expect(repaired.repairedDecision).toBe(true)
    expect((await readGateDecisions(root, subject.runId)).map(item => item.id)).toEqual([repaired.decision.id])
    expect((await readApprovals(root, subject.runId)).filter(item => item.consumed_at)).toHaveLength(1)
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_ALREADY_CONSUMED' })
  })

  test('repairs a torn gate tail while preserving earlier decisions and the damaged bytes', async () => {
    await approved()
    await appendGateDecision(root, subject.runId, { id: 'prior-decision', subject_type: 'step',
      subject_ref: 'prior-step', gate_type: 'policy_pass', status: 'PASS', reason_codes: [],
      evidence_refs: [], decided_by: 'threados', decided_at: when })
    const runDir = join(root, '.threados', 'runs', subject.runId)
    const journal = join(runDir, 'gate-decisions.ndjson')
    await expect(consume({}, { appendDecision: async () => {
      await appendFile(journal, '{"id":"torn-approval')
      throw new Error('injected torn append')
    } })).rejects.toThrow('injected torn append')
    const damagedBytes = await readFile(journal, 'utf8')
    await expect(readGateDecisions(root, subject.runId)).rejects.toThrow('GATE_DECISION_JOURNAL_CORRUPT')
    const repaired = await consume()
    expect(repaired.repairedDecision).toBe(true)
    expect((await readGateDecisions(root, subject.runId)).map(item => item.id))
      .toEqual(['prior-decision', repaired.decision.id])
    const archives = (await readdir(runDir)).filter(name => name.startsWith('gate-decisions.ndjson.torn-'))
    expect(archives).toHaveLength(1)
    const archived = JSON.parse(await readFile(join(runDir, archives[0]!), 'utf8'))
    expect(Buffer.from(archived.source_bytes_base64, 'base64')).toEqual(Buffer.from(damagedBytes))
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_ALREADY_CONSUMED' })
  })

  test('concurrent consumers yield one winner and one consumed lifecycle record', async () => {
    await approved()
    const outcomes = await Promise.allSettled([consume(), consume()])
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect((outcomes.find(item => item.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'MERGE_APPROVAL_ALREADY_CONSUMED' })
    expect((await readApprovals(root, subject.runId)).filter(item => item.consumed_at)).toHaveLength(1)
    expect(await readGateDecisions(root, subject.runId)).toHaveLength(1)
  })

  test('separate processes cannot consume the same approval twice', async () => {
    await approved()
    const adapterUrl = new URL('./approval.ts', import.meta.url).href
    const script = `import { consumeExactMergeApproval } from ${JSON.stringify(adapterUrl)};
      try {
        await consumeExactMergeApproval(${JSON.stringify(root)}, {
          planId: ${JSON.stringify(subject.planId)}, approvalId: 'approval-1',
          operatorActor: 'operator-approver', planDigest: ${JSON.stringify(subject.planDigest)},
          consumedBy: 'threados-runtime',
        }, { clock: () => new Date('2026-09-29T00:00:02.000Z') });
      } catch (error) { console.error(error); process.exitCode = 1; }`
    const children = Array.from({ length: 2 }, () => Bun.spawn([process.execPath, '-e', script], {
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    }))
    const exits = await Promise.all(children.map(child => child.exited))
    const errors = await Promise.all(children.map(child => new Response(child.stderr).text()))
    expect(exits.sort()).toEqual([0, 1])
    expect(errors.join('\n')).not.toContain('ERR_MODULE_NOT_FOUND')
    expect((await readApprovals(root, subject.runId)).filter(item => item.consumed_at)).toHaveLength(1)
    expect(await readGateDecisions(root, subject.runId)).toHaveLength(1)
  })

  test.each([
    ['wrong plan digest', { subject_digest: digest('9') }],
    ['wrong action', { action_type: 'run' as const }],
    ['wrong target', { target_ref: 'merge:other' }],
    ['wrong payload', { payload_ref: 'merge:other' }],
    ['wrong policy', { policy_ref: digest('9') }],
    ['wrong W', { precondition_hash: digest('9') }],
    ['missing expiry', { expires_at: null }],
  ])('rejects %s without consuming', async (_label, override) => {
    await approved(override)
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_BINDING_MISMATCH' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
    expect(await readGateDecisions(root, subject.runId)).toHaveLength(0)
  })

  test('rejects expired and wrong-actor approvals', async () => {
    await approved({ expires_at: '2026-09-29T00:00:02.000Z' })
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_EXPIRED' })
    await expect(consume({ operatorActor: 'agent-claim' })).rejects
      .toMatchObject({ code: 'MERGE_APPROVAL_INPUT_INVALID' })
  })

  test('rejects an obvious agent resolver claiming operator authority', async () => {
    await approved({ requested_by: 'agent:builder' }, 'agent:builder')
    await expect(consume({ operatorActor: 'agent:builder' }))
      .rejects.toMatchObject({ code: 'MERGE_APPROVAL_INPUT_INVALID' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('rejects a stale W even when the approval was exact at request time', async () => {
    await approved()
    await writeFile(join(root, 'external-edit.txt'), 'operator changed W')
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_STALE_CANONICAL' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('rejects absent and tampered preview decision bytes despite saved hashes', async () => {
    await approved()
    const decisionPath = join(runtimeRoot, 'merge-validations', 'merge-1', 'decision.json')
    const original = await readFile(decisionPath, 'utf8')
    await unlink(decisionPath)
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_PREVIEW_EVIDENCE_MISSING' })
    await writeFile(decisionPath, JSON.stringify({ ...JSON.parse(original),
      candidate_manifest_hash: digest('f') }))
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_PREVIEW_EVIDENCE_CHANGED' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('rejects missing preview manifest and a changed preview tree', async () => {
    await approved()
    const manifestPath = join(runtimeRoot, 'merge-validations', 'merge-1', 'preview-manifest.json')
    const original = await readFile(manifestPath, 'utf8')
    await unlink(manifestPath)
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_PREVIEW_EVIDENCE_MISSING' })
    await writeFile(manifestPath, original)
    const preview = await new MergeRecordRepository(runtimeRoot).getPreview('preview-1')
    expect(preview).not.toBeNull()
    await writeFile(join(preview!.root_path, 'unexpected.txt'), 'tampered')
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_SUBJECT_INVALID' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('rejects a missing preview tree and a forged successful command receipt', async () => {
    const preview = await new MergeRecordRepository(runtimeRoot).getPreview('preview-1')
    expect(preview).not.toBeNull()
    await rmdir(preview!.root_path)
    await expect(inspectExactMergeApprovalSubject(root, 'merge-1'))
      .rejects.toMatchObject({ code: 'MERGE_PREVIEW_EVIDENCE_MISSING' })
    await mkdir(preview!.root_path)
    const config = await loadWorkspaceConfig(root)
    await writeWorkspaceConfig(root, { ...config, validate: ['node --version'] })
    const evidenceRoot = join(runtimeRoot, 'merge-validations', 'merge-1')
    const receiptPath = join(evidenceRoot, 'validation-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(receiptPath, JSON.stringify({ ...receipt, validation_command_count: 1,
      validation_commands_hash: hashCanonicalJson(['node --version']) }))
    await writeFile(join(evidenceRoot, '0.json'), JSON.stringify({ schema_version: 1,
      merge_plan_id: 'merge-1', preview_id: 'preview-1', index: 0,
      command_sha256: hashSha256Bytes('node'), args_sha256: hashSha256Bytes(JSON.stringify(['--version'])),
      cwd: preview!.root_path, status: 'passed', pid: 12345, exit_code: 0,
      process_status: 'exited', stdout_sha256: digest('1'), stderr_sha256: digest('2'),
      started_at: when, completed_at: when }))
    await expect(inspectExactMergeApprovalSubject(root, 'merge-1'))
      .rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
  })

  test('rejects a changed plan and a stale validation receipt', async () => {
    await approved()
    const records = new MergeRecordRepository(runtimeRoot)
    await records.updatePlan('merge-1', 2, plan => ({ ...plan, status: 'validated' }))
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_STALE' })
    await writeFile(join(runtimeRoot, 'merge-validations', 'merge-1', 'validation-receipt.json'),
      JSON.stringify({ schema_version: 1, merge_plan_id: 'merge-1', plan_revision: 2,
        actor: 'operator-approver', idempotency_key: 'validation-1',
        validation_command_count: 0, validation_commands_hash: hashCanonicalJson([]),
        policy_snapshot_hash: policyHash, status: 'completed', error_code: null,
        created_at: when, completed_at: when }))
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_APPROVAL_PLAN_CHANGED' })
  })

  test('rejects workspace validation command edits after the plan was validated', async () => {
    await approved()
    const config = await loadWorkspaceConfig(root)
    await writeWorkspaceConfig(root, { ...config, validate: ['node --version'] })
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_VALIDATION_CONFIG_CHANGED' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('rejects policy edits after validation without consuming approval', async () => {
    await approved()
    await writeFile(join(root, '.threados', 'policy.yaml'), 'mode: POWER\n')
    await expect(consume()).rejects.toMatchObject({ code: 'MERGE_VALIDATION_CONFIG_CHANGED' })
    expect((await readApprovals(root, subject.runId)).at(-1)?.consumed_at).toBeUndefined()
  })

  test('records no PASS on malformed persisted approvals', async () => {
    await approved()
    const file = join(root, '.threados', 'runs', subject.runId, 'approvals.ndjson')
    await writeFile(file, (await readFile(file, 'utf8')) + '{corrupt\n')
    await expect(consume()).rejects.toThrow()
    expect(await readGateDecisions(root, subject.runId)).toHaveLength(0)
  })

  test('exports a stable, machine-readable gate error', () => {
    expect(new MergeApprovalError('MERGE_APPROVAL_EXPIRED').code).toBe('MERGE_APPROVAL_EXPIRED')
  })
})
