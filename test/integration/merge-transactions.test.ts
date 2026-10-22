import { afterEach, expect, test } from 'bun:test'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { type Pr11Fixture } from './pr11-workspace-test-helper'
import { ownedFixtureMergeProvider } from '../helpers/merge-fixture-provider'
import { getThreadOSRuntimeService, clearRuntimeServiceFactoryForTests } from '../../lib/runtime/factory'
import { readApprovals, foldApprovals } from '../../lib/approvals/repository'
import { MergeResultRepository } from '../../lib/merge/result-repository'
import { readGateDecisions } from '../../lib/gates/repository'
import { readTraceEvents } from '../../lib/traces/reader'
import { ProcessRepository } from '../../lib/runtime/process-repository'

let fixtures: Pr11Fixture[] = []
afterEach(async () => { for (const fixture of fixtures) await fixture.cleanup(); fixtures = []; process.exitCode = 0 })
import { context, approve, prepare as createTransactionFixture } from '../helpers/m2-transaction-fixture'
async function prepare(options: Parameters<typeof createTransactionFixture>[0] = {}) {
  const result = await createTransactionFixture(options)
  fixtures.push(result.fixture)
  return result
}

for (const git of [false, true]) test(`real configured validation, exact approval, apply and fresh rollback approval (${git ? 'dirty Git' : 'non-Git'})`, async () => {
  const { fixture, service, completed, preview, subject } = await prepare({ git })
  const approval = await approve(fixture, subject)
  const applyContext = context('apply')
  const result = await service.applyMergePlan(preview.plan.id, approval, applyContext)
  expect(result.filesystem_apply.status).toBe('applied')
  expect(await readFile(join(fixture.canonical, 'agent-real.txt'), 'utf8')).toBe('real-process\n')
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('agent-update\n')
  expect(await readdir(fixture.canonical)).not.toContain('obsolete.txt')
  expect(await service.applyMergePlan(preview.plan.id, approval, applyContext)).toEqual(result)
  await expect(service.applyMergePlan(preview.plan.id, approval, context('replay-other-key'))).rejects.toMatchObject({ code: 'MERGE_PLAN_NOT_VALIDATED' })
  const consumed = foldApprovals(await readApprovals(fixture.canonical, subject.runId)).find(item => item.id === approval.approval_id)
  expect(consumed?.consumed_by).toBe(result.id)
  expect((await readGateDecisions(fixture.canonical, subject.runId)).filter(item => item.subject_ref === subject.targetRef)).toHaveLength(1)
  expect((await readTraceEvents(fixture.canonical, subject.runId)).some(item => item.payload_ref === `merge-result:${result.id}:applied` && item.agent_registration?.registration_id)).toBe(true)
  const processes = (await new ProcessRepository(fixture.canonical).list()).filter(item => item.process_purpose === 'validation')
  expect(processes).toHaveLength(6)
  expect(processes.every(item => item.status === 'exited' && item.exit_code === 0)).toBe(true)
  const rollbackSubject = await service.inspectMergeRollbackSubject(result.id, context('rollback-subject'))
  const rollbackApproval = await approve(fixture, rollbackSubject)
  const rolled = await service.rollbackMergeResult(result.id, rollbackApproval, context('rollback'))
  expect(rolled.filesystem_apply.status).toBe('rolled_back')
  expect(await readdir(fixture.canonical)).not.toContain('agent-real.txt')
  expect((await service.inspectMergePlan(preview.plan.id))?.status).toBe('rolled_back')
  expect((await service.recoverMergeResult(result.id, context('recover'))).disposition).toBe('terminal')
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
  expect(await readFile(join(fixture.canonical, 'obsolete.txt'), 'utf8')).toBe('restore this file\n')
  expect(await readFile(join(fixture.canonical, 'user-after-launch.txt'), 'utf8')).toBe('user change after launch\n')
  if (git) expect(await readFile(join(fixture.canonical, 'dirty-user.txt'), 'utf8')).toBe('preserved dirty user file\n')
  expect(completed.attempts[0]!.agent_registration).toBeTruthy()
}, 120_000)

