import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createPr11Fixture, type Pr11Fixture } from '../integration/pr11-workspace-test-helper'
import { ownedFixtureMergeProvider } from './merge-fixture-provider'
import { getThreadOSRuntimeService } from '../../lib/runtime/factory'
import { appendApproval, resolvePendingApproval } from '../../lib/approvals/repository'
import type { ExactMergeApprovalSubject } from '../../lib/merge/approval'
import type { MergeMutationProvider } from '../../lib/merge/mutation-provider'

export const context = (key: string = randomUUID()) => ({ actor: 'operator@example.test', interface: 'api' as const, idempotencyKey: key, policyConfirmed: true })

export async function approve(fixture: Pr11Fixture, subject: ExactMergeApprovalSubject, id = `approval-${randomUUID()}`, actor = 'operator@example.test') {
  const pending = { id, run_id: subject.runId, requested_at: new Date().toISOString(),
    action_type: 'side_effect' as const, target_ref: subject.targetRef, status: 'pending' as const,
    requested_by: actor, approved_by: null, approved_at: null, notes: null,
    subject_digest: subject.planDigest, payload_ref: subject.targetRef, policy_ref: subject.policySnapshotHash,
    precondition_hash: subject.canonicalPreconditionHash, expires_at: new Date(Date.now() + 600_000).toISOString(),
    consumed_at: null, consumed_by: null }
  await appendApproval(fixture.canonical, subject.runId, pending)
  await resolvePendingApproval(fixture.canonical, subject.runId, id, value => ({ ...value,
    status: 'approved', approved_by: actor, approved_at: new Date().toISOString() }))
  return { approval_id: id, plan_digest: subject.planDigest }
}
export async function prepare(options: { git?: boolean; fault?: Parameters<typeof ownedFixtureMergeProvider>[1]; postFail?: boolean; commandCount?: number; provider?: (root: string) => MergeMutationProvider } = {}) {
  let provider!: MergeMutationProvider
  const fixture = await createPr11Fixture(['writer'], undefined, true, canonical => ({
    mergeMutationProvider: provider = options.provider?.(canonical) ?? ownedFixtureMergeProvider(canonical, options.fault),
    dispatch: async (_model, config) => ({ ...config, stepId: config.stepId, runId: config.runId!,
      command: process.execPath, args: ['-e', ["const fs=require('fs')",
        "fs.writeFileSync('agent-real.txt','real-process\\n')", "fs.writeFileSync('source.txt','agent-update\\n')",
        "fs.unlinkSync('obsolete.txt')"].join(';')], cwd: config.cwd }),
  }))
  if (options.git) { execFileSync('git', ['init', '--quiet'], { cwd: fixture.canonical }); await writeFile(join(fixture.canonical, 'dirty-user.txt'), 'preserved dirty user file\n') }
  await writeFile(join(fixture.canonical, 'obsolete.txt'), 'restore this file\n')
  const configPath = join(fixture.canonical, '.threados', 'workspace.yaml')
  const script = options.postFail
    ? "process.exit(require('fs').existsSync('.threados') ? 7 : 0)" : 'process.exit(0)'
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`
  await writeFile(configPath, (await readFile(configPath, 'utf8')).replace('validate: []', `validate:\n  - ${Array.from({ length: options.commandCount ?? 2 }, () => JSON.stringify(command)).join('\n  - ')}`))
  await writeFile(join(fixture.canonical, '.threados', 'policy.yaml'), 'mode: POWER\nside_effect_mode: free\n')
  const completed = await fixture.run()
  assert.equal(completed.run.status, 'successful')
  await writeFile(join(fixture.canonical, 'user-after-launch.txt'), 'user change after launch\n')
  const service = await getThreadOSRuntimeService(fixture.canonical)
  const changes = await service.listChangeSets(completed.run.id)
  assert.equal(changes.length, 1)
  assert.equal(changes[0]!.validation.status, 'passed')
  const review = await service.inspectChangeSetById(changes[0]!.id)
  const selected = await service.selectChangeSetById({ changeSetId: review.summary.id, expectedRevision: review.summary.revision }, context('select'))
  const preview = await service.previewSelectedChangeSet(selected.id, context('preview'))
  await service.validateMergePlan(preview.plan.id, context('validate'))
  const subject = await service.inspectMergeApprovalSubject(preview.plan.id, context('subject'))
  return { fixture, service, provider, completed, preview, subject }
}
