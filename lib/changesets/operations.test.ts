import { afterEach, expect, test } from 'bun:test'
import { readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture, type Pr11Fixture } from '../../test/integration/pr11-workspace-test-helper'
import { readTraceEvents } from '../traces/reader'
import { appendTraceEvent } from '../traces/writer'
import { ChangeSetOperations } from './operations'
import { readThreadSurfaceState, writeThreadSurfaceState } from '../thread-surfaces/repository'
import type { ThreadSurface } from '../thread-surfaces/types'

let fixture: Pr11Fixture | null = null
afterEach(async () => { await fixture?.cleanup(); fixture = null })

async function persistSharedSurface(basePath: string, surfaceId: string): Promise<void> {
  const state = await readThreadSurfaceState(basePath)
  const shared: ThreadSurface = {
    id: surfaceId, parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
    surfaceLabel: 'Shared', createdAt: new Date().toISOString(), childSurfaceIds: [],
    sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'shared',
    visibility: 'dependency', isolationLabel: 'THREADOS_SCOPED', revealState: null,
    allowedReadScopes: [], allowedWriteScopes: [],
  }
  await writeThreadSurfaceState(basePath, {
    ...state, threadSurfaces: [...state.threadSurfaces.filter(surface => surface.id !== surfaceId), shared],
  })
}

test('review and compare verified candidates without exposing private storage paths', async () => {
  fixture = await createPr11Fixture(['alpha', 'beta'])
  const outcome = await fixture.run()
  for (const attempt of outcome.attempts) await persistSharedSurface(fixture.canonical, attempt.surface_id)
  const operations = new ChangeSetOperations(fixture.canonical)
  const listed = await operations.list(outcome.run.id)
  expect(listed).toHaveLength(2)
  expect(listed[0]).toMatchObject({ revision: 1, status: 'validated',
    validation: { status: 'passed' }, output_contract_state: 'passed', approval_state: 'not_required' })
  const review = await operations.inspect(outcome.run.id, outcome.attempts[0]!.id)
  expect((await operations.inspectById(review.summary.id)).summary.id).toBe(review.summary.id)
  expect(review.entries.find(entry => entry.path === 'agent-alpha.txt')).toMatchObject({
    operation: 'add', after_text: 'alpha\n',
  })
  expect(JSON.stringify(review)).not.toContain(fixture.runtime)
  expect(JSON.stringify(review)).not.toContain(fixture.canonical)
  const comparison = await operations.compare(outcome.run.id, outcome.attempts[0]!.id, outcome.attempts[1]!.id)
  expect(comparison.paths).toEqual([
    { path: 'agent-alpha.txt', relation: 'left_only' },
    { path: 'agent-beta.txt', relation: 'right_only' },
  ])
}, 60_000)