test('unapproved, mismatched, system and stale operations leave canonical untouched', async () => {
  const { fixture, service, preview, subject } = await prepare()
  const approval = await approve(fixture, subject)
  await expect(service.applyMergePlan(preview.plan.id, approval, { ...context(), interface: 'system' })).rejects.toMatchObject({ code: 'POLICY_DENIED' })
  await expect(service.applyMergePlan(preview.plan.id, approval, { ...context(), policyConfirmed: false })).rejects.toMatchObject({ code: 'MERGE_CONFIRMATION_REQUIRED' })
  await expect(service.applyMergePlan(preview.plan.id, { ...approval, plan_digest: `sha256:${'f'.repeat(64)}` }, context())).rejects.toMatchObject({ code: 'MERGE_APPROVAL_PLAN_CHANGED' })
  await writeFile(join(fixture.canonical, 'source.txt'), 'operator changed it\n')
  await expect(service.applyMergePlan(preview.plan.id, approval, context())).rejects.toMatchObject({ code: 'MERGE_STALE_CANONICAL' })
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('operator changed it\n')
  expect(foldApprovals(await readApprovals(fixture.canonical, subject.runId))[0]?.consumed_at).toBeNull()
}, 120_000)

test('known apply failure rolls back; post-check failure executes real child and rolls back', async () => {
  for (const options of [{ fault: (_kind: string, index: number) => index === 2 ? 'failed' as const : null }, { postFail: true }]) {
    const { fixture, service, preview, subject } = await prepare(options)
    const result = await service.applyMergePlan(preview.plan.id, await approve(fixture, subject), context('apply'))
    expect(result.filesystem_apply.status).toBe('rolled_back')
    expect(await readdir(fixture.canonical)).not.toContain('agent-real.txt')
    expect((await readdir(fixture.canonical)).some(name => name.startsWith('threados-merge-'))).toBe(false)
  }
}, 120_000)

test('indeterminate helper is durable, blocks automatic rollback and other applies across service restart', async () => {
  const { fixture, service, preview, subject, provider } = await prepare({ fault: (_kind, index) => index === 1 ? 'indeterminate' : null })
  const approval = await approve(fixture, subject)
  await expect(service.applyMergePlan(preview.plan.id, approval, context('apply'))).rejects.toMatchObject({ code: 'MERGE_RECOVERY_REQUIRED' })
  const repo = new MergeResultRepository(fixture.runtime, fixture.canonical), records = await repo.list()
  expect(records).toHaveLength(1)
  expect(records[0]!.phase).toBe('applying')
  expect(records[0]!.result.filesystem_apply.status).toBe('pending')
  clearRuntimeServiceFactoryForTests()
  const restarted = await getThreadOSRuntimeService(fixture.canonical, { dependencies: { mergeMutationProvider: provider } })
  const recovered = await restarted.recoverMergeResult(records[0]!.result.id, context('recover'))
  expect(recovered.disposition).toBe('requires_review')
  expect(recovered.reason_codes).toContain('MERGE_HELPER_OUTCOME_UNVERIFIED')
  await expect(restarted.inspectMergeRollbackSubject(records[0]!.result.id, context('rollback'))).rejects.toMatchObject({ code: 'MERGE_RECOVERY_REQUIRED' })
  expect(records[0]!.operations.map(item => item.status)).toEqual(['succeeded', 'indeterminate'])
}, 120_000)


test('prepared journal resumes only with its original exact approval after service restart', async () => {
  const { fixture, service, preview, subject, provider } = await prepare()
  const missing = { approval_id: 'approval-created-later', plan_digest: subject.planDigest }
  await expect(service.applyMergePlan(preview.plan.id, missing, context('resume'))).rejects.toMatchObject({ code: 'MERGE_APPROVAL_NOT_FOUND' })
  const repo = new MergeResultRepository(fixture.runtime, fixture.canonical)
  const prepared = (await repo.list())[0]!
  expect(prepared.phase).toBe('prepared')
  expect(prepared.operations).toHaveLength(0)
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
  await approve(fixture, subject, missing.approval_id)
  clearRuntimeServiceFactoryForTests()
  const restarted = await getThreadOSRuntimeService(fixture.canonical, { dependencies: { mergeMutationProvider: provider } })
  expect((await restarted.recoverMergeResult(prepared.result.id, context('inspect-recovery'))).disposition).toBe('prepared')
  const result = await restarted.applyMergePlan(preview.plan.id, missing, context('resume'))
  expect(result.filesystem_apply.status).toBe('applied')
  await writeFile(join(fixture.canonical, 'source.txt'), 'later operator edit\n')
  await expect(restarted.inspectMergeRollbackSubject(result.id, context('rollback-subject'))).rejects.toMatchObject({ code: 'MERGE_ROLLBACK_PRECONDITION_FAILED' })
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('later operator edit\n')
}, 120_000)


