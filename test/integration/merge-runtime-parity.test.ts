import { afterEach, expect, test } from 'bun:test'
import { readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture, type Pr11Fixture } from './pr11-workspace-test-helper'
import { getThreadOSRuntimeService } from '@/lib/runtime/factory'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { MergeRuntimeOperations } from '@/lib/merge/runtime-operations'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { main } from '@/lib/seqctl/index'

let fixture: Pr11Fixture | null = null
afterEach(async () => {
  delete globalThis.__THREADOS_RUNTIME_SERVICE__
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
  await fixture?.cleanup()
  fixture = null
})

test('real process capture, evidence finalization, operator selection, API and CLI share one isolated merge preview', async () => {
  fixture = await createPr11Fixture(['merge'], undefined, true)
  const run = await fixture.run()
  const attempt = run.attempts[0]!
  expect(attempt.status).toBe('completed')
  expect(attempt.change_set_id).toBeTruthy()
  const service = await getThreadOSRuntimeService(fixture.canonical)
  globalThis.__THREADOS_RUNTIME_SERVICE__ = service as RuntimeServicePort
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service
  const review = await service.inspectChangeSetById(attempt.change_set_id!)
  expect(review.summary.validation.status).toBe('passed')
  expect(review.summary.output_contract_state).toBe('passed')
  const selected = await service.selectChangeSetById({ changeSetId: attempt.change_set_id!,
    expectedRevision: review.summary.revision }, { actor: 'operator', interface: 'api',
    idempotencyKey: 'merge-select', policyConfirmed: true })
  expect(selected.status).toBe('selected')
  const { POST: previewApi } = await import('@/app/api/merge-plans/route')
  const response = await previewApi(new Request('http://localhost/api/merge-plans', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'merge-preview-1' },
    body: JSON.stringify({ change_set_id: selected.id }),
  }))
  const body = await response.json()
  expect(body).not.toHaveProperty('error')
  expect(response.status).toBe(201)
  expect(body.plan.status).toBe('ready')
  expect(body.preview_manifest.entries.some((entry: { path: string }) => entry.path === 'agent-real.txt')).toBe(true)
  expect((await service.previewSelectedChangeSet(selected.id, { actor: 'operator', interface: 'api',
    idempotencyKey: 'merge-preview-1', policyConfirmed: true })).plan.id).toBe(body.plan.id)
  const { GET: inspectApi } = await import('@/app/api/merge-plans/[planId]/route')
  const inspected = await inspectApi(new Request(`http://localhost/api/merge-plans/${body.plan.id}`), {
    params: Promise.resolve({ planId: body.plan.id }),
  })
  expect((await inspected.json()).plan.id).toBe(body.plan.id)
  const lines: string[] = []
  const originalLog = console.log
  console.log = line => { lines.push(String(line)) }
  try { await main(['merge', 'inspect', body.plan.id, '--json']) }
  finally { console.log = originalLog }
  expect(process.exitCode).toBe(0)
  expect(lines[0]).toContain(body.plan.id)
  expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
  await expect(service.validateMergePlan(body.plan.id, { actor: 'operator', interface: 'api',
    idempotencyKey: 'merge-validate-1', policyConfirmed: true }))
    .rejects.toMatchObject({ code: 'MERGE_APPLY_CAPABILITY_UNAVAILABLE' })
  const { POST: validateApi } = await import('@/app/api/merge-plans/[planId]/validate/route')
  const unavailable = await validateApi(new Request(`http://localhost/api/merge-plans/${body.plan.id}/validate`, {
    method: 'POST', headers: { 'idempotency-key': 'merge-validate-api' },
  }), { params: Promise.resolve({ planId: body.plan.id }) })
  expect(unavailable.status).toBe(503)
  expect((await unavailable.json()).code).toBe('MERGE_APPLY_CAPABILITY_UNAVAILABLE')
  expect((await service.inspectMergePlan(body.plan.id))?.status).toBe('ready')
  const workspaceConfigPath = join(fixture.canonical, '.threados', 'workspace.yaml')
  const originalWorkspaceConfig = await readFile(workspaceConfigPath, 'utf8')
  const validationCommand = `${JSON.stringify(process.execPath)} -e ${JSON.stringify('process.exit(0)')}`
  const commandWorkspaceConfig = originalWorkspaceConfig
    .replace('validate: []', `validate:\n  - ${JSON.stringify(validationCommand)}`)
  await writeFile(workspaceConfigPath, commandWorkspaceConfig)
  await writeFile(join(fixture.canonical, '.threados', 'policy.yaml'), 'mode: POWER\nside_effect_mode: free\n')
  const testOnlyCapability = new MergeRuntimeOperations(fixture.canonical, (decision, canonical, preview) => {
    if (decision.conflicts.length || decision.canonical_precondition_hash !== canonical.root_manifest_hash
      || preview.root_manifest_hash === canonical.root_manifest_hash) throw new Error('MERGE_TEST_CAPABILITY_DENIED')
  })
  const validationContext = { actor: 'operator', interface: 'api' as const,
    idempotencyKey: 'merge-validate-test-port', policyConfirmed: true }
  const simultaneous = await Promise.all([
    testOnlyCapability.validate(body.plan.id, validationContext),
    testOnlyCapability.validate(body.plan.id, validationContext),
  ])
  expect(simultaneous.map(plan => plan.status)).toEqual(['validated', 'validated'])
  const validationProcesses = (await new ProcessRepository(fixture.canonical).list())
    .filter(item => item.process_purpose === 'validation')
  expect(validationProcesses).toMatchObject([{ status: 'exited', exit_code: 0,
    workspace_id: body.preview_id }])
  // Simulate a crash after the terminal validation receipt but before the plan transition.
  const planRecordPath = join(fixture.runtime, 'merge-plans', `${body.plan.id}.json`)
  const planEnvelope = JSON.parse(await readFile(planRecordPath, 'utf8'))
  await writeFile(planRecordPath, JSON.stringify({ ...planEnvelope, plan: { ...planEnvelope.plan,
    status: 'ready', revision: body.plan.revision, validated_at: null } }))
  expect((await testOnlyCapability.validate(body.plan.id, validationContext)).status).toBe('validated')
  expect((await new ProcessRepository(fixture.canonical).list())
    .filter(item => item.process_purpose === 'validation')).toHaveLength(1)
  await expect(testOnlyCapability.validate(body.plan.id, { ...validationContext,
    idempotencyKey: 'different-key' })).rejects.toThrow('MERGE_IDEMPOTENCY_CONFLICT')
  await writeFile(workspaceConfigPath, originalWorkspaceConfig)
  await expect(testOnlyCapability.validate(body.plan.id, validationContext))
    .rejects.toThrow('MERGE_VALIDATION_CONFIG_CHANGED')
  await writeFile(workspaceConfigPath, commandWorkspaceConfig)
  await writeFile(join(fixture.canonical, '.threados', 'policy.yaml'), 'mode: SAFE\nside_effect_mode: free\n')
  await expect(testOnlyCapability.validate(body.plan.id, validationContext))
    .rejects.toThrow('MERGE_VALIDATION_CONFIG_CHANGED')
  await writeFile(join(fixture.canonical, '.threados', 'policy.yaml'), 'mode: POWER\nside_effect_mode: free\n')
  const receiptPath = join(fixture.runtime, 'merge-validations', body.plan.id, 'validation-receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(receiptPath, JSON.stringify({ ...receipt, status: 'running', completed_at: null }))
  await expect(service.validateMergePlan(body.plan.id, validationContext))
    .rejects.toMatchObject({ code: 'MERGE_VALIDATION_RECOVERY_REQUIRED',
      message: expect.stringContaining('Create a new merge preview') })
  await writeFile(receiptPath, JSON.stringify(receipt))
  const previewRecordPath = join(fixture.runtime, 'merge-previews', `${body.preview_id}.json`)
  const previewRecord = JSON.parse(await readFile(previewRecordPath, 'utf8'))
  await writeFile(previewRecordPath, JSON.stringify({ ...previewRecord, root_path: fixture.canonical }))
  await expect(service.validateMergePlan(body.plan.id, { actor: 'operator', interface: 'api',
    idempotencyKey: 'merge-validate-path-tamper', policyConfirmed: true }))
    .rejects.toMatchObject({ code: 'MERGE_UNSAFE_PREVIEW_STORAGE' })
  expect((await new ProcessRepository(fixture.canonical).list())
    .filter(item => item.process_purpose === 'validation')).toHaveLength(1)
  await writeFile(previewRecordPath, JSON.stringify(previewRecord))
  await unlink(join(fixture.runtime, 'merge-validations', body.plan.id, 'decision.json'))
  await expect(service.previewSelectedChangeSet(selected.id, { actor: 'operator', interface: 'api',
    idempotencyKey: 'merge-preview-1', policyConfirmed: true }))
    .rejects.toMatchObject({ code: 'MERGE_VALIDATION_EVIDENCE_MISSING' })
}, 120_000)