test('selection and rejection enforce expected revisions and append decision traces', async () => {
  fixture = await createPr11Fixture(['choice'])
  const outcome = await fixture.run()
  await persistSharedSurface(fixture.canonical, outcome.attempts[0]!.surface_id)
  const operations = new ChangeSetOperations(fixture.canonical)
  const attemptId = outcome.attempts[0]!.id
  const initialRevision = (await operations.list(outcome.run.id))[0]!.revision
  const context = { actor: 'operator', interface: 'cli' as const,
    idempotencyKey: 'choice-1', policyConfirmed: false }
  await expect(operations.decide({ action: 'select', runId: outcome.run.id,
    attemptId, expectedRevision: initialRevision }, { ...context, interface: 'mcp' }))
    .rejects.toMatchObject({ code: 'POLICY_DENIED' })
  const selected = await operations.decide({ action: 'select', runId: outcome.run.id,
    attemptId, expectedRevision: initialRevision }, context)
  expect(selected).toMatchObject({ revision: initialRevision + 1, status: 'selected', decision: { action: 'select' } })
  expect(await operations.decideById({ action: 'select', changeSetId: outcome.attempts[0]!.change_set_id! }, context))
    .toEqual(selected)
  await expect(operations.decideById({ action: 'reject', changeSetId: outcome.attempts[0]!.change_set_id!,
    reason: 'Changed decision' }, context)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  expect(await operations.decide({ action: 'select', runId: outcome.run.id,
    attemptId, expectedRevision: initialRevision }, context)).toEqual(selected)
  await expect(operations.decide({ action: 'reject', runId: outcome.run.id,
    attemptId, expectedRevision: initialRevision, reason: 'Not chosen' },
  { ...context, idempotencyKey: 'choice-2' })).rejects.toMatchObject({ code: 'CHANGE_SET_REVISION_CONFLICT' })
  const rejected = await operations.decide({ action: 'reject', runId: outcome.run.id,
    attemptId, expectedRevision: initialRevision + 1, reason: 'Not chosen' },
  { ...context, idempotencyKey: 'choice-3' })
  expect(rejected).toMatchObject({ revision: initialRevision + 2, status: 'rejected', decision: { reason: 'Not chosen' } })
  const events = await readTraceEvents(fixture.canonical, outcome.run.id)
  expect(events.filter(event => event.event_type.startsWith('change-set-')).map(event => event.event_type))
    .toEqual(['change-set-selected', 'change-set-rejected'])
}, 60_000)

test('same-key replay repairs a decision trace that failed before append', async () => {
  fixture = await createPr11Fixture(['repair'])
  const outcome = await fixture.run()
  await persistSharedSurface(fixture.canonical, outcome.attempts[0]!.surface_id)
  let fail = true
  const operations = new ChangeSetOperations(fixture.canonical, {
    appendTrace: async (...args) => {
      if (fail) { fail = false; throw new Error('injected trace failure') }
      await appendTraceEvent(...args)
    },
  })
  const input = { action: 'select' as const, changeSetId: outcome.attempts[0]!.change_set_id! }
  const context = { actor: 'operator', interface: 'cli' as const,
    idempotencyKey: 'repair-key', policyConfirmed: false }
  await expect(operations.decideById(input, context)).rejects.toMatchObject({ code: 'CHANGE_SET_TRACE_PERSIST_FAILED' })
  expect((await operations.list(outcome.run.id))[0]).toMatchObject({ revision: 2, status: 'selected' })
  expect((await readTraceEvents(fixture.canonical, outcome.run.id))
    .filter(event => event.event_type === 'change-set-selected')).toHaveLength(0)
  const replayed = await Promise.all([operations.decideById(input, context), operations.decideById(input, context)])
  expect(replayed).toEqual([expect.objectContaining({ revision: 2, status: 'selected' }),
    expect.objectContaining({ revision: 2, status: 'selected' })])
  expect(await operations.decideById(input, context)).toMatchObject({ revision: 2, status: 'selected' })
  const repaired = (await readTraceEvents(fixture.canonical, outcome.run.id))
    .filter(event => event.event_type === 'change-set-selected')
  expect(repaired).toHaveLength(1)
  expect(repaired[0]?.payload_ref).toContain('-r2.json')
  const receipt = JSON.parse(await readFile(join(fixture.canonical, repaired[0]!.payload_ref!), 'utf8'))
  expect(receipt).toMatchObject({ schema_version: 1, revision: 2,
    decision: { action: 'select', idempotency_key: 'repair-key' } })
}, 60_000)

test('same-key replay does not duplicate a trace after append succeeded but response failed', async () => {
  fixture = await createPr11Fixture(['after-write'])
  const outcome = await fixture.run()
  await persistSharedSurface(fixture.canonical, outcome.attempts[0]!.surface_id)
  const attemptId = outcome.attempts[0]!.id
  let fail = true
  const operations = new ChangeSetOperations(fixture.canonical, {
    appendTrace: async (...args) => {
      await appendTraceEvent(...args)
      if (fail) { fail = false; throw new Error('injected post-append failure') }
    },
  })
  const input = { action: 'select' as const, runId: outcome.run.id, attemptId, expectedRevision: 1 }
  const context = { actor: 'operator', interface: 'cli' as const,
    idempotencyKey: 'post-append-key', policyConfirmed: false }
  await expect(operations.decide(input, context)).rejects.toMatchObject({ code: 'CHANGE_SET_TRACE_PERSIST_FAILED' })
  expect(await operations.decide(input, context)).toMatchObject({ revision: 2, status: 'selected' })
  expect((await readTraceEvents(fixture.canonical, outcome.run.id))
    .filter(event => event.event_type === 'change-set-selected')).toHaveLength(1)
}, 60_000)

test('configured contracts and unrun validation commands remain non-passing', async () => {
  fixture = await createPr11Fixture(['contract'])
  fixture.sequence.steps[0]!.output_contract_ref = 'contracts/output.json'
  const contractOutcome = await fixture.run()
  await persistSharedSurface(fixture.canonical, contractOutcome.attempts[0]!.surface_id)
  const contract = (await new ChangeSetOperations(fixture.canonical).list(contractOutcome.run.id))[0]!
  expect(contract).toMatchObject({ status: 'captured', validation: { status: 'failed' },
    output_contract_state: 'failed', approval_state: 'not_required' })
}, 60_000)

test('configured validation without persisted command results cannot pass', async () => {
  fixture = await createPr11Fixture(['validate'], undefined, false, () => ({ validateAttemptWorkspace: async () => undefined }))
  const configPath = join(fixture.canonical, '.threados', 'workspace.yaml')
  await writeFile(configPath, (await readFile(configPath, 'utf8'))
    .replace('validate: []', 'validate: ["bun test"]'))
  const outcome = await fixture.run()
  await persistSharedSurface(fixture.canonical, outcome.attempts[0]!.surface_id)
  const record = (await new ChangeSetOperations(fixture.canonical).list(outcome.run.id))[0]!
  expect(record).toMatchObject({ status: 'captured', validation: { status: 'pending', required_commands: 1 },
    output_contract_state: 'passed', approval_state: 'not_required' })
}, 60_000)

test('changing validation commands after run preparation fails capture closed', async () => {
  fixture = await createPr11Fixture(['policy-drift'], async canonical => {
    const configPath = join(canonical, '.threados', 'workspace.yaml')
    await writeFile(configPath, (await readFile(configPath, 'utf8'))
      .replace('validate: []', 'validate: ["node verify.cjs"]'))
  })
  const outcome = await fixture.run()
  expect(outcome.attempts[0]).toMatchObject({ status: 'failed', change_set_id: null })
  expect(outcome.attempts[0]?.error_message).toContain('CHANGE_SET_VALIDATION_POLICY_CHANGED')
}, 60_000)

test('missing canonical surface state cannot authorize semantic review', async () => {
  fixture = await createPr11Fixture(['unknown-surface'])
  const outcome = await fixture.run()
  const attempt = outcome.attempts[0]!
  await rm(join(fixture.canonical, '.threados', 'surfaces', attempt.surface_id), { recursive: true, force: true })
  const operations = new ChangeSetOperations(fixture.canonical)
  expect(await operations.list(outcome.run.id)).toEqual([])
  await expect(operations.inspectById(attempt.change_set_id!))
    .rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  await expect(operations.compare(outcome.run.id, attempt.id, attempt.id))
    .rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  await persistSharedSurface(fixture.canonical, attempt.surface_id)
  expect((await operations.list(outcome.run.id))[0]?.id).toBe(attempt.change_set_id!)
  expect((await operations.inspectById(attempt.change_set_id!)).entries.some(
    entry => entry.path === 'agent-unknown-surface.txt')).toBe(true)
}, 60_000)

test('selection cannot race an unfinalized terminal Change Set', async () => {
  fixture = await createPr11Fixture(['finalize-race'])
  const outcome = await fixture.run()
  const attempt = outcome.attempts[0]!
  await persistSharedSurface(fixture.canonical, attempt.surface_id)
  const path = join(fixture.canonical, '.threados', 'changesets', `${attempt.change_set_id}.json`)
  const finalized = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({
    ...finalized, revision: 0, status: 'captured', decision: null,
    validation: { status: 'pending', evidence_refs: [], required_commands: 0 },
    output_contract_state: 'pending', approval_state: 'pending',
  }))
  const operations = new ChangeSetOperations(fixture.canonical)
  const context = { actor: 'operator', interface: 'cli' as const,
    idempotencyKey: 'race-select', policyConfirmed: false }
  await expect(operations.decideById({ action: 'select', changeSetId: attempt.change_set_id!,
    expectedRevision: 0 }, context)).rejects.toMatchObject({ code: 'CHANGE_SET_NOT_READY' })
  expect((await operations.inspectById(attempt.change_set_id!)).summary.revision).toBe(0)
  expect(await operations.finalizeEvidence(outcome.run.id, attempt.id))
    .toMatchObject({ revision: 1, status: 'validated', validation: { status: 'passed' } })
  expect(await operations.decideById({ action: 'select', changeSetId: attempt.change_set_id!,
    expectedRevision: 1 }, context)).toMatchObject({ revision: 2, status: 'selected' })
}, 60_000)