test('validation retains a real live child after control failure and recovery observes cancellation', async () => {
  const { fixture, service, preview } = await prepare({ commandCount: 1 })
  const { MergeRuntimeOperations } = await import('../../lib/merge/runtime-operations')
  const { assertMergeFileCapabilities } = await import('../../lib/merge/mutation-provider')
  const { startProcess } = await import('../../lib/runner/wrapper')
  const { ProcessControlError } = await import('../../lib/runner/process-handle')
  const fresh = await service.previewSelectedChangeSet(preview.plan.change_set_ids[0]!, context('custody-preview'))
  let childPid = 0
  const operations = new MergeRuntimeOperations(fixture.canonical, assertMergeFileCapabilities, async config => {
    const handle = await startProcess({ ...config, command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] })
    childPid = handle.pid!
    void handle.result.catch(() => undefined)
    const rejected = Promise.reject(new ProcessControlError('injected failed cancellation while child remains live',
      { success: false, signal: 'SIGTERM', code: 'PROCESS_CONTROL_FAILED', message: 'fixture control failure' }))
    void rejected.catch(() => undefined)
    return { ...handle, result: rejected }
  })
  try {
    await expect(operations.validate(fresh.plan.id, context('custody-validate'))).rejects.toThrow('MERGE_VALIDATION_RECOVERY_REQUIRED')
    expect(childPid).toBeGreaterThan(0)
    expect(() => process.kill(childPid, 0)).not.toThrow()
    const receipt = JSON.parse(await readFile(join(fixture.runtime, 'merge-validations', fresh.plan.id, 'validation-receipt.json'), 'utf8'))
    expect(receipt.status).toBe('running')
    expect((await operations.recoverValidation(fresh.plan.id, context('custody-recover'))).disposition).toBe('quiescent')
    expect(() => process.kill(childPid, 0)).toThrow()
    expect(JSON.parse(await readFile(join(fixture.runtime, 'merge-validations', fresh.plan.id, 'validation-receipt.json'), 'utf8')).status).toBe('failed')
  } finally { try { process.kill(childPid, 'SIGKILL') } catch { /* already observed absent */ } }
}, 120_000)

test('operator API applies and CLI rolls back through the same service; request cannot supply actor/provider', async () => {
  const { fixture, service, preview, subject } = await prepare()
  globalThis.__THREADOS_RUNTIME_SERVICE__ = service
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service
  const { POST } = await import('../../app/api/merge-plans/[planId]/apply/route')
  const approval = await approve(fixture, subject, 'api-approval', 'local@thredos')
  const request = (body: unknown) => new Request('http://localhost/api/merge-plans/plan/apply', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'operator-api-apply' }, body: JSON.stringify(body) })
  try {
    expect((await POST(request({ ...approval, confirm: true, actor: 'agent:spoof' }), { params: Promise.resolve({ planId: preview.plan.id }) })).status).toBe(400)
    expect((await POST(request({ ...approval }), { params: Promise.resolve({ planId: preview.plan.id }) })).status).toBe(400)
    const response = await POST(request({ ...approval, confirm: true }), { params: Promise.resolve({ planId: preview.plan.id }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.filesystem_apply.status).toBe('applied')
    const rollbackSubject = await service.inspectMergeRollbackSubject(body.result.id, context('rollback-subject'))
    const rollbackApproval = await approve(fixture, rollbackSubject, 'cli-rollback-approval', 'local@thredos')
    const { main } = await import('../../lib/seqctl/index')
    const lines: string[] = [], prior = console.log
    console.log = value => { lines.push(String(value)) }
    try { await main(['merge', 'rollback', body.result.id, rollbackApproval.approval_id, rollbackApproval.plan_digest, '--confirm', '--json']) }
    finally { console.log = prior }
    expect(process.exitCode).toBe(0)
    expect(JSON.parse(lines[0]!).data.result.filesystem_apply.status).toBe('rolled_back')
    expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
  } finally {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  }
}, 120_000)

