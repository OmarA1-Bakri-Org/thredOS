import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProcessRecord, RuntimeCommandReceipt, StepAttempt, WorkflowRun } from './schema'
import { RunRepository } from './run-repository'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import { rebuildRuntimeIndex } from './runtime-index'
import { setAtomicBeforeRenameHookForTests } from '../fs/atomic'

const timestamp = '2026-07-16T00:00:00.000Z'

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    schema_version: 2,
    id: 'run-01',
    revision: 0,
    sequence_id: 'sequence-01',
    sequence_snapshot_hash: 'sha256:sequence',
    target: { kind: 'step', step_id: 'step-01' },
    strategy: 'sequential',
    status: 'pending',
    max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy',
    baseline_snapshot_id: null,
    attempt_ids: [],
    created_by: 'operator',
    created_via: 'cli',
    created_at: timestamp,
    started_at: null,
    ended_at: null,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
    ...overrides,
  }
}

function attempt(id: string, attemptNumber: number): StepAttempt {
  return {
    schema_version: 2,
    id,
    revision: 0,
    workflow_run_id: 'run-01',
    sequence_id: 'sequence-01',
    step_id: `step-${attemptNumber}`,
    surface_id: `surface-${attemptNumber}`,
    execution_index: attemptNumber,
    attempt_number: attemptNumber,
    retry_of_attempt_id: null,
    status: 'pending',
    agent_ref: null,
    model: 'codex',
    side_effect_class: 'write',
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: null,
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null,
    output_manifest_ref: null,
    artifact_manifest_ref: null,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: timestamp,
    started_at: null,
    ended_at: null,
    last_heartbeat_at: null,
    exit_code: null,
    signal: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
  }
}

function receipt(overrides: Partial<RuntimeCommandReceipt> = {}): RuntimeCommandReceipt {
  return {
    schema_version: 1,
    id: 'command-01',
    idempotency_key: 'unsafe/key:must-not-be-a-filename',
    command_type: 'start-run',
    request_hash: 'sha256:request-a',
    status: 'completed',
    result_ref: 'run:run-01',
    error_code: null,
    error_message: null,
    created_at: timestamp,
    completed_at: timestamp,
    ...overrides,
  }
}

function processRecord(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    schema_version: 1,
    id: 'process-01',
    revision: 0,
    workflow_run_id: 'run-01',
    attempt_id: 'attempt-01',
    provider: 'local-process',
    provider_handle: null,
    pid: null,
    command: 'codex',
    redacted_args: ['exec'],
    cwd: 'C:\\surface',
    status: 'planned',
    launch_requested_at: timestamp,
    started_at: null,
    ended_at: null,
    last_output_at: null,
    cancellation_requested_at: null,
    exit_code: null,
    signal: null,
    ...overrides,
  }
}

