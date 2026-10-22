import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { link, mkdir, readFile, readdir, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'
import { MergeResultRepository, MergeTransactionRecordSchema, type MergeTransactionRecord } from './result-repository'

const created = '2026-10-22T12:00:00.000Z'
const completed = '2026-10-22T12:01:00.000Z'
const digest = `sha256:${'1'.repeat(64)}`
const changedDigest = `sha256:${'2'.repeat(64)}`
let root: string
let repository: MergeResultRepository

beforeEach(async () => {
  root = await createFixtureRoot('threados-merge-result-contract-')
  const canonical = join(root, 'project')
  await mkdir(canonical)
  repository = new MergeResultRepository(join(root, 'runtime'), canonical)
})
afterEach(async () => { await removeFixtureTree(root) })

function initial(): MergeTransactionRecord {
  return MergeTransactionRecordSchema.parse({
    schema_version: 1, revision: 0, plan_digest: digest, preview_id: 'preview-1',
    decision_hash: digest, canonical_root_hash: digest, canonical_precondition_hash: digest,
    preview_manifest_hash: digest, phase: 'prepared',
    entries: [{ path: 'a.txt', before: { kind: 'absent' },
      after: { kind: 'file', sha256: digest, size_bytes: 1, mode: 0o644, evidence_file: 'after.bin' },
      staged_file: 'stage.tmp', staged_identity: null }],
    result: { schema_version: 1, id: 'result-1', merge_plan_id: 'plan-1', workflow_run_id: 'run-1',
      filesystem_apply: { status: 'pending', rollback_ref: null, error_code: null, error_message: null },
      applied_change_set_ids: [],
      git_commit: { status: 'disabled', commit_sha: null, error_code: null, error_message: null },
      created_at: created, completed_at: null },
  })
}

function phase(record: MergeTransactionRecord, next: MergeTransactionRecord['phase']): MergeTransactionRecord {
  const pending = { status: 'pending' as const, rollback_ref: null, error_code: null, error_message: null }
  let outcome: MergeTransactionRecord['result']['filesystem_apply'] = pending
  if (next === 'applied') outcome = { status: 'applied', rollback_ref: record.result.id, error_code: null, error_message: null }
  if (next === 'rolled_back') outcome = { status: 'rolled_back', rollback_ref: record.result.id, error_code: null, error_message: null }
  if (next === 'rollback_failed') outcome = { status: 'rollback_failed', rollback_ref: record.result.id, error_code: 'MERGE_TEST_FAILURE', error_message: null }
  return { ...record, phase: next, result: { ...record.result, filesystem_apply: outcome,
    completed_at: outcome.status === 'pending' ? null : completed } }
}

describe('merge result journal identity and transitions', () => {
  test('refuses a relative runtime root before creating metadata', async () => {
    const invalid = new MergeResultRepository('relative-runtime', join(root, 'project'))
    await expect(invalid.root()).rejects.toThrow('MERGE_UNSAFE_STORAGE')
    expect(await readdir(root)).toEqual(['project'])
  })

  test('refuses runtime storage within or containing the canonical root', async () => {
    const canonical = join(root, 'project')
    for (const runtime of [join(canonical, 'runtime'), root]) {
      await expect(new MergeResultRepository(runtime, canonical).root())
        .rejects.toThrow('MERGE_UNSAFE_STORAGE')
    }
    expect(await readdir(root)).toEqual(['project'])
    expect(await readdir(canonical)).toEqual([])
  })

  test('refuses a runtime root that aliases another directory', async () => {
    const target = join(root, 'actual-runtime')
    const alias = join(root, 'alias-runtime')
    await mkdir(target)
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(new MergeResultRepository(alias, join(root, 'project')).root())
      .rejects.toThrow('MERGE_UNSAFE_STORAGE')
    expect(await readdir(target)).toEqual([])
  })

  test('rejects a record with another filesystem link', async () => {
    await repository.create(initial())
    const directory = await repository.root()
    await link(join(directory, 'result-1.json'), join(root, 'linked-result.json'))
    await expect(repository.get('result-1')).rejects.toThrow('MERGE_RESULT_CORRUPT')
  })

  test('reopens a prepared record from a fresh repository and preserves its binding', async () => {
    const record = initial()
    await repository.create(record)
    const canonical = join(root, 'project')
    const reopened = new MergeResultRepository(join(root, 'runtime'), canonical)
    expect(await reopened.get(record.result.id)).toEqual(record)
    expect(await reopened.get('absent')).toBeNull()
  })

  test('rejects a valid record stored under another result filename', async () => {
    await repository.create(initial())
    const directory = await repository.root()
    const bytes = await readFile(join(directory, 'result-1.json'))
    await writeFile(join(directory, 'result-2.json'), bytes)
    await expect(repository.get('result-2')).rejects.toThrow('MERGE_RESULT_CORRUPT')
    expect((await repository.get('result-1'))?.result.id).toBe('result-1')
  })

  const immutableChanges: [string, (record: MergeTransactionRecord) => MergeTransactionRecord][] = [
    ['canonical precondition', record => ({ ...record, canonical_precondition_hash: changedDigest })],
    ['preview manifest', record => ({ ...record, preview_manifest_hash: changedDigest })],
    ['workflow run', record => ({ ...record, result: { ...record.result, workflow_run_id: 'run-2' } })],
    ['creation time', record => ({ ...record, result: { ...record.result, created_at: completed } })],
    ['result ID', record => ({ ...record, result: { ...record.result, id: 'result-2' } })],
    ['plan ID', record => ({ ...record, result: { ...record.result, merge_plan_id: 'plan-2' } })],
    ['plan digest', record => ({ ...record, plan_digest: changedDigest })],
    ['preview ID', record => ({ ...record, preview_id: 'preview-2' })],
    ['decision digest', record => ({ ...record, decision_hash: changedDigest })],
    ['canonical root', record => ({ ...record, canonical_root_hash: changedDigest })],
  ]
  test.each(immutableChanges)('cannot change the %s binding', async (_label, mutate) => {
    const before = initial()
    await repository.create(before)
    await expect(repository.update(before.result.id, 0, mutate)).rejects.toThrow('MERGE_RESULT_IDENTITY_CHANGED')
    expect(await repository.get(before.result.id)).toEqual(before)
  })

  test('an in-place mutator cannot rewrite an immutable binding', async () => {
    const before = initial()
    await repository.create(before)
    await expect(repository.update('result-1', 0, record => {
      record.canonical_precondition_hash = changedDigest
      record.result.workflow_run_id = 'run-2'
      return record
    })).rejects.toThrow('MERGE_RESULT_IDENTITY_CHANGED')
    expect(await repository.get('result-1')).toEqual(before)
  })

  test('records stage identity once while prepared and freezes it before applying', async () => {
    await repository.create(initial())
    const staged = await repository.update('result-1', 0, record => ({ ...record,
      entries: record.entries.map(entry => ({ ...entry, staged_identity: { dev: '1', ino: '2' } })) }))
    expect(staged.revision).toBe(1)
    await expect(repository.update('result-1', 1, record => ({ ...record,
      entries: record.entries.map(entry => ({ ...entry, staged_identity: { dev: '1', ino: '3' } })) })))
      .rejects.toThrow('MERGE_RESULT_IDENTITY_CHANGED')
    const applying = await repository.update('result-1', 1, record => phase(record, 'applying'))
    const applied = await repository.update('result-1', applying.revision, record => phase(record, 'applied'))
    const rolledBack = await repository.update('result-1', applied.revision, record => phase(record, 'rolled_back'))
    expect(rolledBack.phase).toBe('rolled_back')
    expect(rolledBack.revision).toBe(4)
  })

  test('cannot first bind stage identity after the prepared phase', async () => {
    await repository.create(initial())
    await repository.update('result-1', 0, record => phase(record, 'applying'))
    await expect(repository.update('result-1', 1, record => ({ ...record,
      entries: record.entries.map(entry => ({ ...entry, staged_identity: { dev: '1', ino: '2' } })) })))
      .rejects.toThrow('MERGE_RESULT_IDENTITY_CHANGED')
  })

  test.each([
    ['prepared', 'applied'], ['applying', 'prepared'], ['applied', 'prepared'],
    ['rolled_back', 'applying'], ['rollback_failed', 'applying'],
  ] as const)('rejects phase transition %s -> %s', async (from, to) => {
    await repository.create(initial())
    let current = (await repository.get('result-1'))!
    if (from !== 'prepared') current = await repository.update('result-1', current.revision, record => phase(record, 'applying'))
    if (from !== 'prepared' && from !== 'applying') {
      current = await repository.update('result-1', current.revision, record => phase(record, from))
    }
    await expect(repository.update('result-1', current.revision, record => phase(record, to)))
      .rejects.toThrow('MERGE_INVALID_RESULT_TRANSITION')
    expect((await repository.get('result-1'))?.phase).toBe(from)
  })

  test('revision conflicts admit only one concurrent update across repository instances', async () => {
    await repository.create(initial())
    const second = new MergeResultRepository(join(root, 'runtime'), join(root, 'project'))
    const outcomes = await Promise.allSettled([repository, second].map(instance =>
      instance.update('result-1', 0, record => phase(record, 'applying'))))
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect((await repository.get('result-1'))?.revision).toBe(1)
  })
})
