import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import {
  inspectRuntimeAttemptProjection,
  inspectRuntimeRunProjection,
  listRuntimeRunProjections,
} from './projections'
import { RunRepository } from './run-repository'
import type { ProcessRecord, StepAttempt, WorkflowRun } from './schema'

const NOW = '2026-07-16T00:00:00.000Z'

function workflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    schema_version: 2,
    id: 'run-v2',
    revision: 0,
    sequence_id: 'sequence-1',
    sequence_snapshot_hash: 'sha256:sequence',
    target: { kind: 'step', step_id: 'step-1' },
    strategy: 'sequential',
    status: 'interrupted',
    max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy',
    baseline_snapshot_id: null,
    attempt_ids: ['attempt-v2'],
    created_by: 'operator',
    created_via: 'api',
    created_at: NOW,
    started_at: NOW,
    ended_at: NOW,
    cancellation_requested_at: null,
    summary: null,
    error_code: 'PROCESS_LOST',
    error_message: 'process evidence disappeared',
    ...overrides,
  }
}

function stepAttempt(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    schema_version: 2,
    id: 'attempt-v2',
    revision: 0,
    workflow_run_id: 'run-v2',
    sequence_id: 'sequence-1',
    step_id: 'step-1',
    surface_id: 'surface-1',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status: 'interrupted',
    agent_ref: null,
    model: 'codex',
    side_effect_class: 'execute',
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: 'process-v2',
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null,
    output_manifest_ref: null,
    artifact_manifest_ref: null,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: NOW,
    started_at: NOW,
    ended_at: NOW,
    last_heartbeat_at: NOW,
    exit_code: null,
    signal: null,
    duration_ms: 10,
    error_code: 'PROCESS_LOST',
    error_message: 'process evidence disappeared',
    ...overrides,
  }
}

function processRecord(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    schema_version: 1,
    id: 'process-v2',
    revision: 0,
    workflow_run_id: 'run-v2',
    attempt_id: 'attempt-v2',
    provider: 'local-process',
    provider_handle: null,
    pid: 1234,
    command: 'agent',
    redacted_args: [],
    environment_keys: [],
    cwd: 'C:\\runtime\\surface-1',
    status: 'lost',
    launch_requested_at: NOW,
    started_at: NOW,
    ended_at: NOW,
    last_output_at: NOW,
    last_heartbeat_at: NOW,
    cancellation_requested_at: null,
    exit_code: null,
    signal: null,
    ...overrides,
  }
}

describe('operator runtime projections', () => {
  let basePath: string
  let repositories: {
    runs: RunRepository
    attempts: AttemptRepository
    processes: ProcessRepository
    commands: CommandRepository
  }

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-projections-'))
    repositories = {
      runs: new RunRepository(basePath),
      attempts: new AttemptRepository(basePath),
      processes: new ProcessRepository(basePath),
      commands: new CommandRepository(basePath),
    }
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('lists V2 and legacy runs with explicit source metadata without rewriting legacy bytes', async () => {
    await repositories.runs.create(workflowRun())
    await repositories.attempts.create(stepAttempt())
    await repositories.processes.create(processRecord())

    const legacy = {
      id: 'legacy-run',
      sequence_id: 'sequence-1',
      step_id: 'step-legacy',
      surface_id: 'surface-legacy',
      attempt: 1,
      status: 'successful',
      executor: 'threados',
      model: 'codex',
      policy_snapshot_hash: 'sha256:legacy-policy',
      compiled_prompt_hash: 'sha256:legacy-prompt',
      input_manifest_ref: null,
      artifact_manifest_ref: null,
      started_at: NOW,
      ended_at: NOW,
      timing_summary: { duration_ms: 20 },
      cost_summary: null,
    }
    const legacyDir = join(basePath, '.threados', 'runs', legacy.id)
    await mkdir(legacyDir, { recursive: true })
    const legacyPath = join(legacyDir, 'run.json')
    const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(legacyPath, legacyBytes, 'utf8')

    const projections = await listRuntimeRunProjections(basePath, repositories, {
      sequenceId: 'sequence-1',
    })

    expect(projections.map(item => ({
      id: item.run.id,
      source: item.source,
      schemaVersion: item.schemaVersion,
      attempts: item.attempts.map(attempt => attempt.id),
    }))).toEqual([
      {
        id: 'legacy-run',
        source: 'legacy',
        schemaVersion: 1,
        attempts: ['legacy-run:attempt:1'],
      },
      {
        id: 'run-v2',
        source: 'v2',
        schemaVersion: 2,
        attempts: ['attempt-v2'],
      },
    ])
    expect(await readFile(legacyPath, 'utf8')).toBe(legacyBytes)
  })

  test('inspects interrupted attempt and lost process state without collapsing either status', async () => {
    await repositories.runs.create(workflowRun())
    await repositories.attempts.create(stepAttempt())
    await repositories.processes.create(processRecord())

    const run = await inspectRuntimeRunProjection(basePath, repositories, 'run-v2')
    const attempt = await inspectRuntimeAttemptProjection(basePath, repositories, 'attempt-v2')

    expect(run).toMatchObject({
      source: 'v2',
      schemaVersion: 2,
      run: { id: 'run-v2', status: 'interrupted' },
      attempts: [{ id: 'attempt-v2', status: 'interrupted' }],
    })
    expect(attempt).toMatchObject({
      source: 'v2',
      schemaVersion: 2,
      attempt: { id: 'attempt-v2', status: 'interrupted' },
      process: { id: 'process-v2', status: 'lost', pid: 1234 },
    })
  })

  test('inspects projected legacy attempts as read-only records with no process evidence', async () => {
    const legacy = {
      id: 'legacy-run',
      sequence_id: 'sequence-legacy',
      step_id: 'step-legacy',
      surface_id: 'surface-legacy',
      attempt: 3,
      status: 'failed',
      executor: 'threados',
      model: 'codex',
      policy_snapshot_hash: 'sha256:legacy-policy',
      compiled_prompt_hash: 'sha256:legacy-prompt',
      input_manifest_ref: null,
      artifact_manifest_ref: null,
      started_at: NOW,
      ended_at: NOW,
      timing_summary: { duration_ms: 20 },
      cost_summary: null,
    }
    const legacyDir = join(basePath, '.threados', 'runs', legacy.id)
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'run.json'), JSON.stringify(legacy), 'utf8')

    const attempt = await inspectRuntimeAttemptProjection(
      basePath,
      repositories,
      'legacy-run:attempt:3',
    )

    expect(attempt).toMatchObject({
      source: 'legacy',
      schemaVersion: 1,
      attempt: {
        id: 'legacy-run:attempt:3',
        workflow_run_id: 'legacy-run',
        status: 'failed',
      },
      process: null,
    })
  })
})
