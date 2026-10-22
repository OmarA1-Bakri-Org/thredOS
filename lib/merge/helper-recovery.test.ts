import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'
import { classifyWindowsHelperRecovery, readWindowsHelperJournal } from './helper-recovery'
import { WindowsHelperJournalSchema, type WindowsHelperJournal } from './windows-helper-types'

let root: string
let path: string
const digest = `sha256:${'a'.repeat(64)}`

beforeEach(async () => {
  root = await createFixtureRoot('threados-helper-recovery-')
  path = join(root, 'operation-one.json')
})
afterEach(async () => { await removeFixtureTree(root) })

async function journal(overrides: Partial<WindowsHelperJournal> = {}): Promise<WindowsHelperJournal> {
  const value = WindowsHelperJournalSchema.parse({ schema_version: 1, operation_id: 'operation-one',
    request_hash: digest, plan_id: 'plan-one', plan_hash: digest, preview_hash: digest,
    approval_hash: digest, root_hash: digest, phase: 'prepared', pid: process.pid,
    exit_code: null, result: null, error_code: null, source_identity_after: null,
    destination_identity_after: null, updated_at: '2026-10-22T15:00:00.000Z', ...overrides })
  await writeFile(path, JSON.stringify(value))
  return value
}

test('default probe observes a live PID without authorizing recovery', async () => {
  const stored = await journal()
  const result = await classifyWindowsHelperRecovery(path)
  expect(result).toEqual({ status: 'requires-review', journalClaim: 'mutation-uncertain',
    processEvidence: 'pid-live-unverified', journal: stored })
  expect(await readWindowsHelperJournal(path)).toEqual(stored)
})

test('default probe observes the absence of an owned child after its exit', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { shell: false, stdio: 'ignore' })
  const pid = child.pid
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Fixture child exit: ${code}`)))
  })
  expect(pid).toBeGreaterThan(0)
  await journal({ pid })
  const result = await classifyWindowsHelperRecovery(path)
  expect(result.processEvidence).toBe('pid-absent')
  expect(result.status).toBe('requires-review')
})

test.each(['launch', 'prepared'] as const)('missing PID in %s leaves mutation uncertain', async phase => {
  await journal({ phase, pid: null })
  let probes = 0
  const result = await classifyWindowsHelperRecovery(path, () => { probes += 1 })
  expect(probes).toBe(0)
  expect(result.processEvidence).toBe('pid-not-recorded')
  expect(result.journalClaim).toBe('mutation-uncertain')
  expect(result.status).toBe('requires-review')
})

test.each(['EPERM', 'EACCES', 'EIO', 'ERR_OUT_OF_RANGE'])('%s cannot establish PID absence', async code => {
  await journal()
  const result = await classifyWindowsHelperRecovery(path, () => {
    throw Object.assign(new Error('Probe did not establish absence'), { code })
  })
  expect(result.processEvidence).toBe('pid-probe-inconclusive')
  expect(result.journalClaim).toBe('mutation-uncertain')
  expect(result.status).toBe('requires-review')
})

const unknownFailures: [string, unknown][] = [
  ['ordinary error', new Error('unknown probe failure')], ['string', 'untyped failure'],
  ['null', null], ['untyped errno object', { code: 'ESRCH' }],
]
test.each(unknownFailures)(
  'an unclassified probe failure remains inconclusive: %s', async (_label, failure) => {
    await journal()
    const result = await classifyWindowsHelperRecovery(path, () => { throw failure })
    expect(result.processEvidence).toBe('pid-probe-inconclusive')
    expect(result.journalClaim).toBe('mutation-uncertain')
    expect(result.status).toBe('requires-review')
  })

test.each(['launch', 'prepared', 'started', 'indeterminate'] as const)(
  'ESRCH in %s records absence without granting recovery authority', async phase => {
    await journal({ phase })
    const result = await classifyWindowsHelperRecovery(path, () => {
      throw Object.assign(new Error('Process absent'), { code: 'ESRCH' })
    })
    expect(result.processEvidence).toBe('pid-absent')
    expect(result.journalClaim).toBe(phase === 'launch' || phase === 'prepared'
      ? 'failed-before-start' : 'mutation-uncertain')
    expect(result.status).toBe('requires-review')
  })

test('a forged terminal success and inconclusive PID remain claims requiring review', async () => {
  await journal({ phase: 'terminal', result: 'succeeded', exit_code: 0 })
  const result = await classifyWindowsHelperRecovery(path, () => {
    throw Object.assign(new Error('Access denied'), { code: 'EPERM' })
  })
  expect(result.processEvidence).toBe('pid-probe-inconclusive')
  expect(result.journalClaim).toBe('succeeded')
  expect(result.status).toBe('requires-review')
})

test('terminal failure with mutation evidence cannot imply failure before start', async () => {
  await journal({ phase: 'terminal', result: 'failed', exit_code: 71,
    error_code: 'MERGE_POSTCHECK_FAILED', source_identity_after: 'source-after',
    destination_identity_after: 'destination-after' })
  const result = await classifyWindowsHelperRecovery(path, () => {
    throw Object.assign(new Error('Process absent'), { code: 'ESRCH' })
  })
  expect(result.processEvidence).toBe('pid-absent')
  expect(result.journalClaim).toBe('mutation-uncertain')
  expect(result.journal.result).toBe('failed')
  expect(result.status).toBe('requires-review')
})

test('invalid journal is rejected before the PID probe', async () => {
  await writeFile(path, JSON.stringify({ pid: process.pid }))
  let probes = 0
  await expect(classifyWindowsHelperRecovery(path, () => { probes += 1 })).rejects.toThrow()
  expect(probes).toBe(0)
})
