import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { commandRecordPath, processRecordPath } from './paths'
import { ProcessRepository } from './process-repository'
import { reconcileCanonicalRuntime } from './recovery'
import { formatRetryBinding } from './retry-binding'
import { RunRepository } from './run-repository'
import type {
  ProcessRecord,
  RuntimeCommandReceipt,
  StepAttempt,
  WorkflowRun,
} from './schema'

const roots: string[] = []
const NOW = '2026-07-16T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function repositories() {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-recovery-'))
  roots.push(basePath)
  return {
    basePath,
    runs: new RunRepository(basePath),
    attempts: new AttemptRepository(basePath),
    processes: new ProcessRepository(basePath),
    commands: new CommandRepository(basePath),
  }
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    schema_version: 2,
    id: 'run-1',
    revision: 0,
    sequence_id: 'sequence-1',
    sequence_snapshot_hash: 'sequence-hash',
    target: { kind: 'step', step_id: 'build' },
    strategy: 'sequential',
    status: 'running',
    max_concurrency: 1,
    policy_snapshot_hash: 'policy-hash',
    baseline_snapshot_id: null,
    attempt_ids: ['attempt-1'],
    created_by: 'tester',
    created_via: 'system',
    created_at: '2026-07-15T23:59:00.000Z',
    started_at: '2026-07-15T23:59:01.000Z',
    ended_at: null,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
    ...overrides,
  }
}

function attempt(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    schema_version: 2,
    id: 'attempt-1',
    revision: 0,
    workflow_run_id: 'run-1',
    sequence_id: 'sequence-1',
    step_id: 'build',
    surface_id: 'thread-build',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status: 'running',
    agent_ref: null,
    model: 'shell',
    side_effect_class: 'execute',
    baseline_snapshot_id: null,
    workspace_id: 'workspace-1',
    process_id: 'process-1',
    compiled_prompt_hash: 'prompt-hash',
    input_manifest_ref: 'input.json',
    output_manifest_ref: 'partial-output.json',
    artifact_manifest_ref: 'partial-artifacts.json',
    change_set_id: null,
    gate_decision_refs: ['gate-1'],
    created_at: '2026-07-15T23:59:00.000Z',
    started_at: '2026-07-15T23:59:01.000Z',
    ended_at: null,
    last_heartbeat_at: '2026-07-15T23:59:30.000Z',
    exit_code: null,
    signal: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
    ...overrides,
  }
}

function processRecord(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    schema_version: 1,
    id: 'process-1',
    revision: 0,
    workflow_run_id: 'run-1',
    attempt_id: 'attempt-1',
    provider: 'local-process',
    provider_handle: 'local:4242',
    pid: 4242,
    command: 'node',
    redacted_args: ['fixture.mjs'],
    environment_keys: ['PATH'],
    cwd: 'C:\\isolated\\workspace',
    status: 'running',
    launch_requested_at: '2026-07-15T23:59:00.000Z',
    started_at: '2026-07-15T23:59:01.000Z',
    ended_at: null,
    last_output_at: '2026-07-15T23:59:30.000Z',
    last_heartbeat_at: '2026-07-15T23:59:30.000Z',
    cancellation_requested_at: null,
    exit_code: null,
    signal: null,
    ...overrides,
  }
}

function receipt(overrides: Partial<RuntimeCommandReceipt>): RuntimeCommandReceipt {
  return {
    schema_version: 1,
    id: 'command-1',
    idempotency_key: 'recovery-key',
    command_type: 'start-run',
    request_hash: 'request-hash',
    status: 'accepted',
    result_ref: 'run-1',
    error_code: null,
    error_message: null,
    created_at: '2026-07-15T23:59:00.000Z',
    completed_at: null,
    ...overrides,
  }
}

async function createActiveTree(repos: Awaited<ReturnType<typeof repositories>>) {
  await repos.runs.create(run())
  await repos.attempts.create(attempt())
  await repos.processes.create(processRecord())
}