test('default production capability, unsupported Windows provider and hosted execution remain gated', async () => {
  const { fixture, preview, subject } = await prepare()
  const approval = await approve(fixture, subject)
  clearRuntimeServiceFactoryForTests()
  const normal = await getThreadOSRuntimeService(fixture.canonical)
  await expect(normal.applyMergePlan(preview.plan.id, approval, context('gated'))).rejects.toMatchObject({ code: 'MERGE_APPLY_CAPABILITY_UNAVAILABLE' })
  const { createWindowsMergeMutationProvider } = await import('../../lib/merge/windows-mutation-provider')
  if (process.platform !== 'win32') {
    const windows = createWindowsMergeMutationProvider({ nativeDirectory: join(process.cwd(), 'native/windows-apply'), executablePath: process.execPath })
    expect(() => windows.assertAvailable()).toThrow('MERGE_UNSUPPORTED_PLATFORM')
  }
  const prior = process.env.THREDOS_HOSTED_MODE
  process.env.THREDOS_HOSTED_MODE = 'true'
  try { await expect(normal.validateMergePlan(preview.plan.id, context('hosted'))).rejects.toMatchObject({ code: 'MERGE_VALIDATION_POLICY_DENIED' }) }
  finally { if (prior === undefined) delete process.env.THREDOS_HOSTED_MODE; else process.env.THREDOS_HOSTED_MODE = prior }
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
}, 120_000)

test('rollback resumes a known staged restore across restart with fresh exact approval', async () => {
  let failRestoreRename = false
  const { fixture, service, preview, subject } = await prepare()
  const applied = await service.applyMergePlan(preview.plan.id, await approve(fixture, subject), context('apply'))
  clearRuntimeServiceFactoryForTests()
  const firstProvider = ownedFixtureMergeProvider(fixture.canonical)
  const realMutate = firstProvider.mutate.bind(firstProvider)
  firstProvider.mutate = async input => {
    if (!failRestoreRename && input.operation.kind === 'rename' && input.operation.source.endsWith('-restore')) {
      failRestoreRename = true
      return { status: 'failed', journalPath: null, pid: null, code: 'MERGE_FIXTURE_RESTORE_RENAME_FAILED' }
    }
    return realMutate(input)
  }
  const first = await getThreadOSRuntimeService(fixture.canonical, { dependencies: { mergeMutationProvider: firstProvider } })
  const before = await first.inspectMergeRollbackSubject(applied.id, context('rollback-first-subject'))
  await expect(first.rollbackMergeResult(applied.id, await approve(fixture, before), context('rollback-first'))).rejects.toMatchObject({ code: 'MERGE_MUTATION_FAILED' })
  const record = (await new MergeResultRepository(fixture.runtime, fixture.canonical).get(applied.id))!
  expect(record.phase).toBe('rolling_back')
  expect(record.result.filesystem_apply.status).toBe('pending')
  clearRuntimeServiceFactoryForTests()
  const restarted = await getThreadOSRuntimeService(fixture.canonical, { dependencies: { mergeMutationProvider: ownedFixtureMergeProvider(fixture.canonical) } })
  expect((await restarted.recoverMergeResult(applied.id, context('recover'))).disposition).toBe('rollback_available')
  const after = await restarted.inspectMergeRollbackSubject(applied.id, context('rollback-next-subject'))
  expect(after.planDigest).not.toBe(before.planDigest)
  expect((await restarted.rollbackMergeResult(applied.id, await approve(fixture, after), context('rollback-next'))).filesystem_apply.status).toBe('rolled_back')
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
  expect(await readFile(join(fixture.canonical, 'obsolete.txt'), 'utf8')).toBe('restore this file\n')
  expect((await readdir(fixture.canonical)).some(name => name.startsWith('threados-merge-'))).toBe(false)
}, 120_000)

test('missing physical post-check evidence blocks rollback and never becomes quiescent through an empty index', async () => {
  const { fixture, service, preview, subject } = await prepare()
  const applied = await service.applyMergePlan(preview.plan.id, await approve(fixture, subject), context('apply'))
  const repo = new MergeResultRepository(fixture.runtime, fixture.canonical), record = (await repo.get(applied.id))!
  const check = record.post_checks[0]!
  const path = join(fixture.canonical, '.threados', 'runs', subject.runId, 'attempts', check.attempt_id, 'processes', `${check.id}.json`)
  const { unlink } = await import('fs/promises')
  await unlink(path)
  expect((await service.recoverMergeResult(applied.id, context('recover'))).disposition).toBe('requires_review')
  await expect(service.inspectMergeRollbackSubject(applied.id, context('rollback'))).rejects.toMatchObject({ code: 'MERGE_RECOVERY_REQUIRED' })
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('agent-update\n')
}, 120_000)

