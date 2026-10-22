import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import {
  createRuntimeProjections,
  inspectRuntimeAttemptProjection,
  inspectRuntimeRunProjection,
  listRuntimeRunProjections,
} from './projections'
import { RunRepository } from './run-repository'
import type { ProcessRecord, StepAttempt, WorkflowRun } from './schema'
import { readThreadSurfaceState, writeThreadSurfaceState } from '../thread-surfaces/repository'
import { readTraceEvents } from '../traces/reader'

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

  for (const scenario of ['legacy', 'no-spawn', 'permitted', 'spoofed-parent'] as const) {
    test(`projects ${scenario} child requests with frozen origin evidence`, async () => {
      const registration = {
        registration_id: 'frozen-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
        builder_id: 'frozen-builder', registered_at: NOW, supersedes_agent_id: 'prior-agent',
        model: 'codex', role: 'orchestrator', prompt_ref: { id: 'prompt', version: 1, path: '.threados/prompts/private.md' },
        skill_refs: scenario === 'no-spawn' ? [] : [{ id: 'spawn', version: 1, capabilities: ['spawn'], path: '.threados/skills/private/SKILL.md' }],
        tools: ['private-tool'], prompt_content_hash: 'b'.repeat(64), skill_content_hashes: [],
      }
      await writeThreadSurfaceState(basePath, { version: 1, threadSurfaces: [{
        id: 'thread-root', parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
        surfaceLabel: 'Root', createdAt: NOW, childSurfaceIds: [], sequenceRef: null, spawnedByAgentId: null,
      }], runs: [], mergeEvents: [], runEvents: [] })
      const attempt = { ...stepAttempt({ status: 'completed', surface_id: 'thread-step-1', process_id: null }),
        ...(scenario === 'legacy' ? {} : { agent_registration: registration }),
      }
      const input = {
        run: workflowRun(), attempt,
        step: { id: 'step-1', name: 'Step', type: 'base' as const, model: 'codex', prompt_file: '.threados/prompts/step-1.md', depends_on: [], status: 'DONE' as const },
        runtimeEvents: [{ eventType: 'spawn-child' as const, createdAt: NOW, childStepId: 'child',
          childLabel: 'Child', spawnKind: 'orchestrator' as const,
          ...(scenario === 'spoofed-parent' ? { parentStepId: 'other-step' } : {}),
        }],
      }
      const projections = createRuntimeProjections(basePath)
      await projections.beginAttempt(input)
      await projections.finalizeAttempt(input)
      await projections.finalizeAttempt(input)
      const state = await readThreadSurfaceState(basePath)
      expect(state.threadSurfaces.some(surface => surface.id === 'thread-child')).toBe(scenario === 'permitted')
      const traces = await readTraceEvents(basePath, input.run.id)
      expect(traces).toHaveLength(1)
      expect(traces[0]).toMatchObject({ attempt_id: attempt.id,
        event_type: scenario === 'permitted' ? 'spawn-child' : 'spawn-denied',
        ...(scenario === 'legacy' ? {} : { agent_registration: {
          registration_id: 'frozen-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
          builder_id: 'frozen-builder', supersedes_agent_id: 'prior-agent', prompt_content_hash: 'b'.repeat(64),
        } }),
      })
      expect(JSON.stringify(traces)).not.toContain('private')
      if (scenario === 'permitted') {
        expect(new Set(state.runs.map(item => item.id)).size).toBe(state.runs.length)
        expect(state.runs.find(item => item.threadSurfaceId === 'thread-child')?.parentRunId).toBe(attempt.id)
        expect(state.threadSurfaces.find(surface => surface.id === 'thread-child')?.registeredAgentId).toBeUndefined()
        const childSequence = await readFile(join(basePath, '.threados/sequences/thread-child/sequence.yaml'), 'utf-8')
        expect(childSequence).not.toContain('frozen-agent')
      }
    })
  }

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

  test('materializes a missing step surface before applying runtime-emitted merge events', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Root',
          createdAt: NOW,
          childSurfaceIds: ['thread-source-a', 'thread-source-b'],
          sequenceRef: null,
          spawnedByAgentId: null,
        },
        {
          id: 'thread-source-a',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'source-a',
          depth: 1,
          surfaceLabel: 'Source A',
          createdAt: NOW,
          childSurfaceIds: [],
          sequenceRef: null,
          spawnedByAgentId: null,
        },
        {
          id: 'thread-source-b',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'source-b',
          depth: 1,
          surfaceLabel: 'Source B',
          createdAt: NOW,
          childSurfaceIds: [],
          sequenceRef: null,
          spawnedByAgentId: null,
        },
      ],
      runs: [
        {
          id: 'run-source-a',
          threadSurfaceId: 'thread-source-a',
          runStatus: 'successful',
          startedAt: NOW,
          endedAt: NOW,
          executionIndex: 1,
          parentRunId: null,
          childIndex: null,
        },
        {
          id: 'run-source-b',
          threadSurfaceId: 'thread-source-b',
          runStatus: 'successful',
          startedAt: NOW,
          endedAt: NOW,
          executionIndex: 2,
          parentRunId: null,
          childIndex: null,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })
    const run = workflowRun({
      id: 'workflow-merge',
      status: 'running',
      attempt_ids: ['attempt-merge'],
      ended_at: null,
    })
    const attempt = stepAttempt({
      id: 'attempt-merge',
      workflow_run_id: run.id,
      step_id: 'synth',
      surface_id: 'thread-synth',
      status: 'completed',
      process_id: null,
      ended_at: NOW,
      exit_code: 0,
      error_code: null,
      error_message: null,
    })

    await createRuntimeProjections(basePath).finalizeAttempt({
      run,
      attempt,
      step: {
        id: 'synth',
        name: 'Synthesis',
        type: 'f',
        model: 'codex',
        prompt_file: '.threados/prompts/synth.md',
        depends_on: ['source-a', 'source-b'],
        status: 'RUNNING',
        fusion_synth: true,
      },
      runtimeEvents: [{
        eventType: 'merge-into',
        createdAt: NOW,
        destinationStepId: 'synth',
        sourceStepIds: ['source-a', 'source-b'],
        mergeKind: 'block',
        summary: 'Merged by runtime event',
      }],
    })

    const state = await readThreadSurfaceState(basePath)
    expect(state.threadSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-synth' }),
    ]))
    expect(state.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'attempt-merge',
        workflowRunId: 'workflow-merge',
        attemptId: 'attempt-merge',
      }),
    ]))
    expect(state.mergeEvents).toEqual([
      expect.objectContaining({
        destinationThreadSurfaceId: 'thread-synth',
        sourceRunIds: ['run-source-a', 'run-source-b'],
        summary: 'Merged by runtime event',
      }),
    ])
  })

  test('projects an isolated workspace onto only the attempt RunScope and preserves it at terminal finalization', async () => {
    const step = {
      id: 'step-1',
      name: 'Step 1',
      type: 'base' as const,
      model: 'codex',
      prompt_file: '.threados/prompts/step-1.md',
      depends_on: [],
      status: 'RUNNING' as const,
    }
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [{
        id: 'thread-root',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Root',
        createdAt: NOW,
        childSurfaceIds: [],
        sequenceRef: null,
        spawnedByAgentId: null,
      }],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })
    const run = workflowRun({ status: 'running', ended_at: null })
    const provisioningAttempt = stepAttempt({
      status: 'provisioning',
      process_id: null,
      workspace_id: 'workspace-1',
      baseline_snapshot_id: 'snapshot-1',
      ended_at: null,
      error_code: null,
      error_message: null,
    })
    const projections = createRuntimeProjections(basePath)

    await projections.beginAttempt({ run, attempt: provisioningAttempt, step })
    await projections.bindAttemptWorkspace!({
      run,
      attempt: provisioningAttempt,
      step,
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      provider: 'copy',
      isolationLabel: 'THREADOS_SCOPED',
    })

    const bound = await readThreadSurfaceState(basePath)
    expect(bound.runs).toContainEqual(expect.objectContaining({
      id: 'attempt-v2',
      workflowRunId: 'run-v2',
      attemptId: 'attempt-v2',
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      provider: 'copy',
      isolationLabel: 'THREADOS_SCOPED',
      endedAt: null,
    }))
    const stepSurface = bound.threadSurfaces.find(surface => surface.id === 'thread-step-1')
    expect(stepSurface).toBeDefined()
    expect(stepSurface).not.toHaveProperty('workspaceId')
    expect(stepSurface).not.toHaveProperty('snapshotId')
    expect(stepSurface).not.toHaveProperty('provider')
    expect(stepSurface?.isolationLabel).toBe('NONE')

    const completedAttempt = stepAttempt({
      ...provisioningAttempt,
      status: 'completed',
      ended_at: NOW,
      exit_code: 0,
    })
    await projections.finalizeAttempt({ run, attempt: completedAttempt, step, runtimeEvents: [] })

    const finalized = await readThreadSurfaceState(basePath)
    expect(finalized.runs).toContainEqual(expect.objectContaining({
      id: 'attempt-v2',
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      provider: 'copy',
      isolationLabel: 'THREADOS_SCOPED',
      runStatus: 'successful',
      endedAt: NOW,
    }))
  })
})