describe('atomic runtime repositories', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-repositories-'))
  })

  afterEach(async () => {
    setAtomicBeforeRenameHookForTests(null)
    await rm(basePath, { recursive: true, force: true })
  })

  test('one run and two attempts survive fresh repository instances without overwrite', async () => {
    await new RunRepository(basePath).create(run())
    const attempts = new AttemptRepository(basePath)
    await attempts.create(attempt('attempt-01', 1))
    await attempts.create(attempt('attempt-02', 2))

    expect(await new RunRepository(basePath).get('run-01')).toEqual(run())
    expect((await new AttemptRepository(basePath).listForRun('run-01')).map(item => item.id)).toEqual([
      'attempt-01',
      'attempt-02',
    ])
  })

  test('duplicate create never overwrites the canonical record', async () => {
    const repository = new RunRepository(basePath)
    await repository.create(run())
    await expect(repository.create(run({ status: 'failed' }))).rejects.toMatchObject({
      code: 'RUNTIME_RECORD_EXISTS',
    })
    expect((await repository.get('run-01'))?.status).toBe('pending')
  })

  test('stale and truly concurrent updates fail closed with exactly one winner', async () => {
    const repository = new RunRepository(basePath)
    await repository.create(run())
    const results = await Promise.allSettled([
      new RunRepository(basePath).update('run-01', 0, current => ({ ...current, status: 'running' })),
      new RunRepository(basePath).update('run-01', 0, current => ({ ...current, status: 'failed' })),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'RUNTIME_REVISION_CONFLICT' } })
    expect((await repository.get('run-01'))?.revision).toBe(1)
    await expect(repository.update('run-01', 0, current => current)).rejects.toMatchObject({
      code: 'RUNTIME_REVISION_CONFLICT',
    })
  })

  test('injected atomic replacement failure preserves prior bytes and cleans temporary files and locks', async () => {
    const repository = new RunRepository(basePath)
    await repository.create(run())
    const path = join(basePath, '.threados/runs/run-01/run.json')
    const before = await readFile(path, 'utf-8')
    setAtomicBeforeRenameHookForTests(async target => {
      if (target === path) throw new Error('injected rename failure')
    })

    await expect(repository.update('run-01', 0, current => ({ ...current, status: 'running' })))
      .rejects.toThrow('injected rename failure')
    expect(await readFile(path, 'utf-8')).toBe(before)
    expect((await readdir(join(basePath, '.threados/runs/run-01'))).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
  })

  test.each(['../escape', '/absolute', 'mixed\\separator', 'CON', 'bad.', 'bad '])(
    'rejects unsafe path-bearing id %s',
    async id => {
      await expect(new RunRepository(basePath).create(run({ id }))).rejects.toThrow('file-safe identifier')
    },
  )

  test('attempt records never alter the owning run record', async () => {
    const runs = new RunRepository(basePath)
    await runs.create(run())
    const before = await readFile(join(basePath, '.threados/runs/run-01/run.json'), 'utf-8')
    await new AttemptRepository(basePath).create(attempt('attempt-01', 1))
    expect(await readFile(join(basePath, '.threados/runs/run-01/run.json'), 'utf-8')).toBe(before)
  })

  test('process records live under their owning attempt and use revision CAS', async () => {
    await new RunRepository(basePath).create(run())
    await new AttemptRepository(basePath).create(attempt('attempt-01', 1))
    const processes = new ProcessRepository(basePath)
    await processes.create(processRecord())
    expect((await processes.get('process-01'))?.attempt_id).toBe('attempt-01')
    const updated = await processes.update('process-01', 0, current => ({ ...current, status: 'starting' }))
    expect(updated).toMatchObject({ revision: 1, status: 'starting' })
    await expect(processes.update('process-01', 0, current => current)).rejects.toMatchObject({
      code: 'RUNTIME_REVISION_CONFLICT',
    })
    expect(JSON.parse(await readFile(
      join(basePath, '.threados/runs/run-01/attempts/attempt-01/process.json'),
      'utf-8',
    )).id).toBe('process-01')
  })

  test('rejects escaping symlink roots for runs, attempts, commands, and state', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-runtime-outside-'))
    try {
      const runsBase = await mkdtemp(join(tmpdir(), 'threados-runtime-runs-link-'))
      await mkdir(join(runsBase, '.threados'), { recursive: true })
      await symlink(outside, join(runsBase, '.threados/runs'), 'junction')
      await expect(new RunRepository(runsBase).create(run())).rejects.toThrow()

      await new RunRepository(basePath).create(run())
      await symlink(outside, join(basePath, '.threados/runs/run-01/attempts'), 'junction')
      await expect(new AttemptRepository(basePath).create(attempt('attempt-01', 1))).rejects.toThrow()

      const commandsBase = await mkdtemp(join(tmpdir(), 'threados-runtime-commands-link-'))
      await mkdir(join(commandsBase, '.threados'), { recursive: true })
      await symlink(outside, join(commandsBase, '.threados/state'), 'junction')
      await expect(new CommandRepository(commandsBase).createOrReplay(receipt())).rejects.toThrow()
      await rm(runsBase, { recursive: true, force: true })
      await rm(commandsBase, { recursive: true, force: true })
      expect(await readdir(outside)).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('exact command replay returns the original receipt and changed payload conflicts', async () => {
    const commands = new CommandRepository(basePath)
    expect(await commands.createOrReplay(receipt())).toEqual(receipt())
    expect(await commands.createOrReplay(receipt({ id: 'command-02' }))).toEqual(receipt())
    await expect(commands.createOrReplay(receipt({ id: 'command-03', request_hash: 'sha256:request-b' })))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(await commands.findByIdempotencyKey(receipt().idempotency_key)).toEqual(receipt())
  })

  test('concurrent identical command replay creates one canonical receipt without raw-key filenames', async () => {
    const [first, second] = await Promise.all([
      new CommandRepository(basePath).createOrReplay(receipt()),
      new CommandRepository(basePath).createOrReplay(receipt({ id: 'command-02' })),
    ])
    expect(first.id).toBe(second.id)
    const names = await readdir(join(basePath, '.threados/state/runtime-commands'))
    expect(names.filter(name => name.endsWith('.json'))).toHaveLength(1)
    expect(names.join('\n')).not.toContain(receipt().idempotency_key)
  })

  test('missing and corrupt derived indexes rebuild from authoritative records', async () => {
    await new RunRepository(basePath).create(run())
    await new AttemptRepository(basePath).create(attempt('attempt-01', 1))
    const indexPath = join(basePath, '.threados/state/runtime-index.json')
    await rm(indexPath, { force: true })
    expect((await new AttemptRepository(basePath).get('attempt-01'))?.id).toBe('attempt-01')
    await writeFile(indexPath, '{not-json', 'utf-8')
    expect((await new RunRepository(basePath).list()).map(item => item.id)).toEqual(['run-01'])
    await writeFile(indexPath, JSON.stringify({
      schema_version: 1,
      runs: {},
      attempts: { 'attempt-01': '..\\outside.json' },
      processes: {},
      commands: {},
      idempotency: {},
    }), 'utf-8')
    expect((await new AttemptRepository(basePath).get('attempt-01'))?.id).toBe('attempt-01')
    expect((await rebuildRuntimeIndex(basePath)).attempts['attempt-01']).toContain('attempt.json')
  })
})
