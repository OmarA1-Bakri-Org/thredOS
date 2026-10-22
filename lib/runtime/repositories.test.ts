import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProcessRecord, RuntimeCommandReceipt, StepAttempt, WorkflowRun } from './schema'
import { RunRepository } from './run-repository'
import { AttemptRepository, type AttemptWorkspaceRef } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import { rebuildRuntimeIndex } from './runtime-index'
import {
  setAtomicBeforeRenameHookForTests,
  setAtomicBoundaryHookForTests,
  withExclusiveFileLock,
} from '../fs/atomic'

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

function workspaceRef(overrides: Partial<AttemptWorkspaceRef> = {}): AttemptWorkspaceRef {
  return {
    schema_version: 1,
    workflow_run_id: 'run-01',
    attempt_id: 'attempt-01',
    workspace_id: 'workspace-01',
    snapshot_id: 'snapshot-01',
    manifest_hash: `sha256:${'a'.repeat(64)}`,
    bound_at: timestamp,
    ...overrides,
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
    setAtomicBoundaryHookForTests(null)
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

  test('read APIs do not create runtime roots or phantom entity directories', async () => {
    expect(await new RunRepository(basePath).get('missing-run')).toBeNull()
    expect(await new RunRepository(basePath).list()).toEqual([])
    expect(await new AttemptRepository(basePath).get('missing-attempt')).toBeNull()
    expect(await new AttemptRepository(basePath).listForRun('missing-run')).toEqual([])
    expect(await new AttemptRepository(basePath).getWorkspaceRef('missing-run', 'missing-attempt')).toBeNull()
    expect(await new ProcessRepository(basePath).get('missing-process')).toBeNull()
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect(await new CommandRepository(basePath).get('missing-command')).toBeNull()
    expect(await new CommandRepository(basePath).list()).toEqual([])
    await expect(stat(join(basePath, '.threados'))).rejects.toMatchObject({ code: 'ENOENT' })
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

  test('attempt workspace refs bind once without mutating the owning attempt and exact replay is idempotent', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    const attemptPath = join(basePath, '.threados/runs/run-01/attempts/attempt-01/attempt.json')
    const attemptBytes = await readFile(attemptPath, 'utf-8')

    expect(await repository.bindWorkspaceRef(workspaceRef())).toEqual(workspaceRef())
    expect(await repository.bindWorkspaceRef(workspaceRef({
      bound_at: '2026-07-16T00:01:00.000Z',
    }))).toEqual(workspaceRef())
    const refPath = join(basePath, '.threados/runs/run-01/attempts/attempt-01/workspace.ref.json')
    const firstBytes = await readFile(refPath, 'utf-8')
    expect(await new AttemptRepository(basePath).getWorkspaceRef('run-01', 'attempt-01')).toEqual(workspaceRef())
    expect(await repository.bindWorkspaceRef(workspaceRef())).toEqual(workspaceRef())
    expect(await readFile(refPath, 'utf-8')).toBe(firstBytes)
    expect(await readFile(attemptPath, 'utf-8')).toBe(attemptBytes)
  })

  test('attempt workspace ref reads fail closed when the owning attempt is missing or identities drift', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    await repository.bindWorkspaceRef(workspaceRef())
    const attemptDirectory = join(basePath, '.threados/runs/run-01/attempts/attempt-01')
    const refPath = join(attemptDirectory, 'workspace.ref.json')

    await writeFile(refPath, `${JSON.stringify(workspaceRef({ attempt_id: 'attempt-02' }))}\n`)
    await expect(repository.getWorkspaceRef('run-01', 'attempt-01')).rejects.toMatchObject({
      code: 'ATTEMPT_WORKSPACE_REF_IDENTITY_MISMATCH',
    })

    await writeFile(refPath, `${JSON.stringify(workspaceRef())}\n`)
    await unlink(join(attemptDirectory, 'attempt.json'))
    await expect(repository.getWorkspaceRef('run-01', 'attempt-01')).rejects.toMatchObject({
      code: 'ATTEMPT_NOT_FOUND',
    })
  })

  test('attempt workspace refs remain aligned with non-null attempt workspace bindings', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    await repository.bindWorkspaceRef(workspaceRef())
    await repository.update('attempt-01', 0, current => ({
      ...current,
      workspace_id: 'workspace-other',
      baseline_snapshot_id: 'snapshot-01',
    }))

    await expect(repository.getWorkspaceRef('run-01', 'attempt-01')).rejects.toMatchObject({
      code: 'ATTEMPT_WORKSPACE_REF_IDENTITY_MISMATCH',
    })
  })

  test('attempt workspace refs require the owning attempt identity and reject unsafe ids', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))

    await expect(repository.bindWorkspaceRef(workspaceRef({ attempt_id: 'missing-attempt' })))
      .rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' })
    await expect(repository.bindWorkspaceRef(workspaceRef({ workflow_run_id: 'other-run' })))
      .rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' })
    for (const ref of [
      workspaceRef({ workflow_run_id: '../run' }),
      workspaceRef({ attempt_id: '../attempt' }),
      workspaceRef({ workspace_id: '../workspace' }),
      workspaceRef({ snapshot_id: '../snapshot' }),
    ]) {
      await expect(repository.bindWorkspaceRef(ref)).rejects.toThrow('file-safe identifier')
    }
    await expect(repository.bindWorkspaceRef({
      ...workspaceRef(),
      unexpected: true,
    } as AttemptWorkspaceRef)).rejects.toThrow()
    await expect(repository.bindWorkspaceRef(workspaceRef({ manifest_hash: 'sha256:short' })))
      .rejects.toThrow()
  })

  test('attempt workspace ref conflicts fail closed under sequential and concurrent duplicate binds', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    await repository.bindWorkspaceRef(workspaceRef())

    await expect(repository.bindWorkspaceRef(workspaceRef({ workspace_id: 'workspace-02' })))
      .rejects.toMatchObject({ code: 'ATTEMPT_WORKSPACE_REF_CONFLICT' })
    expect(await repository.getWorkspaceRef('run-01', 'attempt-01')).toEqual(workspaceRef())

    await repository.create(attempt('attempt-02', 2))
    const results = await Promise.allSettled([
      new AttemptRepository(basePath).bindWorkspaceRef(workspaceRef({ attempt_id: 'attempt-02' })),
      new AttemptRepository(basePath).bindWorkspaceRef(workspaceRef({
        attempt_id: 'attempt-02',
        workspace_id: 'workspace-02',
      })),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'ATTEMPT_WORKSPACE_REF_CONFLICT' },
    })
  })

  test('attempt workspace ref binding rejects escaping symlinks', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-workspace-ref-outside-'))
    try {
      await new RunRepository(basePath).create(run())
      const repository = new AttemptRepository(basePath)
      await repository.create(attempt('attempt-01', 1))
      const outsideRef = join(outside, 'workspace.ref.json')
      await writeFile(outsideRef, `${JSON.stringify(workspaceRef())}\n`)
      await symlink(
        outsideRef,
        join(basePath, '.threados/runs/run-01/attempts/attempt-01/workspace.ref.json'),
        'file',
      )

      await expect(repository.getWorkspaceRef('run-01', 'attempt-01')).rejects.toThrow()
      await expect(repository.bindWorkspaceRef(workspaceRef())).rejects.toThrow()
      expect(JSON.parse(await readFile(outsideRef, 'utf-8'))).toEqual(workspaceRef())
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('injected attempt workspace ref write failure preserves attempt bytes and leaves no residue', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    const attemptDirectory = join(basePath, '.threados/runs/run-01/attempts/attempt-01')
    const attemptPath = join(attemptDirectory, 'attempt.json')
    const refPath = join(attemptDirectory, 'workspace.ref.json')
    const attemptBytes = await readFile(attemptPath, 'utf-8')
    setAtomicBeforeRenameHookForTests(async target => {
      if (target === refPath) throw new Error('injected workspace ref failure')
    })

    await expect(repository.bindWorkspaceRef(workspaceRef())).rejects.toThrow('injected workspace ref failure')
    expect(await readFile(attemptPath, 'utf-8')).toBe(attemptBytes)
    await expect(readFile(refPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(attemptDirectory)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
  })

  test('attempt workspace ref binding revalidates ownership inside the bind lock', async () => {
    await new RunRepository(basePath).create(run())
    const repository = new AttemptRepository(basePath)
    await repository.create(attempt('attempt-01', 1))
    const attemptDirectory = join(basePath, '.threados/runs/run-01/attempts/attempt-01')
    const attemptPath = join(attemptDirectory, 'attempt.json')
    let removed = false
    setAtomicBoundaryHookForTests(async context => {
      if (
        !removed
        && context.stage === 'after-lock-precheck-before-open'
        && context.targetPath.endsWith('workspace.ref.json.lock')
      ) {
        removed = true
        await unlink(attemptPath)
      }
    })

    await expect(repository.bindWorkspaceRef(workspaceRef())).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' })
    expect(removed).toBe(true)
    expect(await repository.getWorkspaceRef('run-01', 'attempt-01')).toBeNull()
    expect((await readdir(attemptDirectory)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
  })

  test('process records live under their owning attempt and use revision CAS', async () => {
    await new RunRepository(basePath).create(run())
    await new AttemptRepository(basePath).create(attempt('attempt-01', 1))
    const processes = new ProcessRepository(basePath)
    await processes.create(processRecord({ process_purpose: 'bootstrap', process_ordinal: 0 }))
    await processes.create(processRecord({
      id: 'process-02',
      process_purpose: 'agent',
      process_ordinal: 0,
    }))
    expect((await processes.get('process-01'))?.attempt_id).toBe('attempt-01')
    expect((await processes.list()).map(process => process.id)).toEqual(['process-01', 'process-02'])
    const updated = await processes.update('process-01', 0, current => ({ ...current, status: 'starting' }))
    expect(updated).toMatchObject({ revision: 1, status: 'starting' })
    await expect(processes.update('process-01', 0, current => current)).rejects.toMatchObject({
      code: 'RUNTIME_REVISION_CONFLICT',
    })
    expect(JSON.parse(await readFile(
      join(basePath, '.threados/runs/run-01/attempts/attempt-01/processes/process-01.json'),
      'utf-8',
    )).id).toBe('process-01')
  })

  test('reads legacy process.json alongside additive multi-process records', async () => {
    await new RunRepository(basePath).create(run())
    await new AttemptRepository(basePath).create(attempt('attempt-01', 1))
    const legacy = processRecord({ id: 'process-legacy' })
    await writeFile(
      join(basePath, '.threados/runs/run-01/attempts/attempt-01/process.json'),
      `${JSON.stringify(legacy)}\n`,
    )
    const processes = new ProcessRepository(basePath)
    await processes.create(processRecord({
      id: 'process-new',
      process_purpose: 'agent',
      process_ordinal: 0,
    }))

    expect(await processes.get('process-legacy')).toMatchObject({ id: 'process-legacy' })
    expect((await processes.list()).map(process => process.id)).toEqual(['process-legacy', 'process-new'])
  })

  test('stable run, attempt, and process references expose fresh content without index rebuilds', async () => {
    const runs = new RunRepository(basePath)
    const attempts = new AttemptRepository(basePath)
    const processes = new ProcessRepository(basePath)
    await runs.create(run())
    await attempts.create(attempt('attempt-01', 1))
    await processes.create(processRecord())

    await runs.update('run-01', 0, current => ({ ...current, status: 'running' }))
    await attempts.update('attempt-01', 0, current => ({ ...current, status: 'provisioning' }))
    await processes.update('process-01', 0, current => ({ ...current, status: 'starting' }))

    expect((await runs.list())[0]).toMatchObject({ revision: 1, status: 'running' })
    expect((await attempts.listForRun('run-01'))[0]).toMatchObject({ revision: 1, status: 'provisioning' })
    expect(await processes.get('process-01')).toMatchObject({ revision: 1, status: 'starting' })
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

  test('stale syntactically valid attempt and process index entries always rebuild once', async () => {
    await new RunRepository(basePath).create(run())
    const attempts = new AttemptRepository(basePath)
    await attempts.create(attempt('attempt-01', 1))
    await attempts.create(attempt('attempt-02', 2))
    await new ProcessRepository(basePath).create(processRecord())
    const indexPath = join(basePath, '.threados/state/runtime-index.json')
    const baseIndex = {
      schema_version: 1,
      runs: {},
      attempts: {},
      processes: {},
      commands: {},
      idempotency: {},
    }

    await writeFile(indexPath, JSON.stringify({
      ...baseIndex,
      attempts: { 'attempt-01': '.threados/runs/run-01/attempts/attempt-02/attempt.json' },
    }))
    expect((await new AttemptRepository(basePath).get('attempt-01'))?.id).toBe('attempt-01')

    await writeFile(indexPath, JSON.stringify({
      ...baseIndex,
      attempts: { 'attempt-01': '.threados/runs/run-01/run.json' },
    }))
    expect((await new AttemptRepository(basePath).get('attempt-01'))?.id).toBe('attempt-01')

    await writeFile(indexPath, JSON.stringify({
      ...baseIndex,
      processes: { 'process-01': '.threados/runs/run-01/attempts/attempt-02/attempt.json' },
    }))
    expect((await new ProcessRepository(basePath).get('process-01'))?.id).toBe('process-01')
  })

  test('valid live locks never expire while dead owners and stale malformed locks recover', async () => {
    const lockPath = join(basePath, 'record.json.lock')
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, created_at_ms: 0, token: 'long-lived' }))
    await expect(withExclusiveFileLock(lockPath, async () => undefined, {
      allowedRoot: basePath,
      timeoutMs: 20,
      staleAfterMs: 1,
    })).rejects.toMatchObject({ code: 'RUNTIME_LOCK_TIMEOUT' })

    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, created_at_ms: Date.now(), token: 'dead' }))
    await expect(withExclusiveFileLock(lockPath, async () => 'dead-recovered', {
      allowedRoot: basePath,
      timeoutMs: 100,
      staleAfterMs: 60_000,
    })).resolves.toBe('dead-recovered')

    await writeFile(lockPath, '{malformed')
    const old = new Date(0)
    await utimes(lockPath, old, old)
    await expect(withExclusiveFileLock(lockPath, async () => 'malformed-recovered', {
      allowedRoot: basePath,
      timeoutMs: 100,
      staleAfterMs: 1,
    })).resolves.toBe('malformed-recovered')
  })

  test('authoritative commit succeeds even when the derived-index lock is unavailable', async () => {
    await mkdir(join(basePath, '.threados/state'), { recursive: true })
    await writeFile(join(basePath, '.threados/state/runtime-index.json.lock'), JSON.stringify({
      pid: process.pid,
      created_at_ms: Date.now(),
      token: 'live-index-owner',
    }))
    await expect(new RunRepository(basePath).create(run())).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(join(basePath, '.threados/runs/run-01/run.json'), 'utf-8')).id).toBe('run-01')
  })

  test('repository lock creation revalidates the parent after its final precheck', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-runtime-toctou-outside-'))
    const runDirectory = join(basePath, '.threados/runs/run-01')
    const moved = `${runDirectory}.moved`
    const swap = async (directory: string): Promise<void> => {
      await rename(directory, `${directory}.moved`)
      await symlink(outside, directory, 'junction')
    }
    try {
      const repository = new RunRepository(basePath)
      let swapped = false
      setAtomicBoundaryHookForTests(async context => {
        if (!swapped && context.stage === 'after-lock-precheck-before-open' && context.targetPath.endsWith('run.json.lock')) {
          swapped = true
          await swap(runDirectory)
        }
      })
      await expect(repository.create(run())).rejects.toThrow()
      expect(swapped).toBe(true)
      expect(await readdir(outside)).toEqual([])
      expect((await readdir(moved))
        .filter(name => name.endsWith('.lock'))).toEqual([])
      await unlink(runDirectory)
      await rename(moved, runDirectory)
    } finally {
      setAtomicBoundaryHookForTests(null)
      await rm(outside, { recursive: true, force: true })
    }
  })
})
