import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { processRecordPath } from './paths'
import { ProcessRepository } from './process-repository'
import { reconcileCanonicalRuntime } from './recovery'
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
    expect((await repos.processes.get('process-1'))?.status).toBe('lost')
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
})
