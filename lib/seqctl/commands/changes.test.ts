import { afterEach, expect, test } from 'bun:test'
import { main } from '../index'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import type { RuntimeCommandContext } from '../../runtime/service-types'

function captureLog(): { lines: string[]; restore(): void } {
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => lines.push(line)
  return { lines, restore: () => { console.log = original } }
}

afterEach(() => { delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__; process.exitCode = 0 })

test('changes list, inspect and compare use runtime service JSON envelopes', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    listChangeSets: async (...args: unknown[]) => { calls.push({ method: 'list', args }); return [] },
    inspectChangeSet: async (...args: unknown[]) => { calls.push({ method: 'inspect', args }); return { schema_version: 1, entries: [] } as never },
    compareChangeSets: async (...args: unknown[]) => { calls.push({ method: 'compare', args }); return { schema_version: 1, paths: [] } as never },
  }
  const capture = captureLog()
  try {
    await main(['changes', 'list', 'run-1', '--json'])
    await main(['changes', 'inspect', 'run-1', 'attempt-1', '--json'])
    await main(['changes', 'compare', 'run-1', 'attempt-1', 'attempt-2', '--json'])
  } finally { capture.restore() }
  expect(calls).toEqual([
    { method: 'list', args: ['run-1'] },
    { method: 'inspect', args: ['run-1', 'attempt-1'] },
    { method: 'compare', args: ['run-1', 'attempt-1', 'attempt-2'] },
  ])
  for (const line of capture.lines) expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(line)).success).toBe(true)
})

test('changes select and reject pass revision, reason and CLI identity', async () => {
  const calls: Array<{ method: string; input: unknown; context: RuntimeCommandContext }> = []
  const summary = { id: 'change-set-attempt-1', status: 'selected', revision: 1 }
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    selectChangeSet: async (input, context) => { calls.push({ method: 'select', input, context }); return summary as never },
    rejectChangeSet: async (input, context) => { calls.push({ method: 'reject', input, context }); return { ...summary, status: 'rejected' } as never },
  }
  const capture = captureLog()
  try {
    await main(['changes', 'select', 'run-1', 'attempt-1', '0', '--idempotency-key', 'select-key', '--json'])
    await main(['changes', 'reject', 'run-1', 'attempt-1', '1', 'Not', 'chosen', '--idempotency-key', 'reject-key', '--json'])
  } finally { capture.restore() }
  expect(calls.map(call => call.method)).toEqual(['select', 'reject'])
  expect(calls[0]?.input).toEqual({ runId: 'run-1', attemptId: 'attempt-1', expectedRevision: 0 })
  expect(calls[0]?.context).toMatchObject({ interface: 'cli', idempotencyKey: 'select-key' })
  expect(calls[1]?.input).toEqual({ runId: 'run-1', attemptId: 'attempt-1', expectedRevision: 1, reason: 'Not chosen' })
  expect(capture.lines.map(line => RuntimeJsonEnvelopeSchema.parse(JSON.parse(line)).success)).toEqual([true, true])
})

test('PRD ID commands list, show, diff, select and reject use one service', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const review = { schema_version: 1, summary: { id: 'change-set-attempt-1' }, entries: [] } as never
  const summary = { id: 'change-set-attempt-1', status: 'selected', revision: 1 }
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    listChangeSets: async (...args: unknown[]) => { calls.push({ method: 'list', args }); return [] },
    inspectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'show', args }); return review },
    selectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'select', args }); return summary as never },
    rejectChangeSetById: async (...args: unknown[]) => { calls.push({ method: 'reject', args }); return { ...summary, status: 'rejected' } as never },
  }
  const capture = captureLog()
  try {
    await main(['changes', 'list', '--run', 'run-1', '--json'])
    await main(['changes', 'show', 'change-set-attempt-1', '--json'])
    await main(['changes', 'diff', 'change-set-attempt-1', '--json'])
    await main(['changes', 'select', 'change-set-attempt-1', '--idempotency-key', 'choose', '--json'])
    await main(['changes', 'select', 'change-set-attempt-1', '--expected-revision', '0', '--json'])
    await main(['changes', 'reject', 'change-set-attempt-1', 'Not', 'chosen',
      '--idempotency-key', 'reject', '--json'])
    await main(['changes', 'reject', 'change-set-attempt-1', '--expected-revision', '1',
      'No', 'longer', 'wanted', '--json'])
  } finally { capture.restore() }
  expect(calls.map(call => call.method)).toEqual(['list', 'show', 'show', 'select', 'select', 'reject', 'reject'])
  expect(calls[0]?.args).toEqual(['run-1'])
  expect(calls[1]?.args).toEqual(['change-set-attempt-1'])
  expect(calls[3]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1' })
  expect(calls[4]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1', expectedRevision: 0 })
  expect((calls[4]?.args[1] as RuntimeCommandContext).idempotencyKey)
    .toBe('changes-select-change-set-attempt-1')
  expect(calls[5]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1', reason: 'Not chosen' })
  expect(calls[6]?.args[0]).toEqual({ changeSetId: 'change-set-attempt-1', expectedRevision: 1,
    reason: 'No longer wanted' })
  expect((calls[6]?.args[1] as RuntimeCommandContext).idempotencyKey)
    .toBe('changes-reject-change-set-attempt-1')
  expect(capture.lines.map(line => RuntimeJsonEnvelopeSchema.parse(JSON.parse(line)).success))
    .toEqual([true, true, true, true, true, true, true])
})

test('invalid revision exits with validation code before service mutation', async () => {
  let mutations = 0
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    selectChangeSet: async () => { mutations += 1; return {} as never },
  }
  const capture = captureLog()
  try { await main(['changes', 'select', 'run-1', 'attempt-1', '-1', '--json']) }
  finally { capture.restore() }
  expect(mutations).toBe(0)
  expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]!))).toMatchObject({
    success: false, error: { code: 'VALIDATION_ERROR' },
  })
  expect(process.exitCode).toBe(2)
})

test('human diff output neutralizes agent control characters', async () => {
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    inspectChangeSet: async () => ({
      summary: { id: 'change-set-attempt-1', status: 'captured', revision: 0,
        workflow_run_id: 'run-1', attempt_id: 'attempt-1', entry_count: 1, total_bytes: 4,
        path_scope_violations: [], baseline_snapshot_id: 'snapshot-1',
        validation: { status: 'pending', evidence_refs: [] }, output_contract_state: 'passed' },
      entries: [{ operation: 'modify', path: 'safe.txt', content_kind: 'text',
        unified_diff: '--- a/safe.txt\n+\u001b[31mdanger', preview_truncated: false }],
      file_tree_truncated: false, test_evidence_refs: [],
    }) as never,
  }
  const capture = captureLog()
  try { await main(['changes', 'inspect', 'run-1', 'attempt-1']) }
  finally { capture.restore() }
  expect(capture.lines.join('\n')).not.toContain('\u001b')
  expect(capture.lines.join('\n')).toContain('danger')
})
