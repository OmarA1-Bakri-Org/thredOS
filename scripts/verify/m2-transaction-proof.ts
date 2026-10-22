/** Bounded M2 regular-file transaction proof. All writes target newly owned disposable fixtures. */
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { prepare, approve, context } from '../../test/helpers/m2-transaction-fixture'
import { MergeResultRepository } from '../../lib/merge/result-repository'
import { ProcessRepository } from '../../lib/runtime/process-repository'
import { readApprovals, foldApprovals } from '../../lib/approvals/repository'
import { readTraceEvents } from '../../lib/traces/reader'
import { createWindowsMergeMutationProvider } from '../../lib/merge/windows-mutation-provider'

const native = process.argv.includes('--windows-native')
const fixture = process.argv.includes('--fixture-contract')
if (native === fixture || !process.argv.includes('--confirm-owned-fixtures')) {
  throw new Error('Choose --fixture-contract OR --windows-native, with --confirm-owned-fixtures')
}
if (native && process.platform !== 'win32') throw new Error('MERGE_UNSUPPORTED_PLATFORM')
const evidenceRoot = join(process.cwd(), 'test-results', 'verify', 'm2-transactions', new Date().toISOString().replaceAll(':', '-'))
await mkdir(evidenceRoot, { recursive: true })
const variants: unknown[] = []
try {
  for (const git of [true, false]) {
    const prepared = await prepare({ git, ...(native ? { provider: () => createWindowsMergeMutationProvider({
      nativeDirectory: join(process.cwd(), 'native', 'windows-apply'), executablePath: process.execPath,
    }) } : {}) })
    const { fixture: owned, service, preview, subject } = prepared
    try {
      const authorization = await approve(owned, subject)
      const applied = await service.applyMergePlan(preview.plan.id, authorization, context('bounded-apply'))
      assert.equal(applied.filesystem_apply.status, 'applied')
      assert.equal(await readFile(join(owned.canonical, 'source.txt'), 'utf8'), 'agent-update\n')
      const repo = new MergeResultRepository(owned.runtime, owned.canonical)
      const appliedJournal = (await repo.get(applied.id))!
      assert(appliedJournal.operations.every(item => item.status === 'succeeded'))
      assert.equal(foldApprovals(await readApprovals(owned.canonical, subject.runId)).find(item => item.id === authorization.approval_id)?.consumed_by, applied.id)
      const rollbackSubject = await service.inspectMergeRollbackSubject(applied.id, context('bounded-rollback-subject'))
      const rolled = await service.rollbackMergeResult(applied.id, await approve(owned, rollbackSubject), context('bounded-rollback'))
      assert.equal(rolled.filesystem_apply.status, 'rolled_back')
      assert.equal(await readFile(join(owned.canonical, 'source.txt'), 'utf8'), 'canonical-baseline\n')
      assert.equal(await readFile(join(owned.canonical, 'obsolete.txt'), 'utf8'), 'restore this file\n')
      assert.equal(await readFile(join(owned.canonical, 'user-after-launch.txt'), 'utf8'), 'user change after launch\n')
      const processes = (await new ProcessRepository(owned.canonical).list()).filter(item => item.process_purpose === 'validation')
      assert.equal(processes.length, 6)
      assert(processes.every(item => item.status === 'exited' && item.exit_code === 0))
      const traces = await readTraceEvents(owned.canonical, subject.runId)
      assert(traces.some(item => item.payload_ref === `merge-result:${applied.id}:applied` && item.agent_registration?.registration_id))
      const journal = (await repo.get(applied.id))!
      variants.push({ kind: git ? 'dirty-git' : 'non-git', result_id: applied.id, plan_digest: subject.planDigest,
        apply_status: applied.filesystem_apply.status, rollback_status: rolled.filesystem_apply.status,
        validation_process_count: processes.length, helper_operation_count: journal.operations.length,
        journal_sha256: createHash('sha256').update(JSON.stringify(journal)).digest('hex'),
        provider: prepared.provider.name, user_edit_preserved: true, frozen_identity_trace: true })
    } finally { await owned.cleanup() }
  }
  const result = { schema_version: 1, status: native ? 'bounded-native-passed' : 'fixture-contract-passed',
    platform_acceptance: native ? 'bounded-regular-files-only' : 'not-run', full_m2_acceptance: false,
    limitations: ['owned fixtures only', ...(fixture ? ['does not prove Windows handles, reparse races, or pending NT I/O'] : []),
      'directory/rename/chmod composition and full M2 operator UI are separate gates'], variants }
  await writeFile(join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ ...result, evidence_root: evidenceRoot }))
} catch (error) {
  await writeFile(join(evidenceRoot, 'result.json'), `${JSON.stringify({ schema_version: 1, status: 'failed', variants,
    error: error instanceof Error ? error.message : 'M2_PROOF_FAILED' }, null, 2)}\n`)
  throw error
}