test('sealed Change Sets hide semantic list, review and comparison until reveal', async () => {
  fixture = await createPr11Fixture(['secret'])
  const outcome = await fixture.run()
  const attempt = outcome.attempts[0]!
  const state = await readThreadSurfaceState(fixture.canonical)
  const sealed: ThreadSurface = {
    id: attempt.surface_id, parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
    surfaceLabel: 'Secret', createdAt: new Date().toISOString(), childSurfaceIds: [],
    sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'sealed',
    visibility: 'self_only', isolationLabel: 'THREADOS_SCOPED', revealState: 'sealed',
    allowedReadScopes: [], allowedWriteScopes: [],
  }
  await writeThreadSurfaceState(fixture.canonical, {
    ...state, threadSurfaces: [...state.threadSurfaces.filter(surface => surface.id !== sealed.id), sealed],
  })
  const operations = new ChangeSetOperations(fixture.canonical)
  expect(await operations.list(outcome.run.id)).toEqual([])
  await expect(operations.inspectById(attempt.change_set_id!)).rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  await expect(operations.compare(outcome.run.id, attempt.id, attempt.id))
    .rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  await expect(operations.decideById({ action: 'select', changeSetId: attempt.change_set_id! }, {
    actor: 'operator', interface: 'cli', idempotencyKey: 'sealed-select', policyConfirmed: false,
  })).rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  const revealed = await readThreadSurfaceState(fixture.canonical)
  await writeThreadSurfaceState(fixture.canonical, {
    ...revealed, threadSurfaces: revealed.threadSurfaces.map(surface => surface.id === sealed.id
      ? { ...surface, revealState: 'revealed' as const } : surface),
  })
  expect((await operations.list(outcome.run.id))[0]?.id).toBe(attempt.change_set_id!)
  expect((await operations.inspectById(attempt.change_set_id!)).entries.some(entry => entry.path === 'agent-secret.txt'))
    .toBe(true)
}, 60_000)