describe('reconcileCanonicalRuntime', () => {
  test('marks a stale running process lost and its attempt and run interrupted while preserving evidence', async () => {
    const repos = await repositories()
    await createActiveTree(repos)

    const report = await reconcileCanonicalRuntime(repos.basePath, {
      now: () => NOW,
      probePid: async () => false,
    })

    expect(await repos.processes.get('process-1')).toMatchObject({
      status: 'lost',
      provider_handle: 'local:4242',
      pid: 4242,
      command: 'node',
      ended_at: NOW,
      last_output_at: '2026-07-15T23:59:30.000Z',
    })
    expect(await repos.attempts.get('attempt-1')).toMatchObject({
      status: 'interrupted',
      workspace_id: 'workspace-1',
      process_id: 'process-1',
      output_manifest_ref: 'partial-output.json',
      artifact_manifest_ref: 'partial-artifacts.json',
      gate_decision_refs: ['gate-1'],
      ended_at: NOW,
      error_code: 'PROCESS_LOST',
    })
    expect(await repos.runs.get('run-1')).toMatchObject({
      status: 'interrupted',
      ended_at: NOW,
      error_code: 'PROCESS_LOST',
    })
    expect(report.changes.map(change => `${change.entityType}:${change.entityId}:${change.to}`))
      .toEqual([
        'process:process-1:lost',
        'attempt:attempt-1:interrupted',
        'run:run-1:interrupted',
      ])
    expect(report.errors).toEqual([])
  })

  test('an apparently live PID is still lost and interrupted without default termination', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    const probePid = mock(async () => true)
    const terminate = mock(async () => undefined)

    await reconcileCanonicalRuntime(repos.basePath, {
      now: () => NOW,
      probePid,
      orphanTermination: { enabled: false, terminate },
    })

    expect(probePid).toHaveBeenCalledWith(4242)
    expect(terminate).not.toHaveBeenCalled()
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('interrupted')
  })

  test('explicit direct orphan termination failure is reported without weakening lost truth', async () => {
    const repos = await repositories()
    await createActiveTree(repos)

    const report = await reconcileCanonicalRuntime(repos.basePath, {
      now: () => NOW,
      probePid: async () => true,
      orphanTermination: {
        enabled: true,
        terminate: async () => { throw new Error('access denied') },
      },
    })

    expect(report.errors).toContain('Failed to terminate orphan process process-1 (pid 4242): access denied')
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
    expect((await repos.runs.get('run-1'))?.status).toBe('interrupted')
  })

  test('terminal records are idempotent and repeated reconciliation is a no-op', async () => {
    const repos = await repositories()
    await createActiveTree(repos)

    const first = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })
    const second = await reconcileCanonicalRuntime(repos.basePath, { now: () => '2026-07-16T01:00:00.000Z' })

    expect(first.changes).toHaveLength(3)
    expect(second.changes).toEqual([])
    expect(second.errors).toEqual([])
    expect((await repos.processes.get('process-1'))?.ended_at).toBe(NOW)
    expect((await repos.attempts.get('attempt-1'))?.ended_at).toBe(NOW)
    expect((await repos.runs.get('run-1'))?.ended_at).toBe(NOW)
  })

  test('missing process ownership is reported without aborting unrelated recovery', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    await repos.runs.create(run({
      id: 'run-2',
      attempt_ids: ['attempt-2'],
    }))
    await repos.attempts.create(attempt({
      id: 'attempt-2',
      workflow_run_id: 'run-2',
      process_id: 'process-2',
    }))
    await repos.processes.create(processRecord({
      id: 'process-2',
      workflow_run_id: 'run-2',
      attempt_id: 'attempt-2',
      pid: 5252,
      provider_handle: 'local:5252',
    }))
    await unlink(join(dirname(await processRecordPath(repos.basePath, 'run-1', 'attempt-1')), 'attempt.json'))

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toContain('Process process-1 references missing attempt attempt-1')
    expect((await repos.processes.get('process-1'))?.status).toBe('running')
    expect((await repos.processes.get('process-2'))?.status).toBe('lost')
    expect((await repos.attempts.get('attempt-2'))?.status).toBe('interrupted')
    expect((await repos.runs.get('run-2'))?.status).toBe('interrupted')
  })

  test('repairs accepted start and cancel receipts to failed from interrupted canonical truth', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    await repos.commands.createOrReplay(receipt({ id: 'command-start', idempotency_key: 'start-key' }))
    await repos.commands.createOrReplay(receipt({
      id: 'command-cancel-run',
      idempotency_key: 'cancel-run-key',
      command_type: 'cancel-run',
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'command-cancel-attempt',
      idempotency_key: 'cancel-attempt-key',
      command_type: 'cancel-attempt',
      result_ref: 'attempt-1',
    }))

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    for (const id of ['command-start', 'command-cancel-run', 'command-cancel-attempt']) {
      expect(await repos.commands.get(id)).toMatchObject({
        status: 'failed',
        error_code: 'PROCESS_LOST',
        completed_at: NOW,
      })
    }
  })

  test('repairs the reservation-first crash window without inventing an attempt', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      status: 'provisioning',
      attempt_ids: ['attempt-reserved-but-missing'],
      started_at: null,
    }))
    await repos.commands.createOrReplay(receipt({ id: 'command-start', idempotency_key: 'start-key' }))

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toContain(
      'Run run-1 references reserved attempt attempt-reserved-but-missing whose record is missing',
    )
    expect(await repos.runs.get('run-1')).toMatchObject({
      status: 'interrupted',
      ended_at: NOW,
      error_code: 'PROCESS_LOST',
      error_message: 'Reserved attempt attempt-reserved-but-missing was not persisted before restart',
    })
    expect(await repos.attempts.get('attempt-reserved-but-missing')).toBeNull()
    expect(await repos.commands.get('command-start')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
    })
  })

  test('skips active processes still managed by the current service', async () => {
    const repos = await repositories()
    await createActiveTree(repos)

    const report = await reconcileCanonicalRuntime(repos.basePath, {
      now: () => NOW,
      isProcessManaged: processId => processId === 'process-1',
    })

    expect(report.changes).toEqual([])
    expect((await repos.processes.get('process-1'))?.status).toBe('running')
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('running')
    expect((await repos.runs.get('run-1'))?.status).toBe('running')
  })

  test('skips a managed in-flight run before its process handle is published', async () => {
    const repos = await repositories()
    await repos.runs.create(run({ status: 'provisioning' }))
    await repos.attempts.create(attempt({ status: 'provisioning', process_id: null }))

    const report = await reconcileCanonicalRuntime(repos.basePath, {
      now: () => NOW,
      isAttemptManaged: (_attemptId, runId) => runId === 'run-1',
      isRunManaged: runId => runId === 'run-1',
    })

    expect(report.changes).toEqual([])
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('provisioning')
    expect((await repos.runs.get('run-1'))?.status).toBe('provisioning')
  })

  test('completes an accepted retry receipt with the durable child attempt after interruption', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      id: 'original-run',
      status: 'failed',
      attempt_ids: ['original-attempt'],
      ended_at: '2026-07-15T23:58:00.000Z',
    }))
    await repos.attempts.create(attempt({
      id: 'original-attempt',
      workflow_run_id: 'original-run',
      status: 'failed',
      process_id: null,
      ended_at: '2026-07-15T23:58:00.000Z',
    }))
    await repos.runs.create(run({
      id: 'child-run',
      attempt_ids: ['child-attempt'],
    }))
    await repos.attempts.create(attempt({
      id: 'child-attempt',
      workflow_run_id: 'child-run',
      retry_of_attempt_id: 'original-attempt',
      process_id: 'child-process',
    }))
    await repos.processes.create(processRecord({
      id: 'child-process',
      workflow_run_id: 'child-run',
      attempt_id: 'child-attempt',
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'outer-retry',
      idempotency_key: 'outer-retry-key',
      command_type: 'retry-attempt',
      result_ref: formatRetryBinding('original-attempt', 'child-run'),
    }))
    await repos.commands.createOrReplay({
      ...receipt({
        id: 'child-start',
        idempotency_key: 'retry-start:outer-retry',
        command_type: 'start-run',
        result_ref: 'child-run',
      }),
      status: 'failed',
      error_code: 'RUN_PERSIST_FAILED',
      error_message: 'child start also failed',
      completed_at: '2026-07-15T23:59:30.000Z',
    })

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(await repos.attempts.get('child-attempt')).toMatchObject({
      status: 'interrupted',
      error_code: 'PROCESS_LOST',
    })
    expect(await repos.commands.get('outer-retry')).toMatchObject({
      status: 'completed',
      result_ref: 'child-attempt',
      completed_at: NOW,
    })
  }, 30_000)

  test('fails an accepted retry receipt when its child reserved attempt is missing', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      id: 'child-run',
      status: 'provisioning',
      attempt_ids: ['missing-child-attempt'],
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'outer-retry',
      idempotency_key: 'outer-retry-key',
      command_type: 'retry-attempt',
      result_ref: formatRetryBinding('original-attempt', 'child-run'),
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'child-start',
      idempotency_key: 'retry-start:outer-retry',
      command_type: 'start-run',
      result_ref: 'child-run',
    }))

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(await repos.commands.get('outer-retry')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
      completed_at: NOW,
    })
  })

  test('fails an accepted retry receipt from a durable failed child start without attempt lineage', async () => {
    const repos = await repositories()
    await repos.commands.createOrReplay(receipt({
      id: 'outer-retry',
      idempotency_key: 'outer-retry-key',
      command_type: 'retry-attempt',
      result_ref: formatRetryBinding('original-attempt', 'child-run'),
    }))
    await repos.commands.createOrReplay({
      ...receipt({
        id: 'child-start',
        idempotency_key: 'retry-start:outer-retry',
        command_type: 'start-run',
        result_ref: 'child-run',
      }),
      status: 'failed',
      error_code: 'RUN_PERSIST_FAILED',
      error_message: 'child run could not be persisted',
      completed_at: '2026-07-15T23:59:30.000Z',
    })

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(await repos.commands.get('outer-retry')).toMatchObject({
      status: 'failed',
      error_code: 'RUN_PERSIST_FAILED',
      error_message: 'child run could not be persisted',
      completed_at: NOW,
    })
  })

  test('does not complete retry from an unrelated attempt in the child run', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      id: 'child-run',
      status: 'interrupted',
      attempt_ids: ['unrelated-attempt'],
      ended_at: NOW,
      error_code: 'PROCESS_LOST',
      error_message: 'child interrupted',
    }))
    await repos.attempts.create(attempt({
      id: 'unrelated-attempt',
      workflow_run_id: 'child-run',
      status: 'interrupted',
      retry_of_attempt_id: 'different-original',
      process_id: null,
      ended_at: NOW,
      error_code: 'PROCESS_LOST',
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'outer-retry',
      idempotency_key: 'outer-retry-key',
      command_type: 'retry-attempt',
      result_ref: formatRetryBinding('original-attempt', 'child-run'),
    }))

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(await repos.commands.get('outer-retry')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
      completed_at: NOW,
    })
  })

  test('fails unsafe encoded retry identifiers without traversal or an accepted receipt', async () => {
    const repos = await repositories()
    for (const [id, binding] of [
      ['unsafe-original', 'retry:..%2Fescape:run:safe-run'],
      ['unsafe-child', 'retry:safe-attempt:run:..%5Cescape'],
    ] as const) {
      await repos.commands.createOrReplay(receipt({
        id,
        idempotency_key: `${id}-key`,
        command_type: 'retry-attempt',
        result_ref: binding,
      }))
    }

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    for (const id of ['unsafe-original', 'unsafe-child']) {
      expect(await repos.commands.get(id)).toMatchObject({
        status: 'failed',
        error_code: 'PROCESS_LOST',
        completed_at: NOW,
      })
    }
  }, 30_000)

  test('reports corrupt physical ownership and malformed JSON while recovering a healthy tree', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    const runsRoot = join(repos.basePath, '.threados', 'runs')

    await mkdir(join(runsRoot, 'directory-run', 'attempts'), { recursive: true })
    await writeFile(
      join(runsRoot, 'directory-run', 'run.json'),
      JSON.stringify(run({ id: 'record-run' })),
    )

    await mkdir(join(runsRoot, 'attempt-owner', 'attempts', 'directory-attempt'), { recursive: true })
    await writeFile(
      join(runsRoot, 'attempt-owner', 'run.json'),
      JSON.stringify(run({ id: 'attempt-owner', attempt_ids: [] })),
    )
    await writeFile(
      join(runsRoot, 'attempt-owner', 'attempts', 'directory-attempt', 'attempt.json'),
      JSON.stringify(attempt({
        id: 'record-attempt',
        workflow_run_id: 'different-run',
        process_id: null,
      })),
    )

    await repos.runs.create(run({
      id: 'process-owner',
      status: 'failed',
      attempt_ids: ['process-attempt'],
      ended_at: NOW,
    }))
    await repos.attempts.create(attempt({
      id: 'process-attempt',
      workflow_run_id: 'process-owner',
      status: 'failed',
      process_id: 'corrupt-process',
      ended_at: NOW,
    }))
    const corruptProcessPath = await processRecordPath(
      repos.basePath,
      'process-owner',
      'process-attempt',
    )
    await writeFile(corruptProcessPath, JSON.stringify(processRecord({
      id: 'corrupt-process',
      workflow_run_id: 'other-run',
      attempt_id: 'other-attempt',
      status: 'running',
    })))

    await mkdir(join(runsRoot, 'malformed-run'), { recursive: true })
    await writeFile(join(runsRoot, 'malformed-run', 'run.json'), '{not-json')

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Run record identity mismatch at directory-run/run.json'),
      expect.stringContaining('Attempt record identity mismatch at attempt-owner/attempts/directory-attempt/attempt.json'),
      expect.stringContaining('Attempt ownership mismatch at attempt-owner/attempts/directory-attempt/attempt.json'),
      expect.stringContaining('Process ownership mismatch at process-owner/attempts/process-attempt/process.json'),
      expect.stringContaining('Malformed run record at malformed-run/run.json'),
    ]))
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('interrupted')
    expect((await repos.runs.get('run-1'))?.status).toBe('interrupted')
    expect(await repos.processes.get('corrupt-process')).toBeNull()
  })

  test('quarantines duplicate attempt identities across valid runs', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    for (const runId of ['duplicate-run-a', 'duplicate-run-b']) {
      await repos.runs.create(run({ id: runId, attempt_ids: ['duplicate-attempt'] }))
      const directory = join(
        repos.basePath,
        '.threados',
        'runs',
        runId,
        'attempts',
        'duplicate-attempt',
      )
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'attempt.json'), JSON.stringify(attempt({
        id: 'duplicate-attempt',
        workflow_run_id: runId,
        process_id: null,
      })))
    }

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toContain('Duplicate attempt identity duplicate-attempt')
    for (const runId of ['duplicate-run-a', 'duplicate-run-b']) {
      const physical = JSON.parse(await Bun.file(join(
        repos.basePath,
        '.threados',
        'runs',
        runId,
        'attempts',
        'duplicate-attempt',
        'attempt.json',
      )).text()) as StepAttempt
      expect(physical.status).toBe('running')
    }
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
  }, 30_000)

  test('quarantines duplicate process identities across valid attempts', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    for (const [runId, attemptId] of [
      ['duplicate-process-run-a', 'duplicate-process-attempt-a'],
      ['duplicate-process-run-b', 'duplicate-process-attempt-b'],
    ] as const) {
      await repos.runs.create(run({ id: runId, attempt_ids: [attemptId] }))
      await repos.attempts.create(attempt({
        id: attemptId,
        workflow_run_id: runId,
        process_id: 'duplicate-process',
      }))
      await writeFile(
        await processRecordPath(repos.basePath, runId, attemptId),
        JSON.stringify(processRecord({
          id: 'duplicate-process',
          workflow_run_id: runId,
          attempt_id: attemptId,
        })),
      )
    }

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toContain('Duplicate process identity duplicate-process')
    for (const [runId, attemptId] of [
      ['duplicate-process-run-a', 'duplicate-process-attempt-a'],
      ['duplicate-process-run-b', 'duplicate-process-attempt-b'],
    ] as const) {
      const physical = JSON.parse(await Bun.file(
        await processRecordPath(repos.basePath, runId, attemptId),
      ).text()) as ProcessRecord
      expect(physical.status).toBe('running')
    }
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
  }, 30_000)

  test('diagnoses descendants under a missing run record and leaves them quarantined', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    const directory = join(
      repos.basePath,
      '.threados',
      'runs',
      'missing-run-record',
      'attempts',
      'orphan-attempt',
    )
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'attempt.json'), JSON.stringify(attempt({
      id: 'orphan-attempt',
      workflow_run_id: 'missing-run-record',
      process_id: 'orphan-process',
    })))
    await writeFile(join(directory, 'process.json'), JSON.stringify(processRecord({
      id: 'orphan-process',
      workflow_run_id: 'missing-run-record',
      attempt_id: 'orphan-attempt',
    })))

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toEqual(expect.arrayContaining([
      'Missing run record at missing-run-record/run.json',
      expect.stringContaining('Attempt orphan-attempt is under invalid run missing-run-record'),
      expect.stringContaining('Process orphan-process references invalid attempt orphan-attempt'),
    ]))
    const physical = JSON.parse(await Bun.file(join(directory, 'attempt.json')).text()) as StepAttempt
    expect(physical.status).toBe('running')
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
  }, 30_000)

  test('isolates malformed and mismatched command files while repairing valid receipts', async () => {
    const repos = await repositories()
    await createActiveTree(repos)
    await repos.commands.createOrReplay(receipt({
      id: 'valid-start',
      idempotency_key: 'valid-start-key',
    }))
    await writeFile(await commandRecordPath(repos.basePath, 'malformed-command'), '{not-json')
    await writeFile(
      await commandRecordPath(repos.basePath, 'wrong-file'),
      JSON.stringify(receipt({
        id: 'different-id',
        idempotency_key: 'mismatched-key',
      })),
    )

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Malformed runtime command receipt malformed-command.json'),
      expect.stringContaining('Runtime command receipt identity mismatch at wrong-file.json'),
    ]))
    expect(await repos.commands.get('valid-start')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
    })
  })

  test('fails start receipt when a terminal successful run contradicts an interrupted active attempt', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      status: 'successful',
      ended_at: '2026-07-15T23:59:30.000Z',
    }))
    await repos.attempts.create(attempt())
    await repos.processes.create(processRecord())
    await repos.commands.createOrReplay(receipt({
      id: 'contradictory-start',
      idempotency_key: 'contradictory-start-key',
    }))

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect((await repos.runs.get('run-1'))?.status).toBe('successful')
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('interrupted')
    expect(report.errors).toContain(
      'Run run-1 is terminal as successful but owned active attempt attempt-1 required recovery',
    )
    expect(await repos.commands.get('contradictory-start')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
    })
  })

  test('fails start receipt when a successful run references a missing physical attempt', async () => {
    const repos = await repositories()
    await repos.runs.create(run({
      status: 'successful',
      attempt_ids: ['missing-success-attempt'],
      ended_at: '2026-07-15T23:59:30.000Z',
    }))
    await repos.commands.createOrReplay(receipt({
      id: 'missing-success-start',
      idempotency_key: 'missing-success-start-key',
    }))

    const report = await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect((await repos.runs.get('run-1'))?.status).toBe('successful')
    expect(report.errors).toContain(
      'Run run-1 is terminal as successful but references missing attempt missing-success-attempt',
    )
    expect(await repos.commands.get('missing-success-start')).toMatchObject({
      status: 'failed',
      error_code: 'PROCESS_LOST',
      completed_at: NOW,
    })
  })

  test('keeps planned launch intent while interrupting its active attempt and run', async () => {
    const repos = await repositories()
    await repos.runs.create(run())
    await repos.attempts.create(attempt())
    await repos.processes.create(processRecord({
      status: 'planned',
      provider_handle: null,
      pid: null,
      started_at: null,
    }))

    await reconcileCanonicalRuntime(repos.basePath, { now: () => NOW })

    expect((await repos.processes.get('process-1'))?.status).toBe('planned')
    expect((await repos.attempts.get('attempt-1'))?.status).toBe('interrupted')
    expect((await repos.runs.get('run-1'))?.status).toBe('interrupted')
  })
})