test('apply serializes selection revocation while consuming exact approval', async () => {
  const { fixture, service, preview, subject } = await prepare()
  const approval = await approve(fixture, subject)
  const review = await service.inspectChangeSetById(preview.plan.change_set_ids[0]!)
  const { setSafeIoAfterOpenHookForTests } = await import('../../lib/security/safe-io')
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  let held = false, rejectionFinished = false
  setSafeIoAfterOpenHookForTests(async ({ operation, filePath }) => {
    if (!held && operation === 'read' && filePath.endsWith('approvals.ndjson')) { held = true; enter(); await barrier }
  })
  const applying = service.applyMergePlan(preview.plan.id, approval, context('apply-serialized'))
  try {
    await entered
    const rejecting = service.rejectChangeSetById({ changeSetId: review.summary.id,
      expectedRevision: review.summary.revision, reason: 'operator revocation queued after apply intent' }, context('reject-queued'))
      .then(value => { rejectionFinished = true; return value })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(rejectionFinished).toBe(false)
    release()
    expect((await applying).filesystem_apply.status).toBe('applied')
    expect((await rejecting).status).toBe('rejected')
    expect(rejectionFinished).toBe(true)
  } finally { release(); setSafeIoAfterOpenHookForTests(null); await applying.catch(() => undefined) }
}, 120_000)

test('exact replay verifies orphan prepared evidence before creating its journal', async () => {
  const { fixture, service, preview, subject } = await prepare()
  const approval = await approve(fixture, subject)
  const { setAtomicBeforeRenameHookForTests } = await import('../../lib/fs/atomic')
  let failed = false
  setAtomicBeforeRenameHookForTests(target => {
    if (!failed && target.includes('merge-results') && /result-[a-f0-9]+\.json$/.test(target)) {
      failed = true; throw new Error('fixture interruption before initial result journal')
    }
  })
  try { await expect(service.applyMergePlan(preview.plan.id, approval, context('orphan-resume'))).rejects.toMatchObject({ code: 'MERGE_EVIDENCE_UNAVAILABLE' }) }
  finally { setAtomicBeforeRenameHookForTests(null) }
  expect(failed).toBe(true)
  expect(await new MergeResultRepository(fixture.runtime, fixture.canonical).list()).toHaveLength(0)
  expect(foldApprovals(await readApprovals(fixture.canonical, subject.runId)).find(item => item.id === approval.approval_id)?.consumed_at).toBeNull()
  expect((await service.applyMergePlan(preview.plan.id, approval, context('orphan-resume'))).filesystem_apply.status).toBe('applied')
}, 120_000)

test('wrong-owner or moved physical validation evidence cannot authorize approval, apply or replay', async () => {
  const { fixture, service, preview, subject, completed } = await prepare()
  const approval = await approve(fixture, subject)
  const path = join(fixture.canonical, '.threados', 'runs', subject.runId, 'attempts', completed.attempts[0]!.id,
    'processes', `process-${preview.plan.id}-0.json`)
  const original = await readFile(path, 'utf8')
  await writeFile(path, JSON.stringify({ ...JSON.parse(original), attempt_id: 'wrong-owner-attempt' }))
  await expect(service.inspectMergeApprovalSubject(preview.plan.id, context('wrong-owner-subject'))).rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
  await expect(service.validateMergePlan(preview.plan.id, context('validate'))).rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
  await expect(service.applyMergePlan(preview.plan.id, approval, context('wrong-owner-apply'))).rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
  await writeFile(path, original)
  const { rename } = await import('fs/promises')
  await rename(path, `${path}.moved`)
  await expect(service.inspectMergeApprovalSubject(preview.plan.id, context('moved-subject'))).rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
  expect(foldApprovals(await readApprovals(fixture.canonical, subject.runId)).find(item => item.id === approval.approval_id)?.consumed_at).toBeNull()
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
}, 120_000)
