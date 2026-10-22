import { appendTraceEvent } from '@/lib/traces/writer'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateExportBundle } from './bundler'
import type { TraceEvent, GateDecision } from '@/lib/contracts/schemas'
import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { RunRepository } from '@/lib/runtime/run-repository'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { SnapshotRepository } from '@/lib/workspaces/snapshot-repository'
import { WorkspaceRepository } from '@/lib/workspaces/repository'
import { createSnapshotManifest } from '@/lib/workspaces/manifest'
import { hashSha256Bytes } from '@/lib/workspaces/hash'
import { ExportBundleSchema } from './schema'
import { writeAgentState } from '@/lib/agents/repository'

const makeTraceEvent = (overrides: Partial<TraceEvent> = {}): TraceEvent => ({
  ts: '2026-03-29T00:00:00.000Z',
  run_id: 'run-test-1',
  surface_id: 'surface-001',
  actor: 'threados',
  event_type: 'step-started',
  payload_ref: null,
  policy_ref: null,
  ...overrides,
})

const makeGateDecision = (overrides: Partial<GateDecision> = {}): GateDecision => ({
  id: 'decision-1',
  subject_type: 'step',
  subject_ref: 'step-abc',
  gate_type: 'policy_pass',
  status: 'PASS',
  reason_codes: [],
  evidence_refs: [],
  decided_by: 'threados',
  decided_at: '2026-03-29T00:00:00.000Z',
  ...overrides,
})

describe('generateExportBundle', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-export-bundler-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('generates a bundle from run artifacts — verify trace_events and gate_decisions', async () => {
    const runId = 'run-test-1'

    // Set up .threados/sequence.yaml
    const threadsosDir = join(basePath, '.threados')
    await mkdir(threadsosDir, { recursive: true })
    await writeFile(join(threadsosDir, 'sequence.yaml'), 'id: test-sequence\nsteps: []\n', 'utf-8')

    // Set up run directory with trace and gate-decision NDJSON files
    const runDir = join(basePath, '.threados/runs', runId)
    await mkdir(runDir, { recursive: true })
    await mkdir(join(runDir, 'step-abc'), { recursive: true })
    await mkdir(join(runDir, 'private-client-name'), { recursive: true })
    await writeFile(join(runDir, 'private-client-name', 'agent.txt'), 'fixture', 'utf-8')

    const traceEvent = makeTraceEvent({ run_id: runId })
    await writeFile(join(runDir, 'trace.ndjson'), JSON.stringify(traceEvent) + '\n', 'utf-8')

    const gateDecision = makeGateDecision()
    await writeFile(join(runDir, 'gate-decisions.ndjson'), JSON.stringify(gateDecision) + '\n', 'utf-8')
    await writeFile(join(runDir, 'step-abc', 'status.json'), JSON.stringify({
      stepId: 'step-abc',
      runId,
      startTime: '2026-03-29T00:00:00.000Z',
      endTime: '2026-03-29T00:00:10.000Z',
      duration: 10_000,
      exitCode: 0,
      status: 'SUCCESS',
    }, null, 2), 'utf-8')
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        {
          id: 'surface-001',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Surface 001',
          createdAt: '2026-03-29T00:00:00.000Z',
          childSurfaceIds: [],
          sequenceRef: null,
          spawnedByAgentId: null,
          surfaceClass: 'shared',
          visibility: 'dependency',
          isolationLabel: 'NONE',
          revealState: null,
          allowedReadScopes: [],
          allowedWriteScopes: [],
        },
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const bundle = await generateExportBundle(basePath, runId)

    expect(bundle.bundle_version).toBe('1.0')
    expect(bundle.run_id).toBe(runId)
    expect(bundle.pack).toEqual({ id: null, version: null })
    expect(bundle.sequence_snapshot).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(JSON.stringify(bundle)).not.toContain('test-sequence')
    expect(bundle.policy_snapshot).toBeNull()
    expect(bundle.surfaces).toEqual([])
    expect(bundle.artifact_manifests).toEqual([
      `.threados/runs/${runId}/gate-decisions.ndjson`,
      `.threados/runs/${runId}/private-client-name/agent.txt`,
      `.threados/runs/${runId}/step-abc/status.json`,
      `.threados/runs/${runId}/trace.ndjson`,
    ].map(hashSha256Bytes))
    expect(JSON.stringify(bundle)).not.toContain('private-client-name')
    expect(bundle.timing_summary).toEqual({
      stepCount: 1,
      totalDurationMs: 10_000,
      longestStepMs: 10_000,
      failedSteps: 0,
      successfulSteps: 1,
      startedAt: '2026-03-29T00:00:00.000Z',
      endedAt: '2026-03-29T00:00:10.000Z',
    })
    expect(bundle.cost_summary).toBeNull()
    expect(typeof bundle.exported_at).toBe('string')

    expect(bundle.trace_events).toHaveLength(1)
    expect(bundle.trace_events[0].run_id).toBe(runId)
    expect(bundle.trace_events[0].event_type).toBe('step-started')
    expect(bundle.trace_events[0].actor).toBe('threados')

    expect(bundle.gate_decisions).toHaveLength(1)
    expect(bundle.gate_decisions[0].id).toBe('decision-1')
    expect(bundle.gate_decisions[0].status).toBe('PASS')
    expect(bundle.gate_decisions[0].gate_type).toBe('policy_pass')

    expect(bundle.approvals).toEqual([])
  })

  test('handles missing trace file gracefully — empty arrays returned', async () => {
    const runId = 'run-no-artifacts'

    // Set up only sequence.yaml, no run artifacts
    const threadsosDir = join(basePath, '.threados')
    await mkdir(threadsosDir, { recursive: true })
    await writeFile(join(threadsosDir, 'sequence.yaml'), 'id: minimal-sequence\nsteps: []\n', 'utf-8')

    const bundle = await generateExportBundle(basePath, runId)

    expect(bundle.bundle_version).toBe('1.0')
    expect(bundle.run_id).toBe(runId)
    expect(bundle.sequence_snapshot).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(JSON.stringify(bundle)).not.toContain('minimal-sequence')
    expect(bundle.surfaces).toEqual([])
    expect(bundle.trace_events).toEqual([])
    expect(bundle.gate_decisions).toEqual([])
    expect(bundle.approvals).toEqual([])
    expect(bundle.workflow_run).toBeNull()
    expect(bundle.processes).toEqual([])
    expect(bundle.snapshots).toEqual([])
    expect(bundle.workspaces).toEqual([])
    expect(bundle.artifact_manifests).toEqual([])
    expect(bundle.timing_summary).toBeNull()
  })

  test.each(['C:\\private\\bin\\secret=private.exe', '/private/bin/secret=private.exe'])(
  'adds redacted M1 runtime, process, snapshot, and workspace evidence (%s)', async commandPath => {
    const runId = 'run-m1-export'
    const attemptId = 'attempt-m1-export'
    const snapshotId = 'snapshot-m1-export'
    const workspaceId = 'workspace-m1-export'
    const timestamp = '2026-09-28T00:00:00.000Z'
    const digest = `sha256:${'a'.repeat(64)}`
    const frozenRegistration = {
      registration_id: 'registered-export-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
      builder_id: 'builder-export', registered_at: timestamp, supersedes_agent_id: 'prior-agent',
      model: 'codex', role: 'builder', prompt_ref: { id: 'private-prompt', version: 1, path: 'C:/private/prompt.md' },
      skill_refs: [{ id: 'private-skill', version: 1, path: 'C:/private/skill.md', capabilities: ['files'] }],
      tools: ['private-tool-command'], prompt_content_hash: 'b'.repeat(64),
      skill_content_hashes: [{ id: 'private-skill', version: 1, content_hash: 'c'.repeat(64) }],
    }
    const manifest = createSnapshotManifest(snapshotId, [{
      path: 'source.txt',
      kind: 'file',
      sha256: digest,
      size_bytes: 7,
      mode: 0o644,
      symlink_target: null,
    }])
    const run = {
      schema_version: 2 as const,
      id: runId,
      revision: 0,
      sequence_id: 'sequence-m1',
      sequence_snapshot_hash: digest,
      target: { kind: 'step' as const, step_id: 'step-m1' },
      strategy: 'sequential' as const,
      status: 'successful' as const,
      max_concurrency: 1,
      policy_snapshot_hash: digest,
      baseline_snapshot_id: snapshotId,
      attempt_ids: [attemptId],
      agent_registrations: { 'step-m1': frozenRegistration },
      created_by: 'test',
      created_via: 'system' as const,
      created_at: timestamp,
      started_at: timestamp,
      ended_at: timestamp,
      cancellation_requested_at: null,
      summary: null,
      error_code: null,
      error_message: null,
    }
    const attempt = {
      schema_version: 2 as const,
      id: attemptId,
      revision: 0,
      workflow_run_id: runId,
      sequence_id: run.sequence_id,
      step_id: 'step-m1',
      surface_id: 'surface-m1',
      execution_index: 1,
      attempt_number: 1,
      retry_of_attempt_id: null,
      status: 'completed' as const,
      agent_ref: frozenRegistration.registration_id,
      agent_registration: frozenRegistration,
      model: 'fixture',
      side_effect_class: 'write' as const,
      baseline_snapshot_id: snapshotId,
      workspace_id: workspaceId,
      process_id: 'process-m1-export',
      compiled_prompt_hash: digest,
      input_manifest_ref: null,
      output_manifest_ref: null,
      artifact_manifest_ref: null,
      change_set_id: null,
      gate_decision_refs: [],
      created_at: timestamp,
      started_at: timestamp,
      ended_at: timestamp,
      last_heartbeat_at: timestamp,
      exit_code: 0,
      signal: null,
      duration_ms: 1,
      error_code: null,
      error_message: null,
    }
    await new RunRepository(basePath).create(run)
    await new AttemptRepository(basePath).create(attempt)
    await new ProcessRepository(basePath).create({
      schema_version: 1,
      id: 'process-m1-export',
      revision: 0,
      workflow_run_id: runId,
      attempt_id: attemptId,
      provider: 'local-process',
      provider_handle: 'token=legacy-private',
      pid: 1234,
      command: commandPath,
      redacted_args: [
        '--workspace',
        'C:\\private\\runtime\\workspace-m1-export',
        '/private/runtime/workspace-m1-export',
        '--embedded=C:\\PRIVATE\\other-root',
        'token=private-value',
      ],
      environment_keys: ['THREADOS_WORKSPACE_ID'],
      cwd: 'C:\\private\\runtime\\workspace-m1-export',
      status: 'exited',
      launch_requested_at: timestamp,
      started_at: timestamp,
      ended_at: timestamp,
      last_output_at: timestamp,
      last_heartbeat_at: timestamp,
      cancellation_requested_at: null,
      exit_code: 0,
      signal: null,
    })
    await new SnapshotRepository(basePath).create({
      schema_version: 1,
      id: snapshotId,
      local_workspace_id: 'local-m1',
      workflow_run_id: runId,
      source_root: 'C:\\private\\canonical',
      content_root: 'C:\\private\\runtime\\snapshot-m1-export',
      manifest_ref: `.threados/snapshots/${snapshotId}/manifest.json`,
      status: 'ready',
      root_manifest_hash: manifest.root_manifest_hash,
      exclusion_policy_hash: digest,
      file_count: 1,
      total_bytes: 7,
      git_head: null,
      git_dirty: null,
      created_at: timestamp,
      verified_at: timestamp,
      error_code: null,
      directory_count: 0,
      symlink_count: 0,
      blocked_symlink_paths: [],
      source_retry_count: 0,
    }, manifest)
    await new WorkspaceRepository(basePath).create({
      schema_version: 1,
      id: workspaceId,
      revision: 0,
      workflow_run_id: runId,
      attempt_id: attemptId,
      surface_id: attempt.surface_id,
      snapshot_id: snapshotId,
      provider: 'copy',
      isolation_label: 'THREADOS_SCOPED',
      root_path: 'C:\\private\\runtime\\workspace-m1-export',
      status: 'retained',
      retention_policy: 'retain_until_applied',
      manifest_hash: manifest.root_manifest_hash,
      file_count: 1,
      total_bytes: 7,
      reserved_bytes: 7,
      created_at: timestamp,
      ready_at: timestamp,
      cleaned_at: null,
      error_code: null,
    })

    await writeAgentState(basePath, { version: 1, agents: [{
      id: frozenRegistration.registration_id, name: 'Later live registration', version: 99,
      registeredAt: timestamp, builderId: 'changed-builder', builderName: 'Changed', threadSurfaceIds: [],
    }] })
    await writeFile(join(basePath, '.threados/runs', runId, 'trace.ndjson'), JSON.stringify(makeTraceEvent({
      run_id: runId, event_type: 'snapshot-created',
      agent_registrations: { 'C:/private/step': {
        registration_id: frozenRegistration.registration_id, registration_version: 2,
        composition_hash: frozenRegistration.composition_hash, builder_id: 'C:/private/builder',
        supersedes_agent_id: null, prompt_content_hash: frozenRegistration.prompt_content_hash,
      } },
    })) + '\n')
    const bundle = await generateExportBundle(basePath, runId)

    const registrationEvidence = {
      registration_id: 'registered-export-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
      builder_id: 'builder-export', supersedes_agent_id: 'prior-agent', prompt_content_hash: 'b'.repeat(64),
    }
    expect(bundle.workflow_run).toEqual({ ...run, agent_registrations: { 'step-m1': registrationEvidence } })
    expect(bundle.attempts).toEqual([{ ...attempt, agent_registration: registrationEvidence }])
    expect(bundle.processes).toHaveLength(1)
    expect(bundle.processes[0]?.cwd).toBe('[redacted]')
    expect(bundle.attempts[0]?.agent_registration).toEqual({
      registration_id: 'registered-export-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
      builder_id: 'builder-export', supersedes_agent_id: 'prior-agent', prompt_content_hash: 'b'.repeat(64),
    })
    expect(JSON.stringify(bundle.attempts)).not.toContain('private')
    expect(JSON.stringify(bundle.workflow_run)).not.toContain('private')
    expect(ExportBundleSchema.parse(bundle).attempts[0]?.agent_registration).toEqual(registrationEvidence)
    expect(bundle.trace_events[0]?.agent_registrations).toEqual({ [hashSha256Bytes('C:/private/step')]: {
      ...registrationEvidence, builder_id: hashSha256Bytes('C:/private/builder'), supersedes_agent_id: null,
    } })
    expect(bundle.processes[0]?.provider_handle).toBe('token=[REDACTED]')
    expect(bundle.processes[0]?.command).toBe('secret=[REDACTED]')
    expect(bundle.processes[0]?.redacted_args).toEqual([
      '--workspace',
      '[redacted]',
      '[redacted]',
      '--embedded=[redacted]',
      'token=[REDACTED]',
    ])
    expect(JSON.stringify(bundle)).not.toContain('private-value')
    expect(JSON.stringify(bundle)).not.toContain('legacy-private')
    expect(bundle.snapshots).toHaveLength(1)
    expect(bundle.snapshots[0]?.record).toMatchObject({
      source_root: '[redacted]',
      content_root: '[redacted]',
      root_manifest_hash: manifest.root_manifest_hash,
    })
    expect(bundle.snapshots[0]?.manifest).toMatchObject({
      snapshot_id: snapshotId,
      root_manifest_hash: manifest.root_manifest_hash,
      entries: [{
        path_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        symlink_target_sha256: null,
      }],
    })
    expect(JSON.stringify(bundle.snapshots)).not.toContain('source.txt')
    expect(bundle.workspaces).toHaveLength(1)
    expect(bundle.workspaces[0]).toMatchObject({
      root_path: '[redacted]',
      manifest_hash: manifest.root_manifest_hash,
      isolation_label: 'THREADOS_SCOPED',
    })
    expect(JSON.stringify(bundle)).not.toContain('C:\\\\private')
  })

  test('fails closed when a V2 run references missing snapshot evidence', async () => {
    const timestamp = '2026-09-28T00:00:00.000Z'
    const digest = `sha256:${'b'.repeat(64)}`
    await new RunRepository(basePath).create({
      schema_version: 2,
      id: 'run-missing-snapshot',
      revision: 0,
      sequence_id: 'sequence-missing-snapshot',
      sequence_snapshot_hash: digest,
      target: { kind: 'step', step_id: 'step-missing-snapshot' },
      strategy: 'sequential',
      status: 'failed',
      max_concurrency: 1,
      policy_snapshot_hash: digest,
      baseline_snapshot_id: 'snapshot-not-present',
      attempt_ids: [],
      created_by: 'test',
      created_via: 'system',
      created_at: timestamp,
      started_at: timestamp,
      ended_at: timestamp,
      cancellation_requested_at: null,
      summary: null,
      error_code: 'SNAPSHOT_NOT_FOUND',
      error_message: 'missing fixture snapshot',
    })

    await expect(generateExportBundle(basePath, 'run-missing-snapshot'))
      .rejects.toThrow('EXPORT_SNAPSHOT_EVIDENCE_MISSING')
  })

  test('redacts private paths in run evidence and excludes an unrelated sealed surface', async () => {
    const runId = 'run-private-export'
    const runDir = join(basePath, '.threados', 'runs', runId)
    const privatePath = 'C:\\private\\sibling\\secret.txt'
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'trace.ndjson'), `${JSON.stringify(makeTraceEvent({
      run_id: runId,
      actor: privatePath,
      payload_ref: privatePath,
      surface_id: 'surface-own',
    }))}\n`)
    await writeFile(join(runDir, 'gate-decisions.ndjson'), `${JSON.stringify(makeGateDecision({
      evidence_refs: [privatePath],
    }))}\n`)
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [{
        id: 'surface-own', parentSurfaceId: null, parentAgentNodeId: null,
        depth: 0, surfaceLabel: 'Own run surface', createdAt: '2026-09-28T00:00:00.000Z',
        childSurfaceIds: [], sequenceRef: null, spawnedByAgentId: null,
      }, {
        id: 'surface-sealed-sibling', parentSurfaceId: null, parentAgentNodeId: null,
        depth: 0, surfaceLabel: 'SEALED_SIBLING_SENTINEL',
        surfaceDescription: 'SEALED_SIBLING_DESCRIPTION_SENTINEL',
        createdAt: '2026-09-28T00:00:00.000Z', childSurfaceIds: [],
        sequenceRef: null, spawnedByAgentId: null,
        surfaceClass: 'sealed', visibility: 'self_only', revealState: 'sealed',
      }],
      runs: [{
        id: runId, threadSurfaceId: 'surface-own', runStatus: 'successful',
        startedAt: '2026-09-28T00:00:00.000Z', endedAt: '2026-09-28T00:00:01.000Z',
        parentRunId: null, childIndex: null,
      }], mergeEvents: [], runEvents: [],
    })

    const bundle = await generateExportBundle(basePath, runId)
    expect(bundle.surfaces).toHaveLength(1)
    expect(JSON.stringify(bundle)).not.toContain(privatePath)
    expect(JSON.stringify(bundle)).not.toContain('SEALED_SIBLING_SENTINEL')
    expect(JSON.stringify(bundle)).not.toContain('SEALED_SIBLING_DESCRIPTION_SENTINEL')
  })

  test('fails closed when a V2 run record disappears but its attempt evidence remains', async () => {
    const runId = 'run-lost-record'
    const timestamp = '2026-09-28T00:00:00.000Z'
    const digest = `sha256:${'a'.repeat(64)}`
    await new RunRepository(basePath).create({
      schema_version: 2, id: runId, revision: 0, sequence_id: 'sequence-lost',
      sequence_snapshot_hash: digest, target: { kind: 'step', step_id: 'step-lost' },
      strategy: 'sequential', status: 'failed', max_concurrency: 1,
      policy_snapshot_hash: digest, baseline_snapshot_id: null, attempt_ids: ['attempt-lost'],
      created_by: 'test', created_via: 'system', created_at: timestamp,
      started_at: timestamp, ended_at: timestamp, cancellation_requested_at: null,
      summary: null, error_code: 'PROCESS_LOST', error_message: 'fixture',
    })
    await new AttemptRepository(basePath).create({
      schema_version: 2, id: 'attempt-lost', revision: 0, workflow_run_id: runId,
      sequence_id: 'sequence-lost', step_id: 'step-lost', surface_id: 'surface-lost',
      execution_index: 1, attempt_number: 1, retry_of_attempt_id: null,
      status: 'failed', agent_ref: null, model: 'fixture', side_effect_class: 'write',
      baseline_snapshot_id: null, workspace_id: null, process_id: null,
      compiled_prompt_hash: digest, input_manifest_ref: null, output_manifest_ref: null,
      artifact_manifest_ref: null, change_set_id: null, gate_decision_refs: [],
      created_at: timestamp, started_at: timestamp, ended_at: timestamp,
      last_heartbeat_at: null, exit_code: null, signal: null, duration_ms: null,
      error_code: 'PROCESS_LOST', error_message: 'fixture',
    })
    await unlink(join(basePath, '.threados', 'runs', runId, 'run.json'))

    await expect(generateExportBundle(basePath, runId)).rejects.toThrow('EXPORT_RUN_EVIDENCE_MISSING')
  })

  test.each(['C:/private', '/private'])(
    'exports frozen registration evidence without identity paths or tool payloads (%s)', async privateRoot => {
      const now = '2026-10-22T00:00:00.000Z'
      const runId = 'run-identity'
      const attemptId = 'attempt-identity'
      const registration = {
        registration_id: `${privateRoot}/agent`, registration_version: 2,
        composition_hash: 'a'.repeat(64), builder_id: `${privateRoot}/builder`, registered_at: now,
        supersedes_agent_id: `${privateRoot}/prior`, model: 'codex', role: 'builder',
        prompt_ref: { id: 'private-prompt', version: 1, path: `${privateRoot}/prompt.md` },
        skill_refs: [{ id: 'private-skill', version: 1, capabilities: ['files'], path: `${privateRoot}/SKILL.md` }],
        tools: ['private-tool-payload'], prompt_content_hash: 'b'.repeat(64),
        skill_content_hashes: [{ id: 'private-skill', version: 1, content_hash: 'c'.repeat(64) }],
      }
      await new RunRepository(basePath).create({
        schema_version: 2, id: runId, revision: 0, sequence_id: 'sequence', sequence_snapshot_hash: 'sequence-digest',
        target: { kind: 'runnable' }, strategy: 'sequential', status: 'successful', max_concurrency: 1,
        policy_snapshot_hash: 'policy-digest', baseline_snapshot_id: null, attempt_ids: [attemptId],
        agent_registrations: { step: registration, [`${privateRoot}/step`]: registration }, created_by: 'operator', created_via: 'api',
        created_at: now, started_at: now, ended_at: now, cancellation_requested_at: null,
        summary: null, error_code: null, error_message: null,
      })
      await new AttemptRepository(basePath).create({
        schema_version: 2, id: attemptId, revision: 0, workflow_run_id: runId, sequence_id: 'sequence', step_id: 'step',
        surface_id: 'surface', execution_index: 1, attempt_number: 1, retry_of_attempt_id: null,
        status: 'completed', agent_ref: registration.registration_id, agent_registration: registration, model: 'codex',
        side_effect_class: 'execute', baseline_snapshot_id: null, workspace_id: null, process_id: null,
        compiled_prompt_hash: 'compiled-digest', input_manifest_ref: null, output_manifest_ref: null,
        artifact_manifest_ref: null, change_set_id: null, gate_decision_refs: [],
        created_at: now, started_at: now, ended_at: now, last_heartbeat_at: now,
        exit_code: 0, signal: null, duration_ms: 1, error_code: null, error_message: null,
      })
      await appendTraceEvent(basePath, runId, {
        ts: now, run_id: runId, surface_id: 'thread-root', actor: 'runtime', event_type: 'snapshot-created',
        payload_ref: null, policy_ref: null,
      })
      await appendTraceEvent(basePath, runId, {
        ts: now, run_id: runId, surface_id: 'surface', actor: 'runtime', event_type: 'step-started',
        payload_ref: attemptId, policy_ref: null, attempt_id: attemptId,
      })
      // Export must preserve persisted evidence after the live registry changes.
      await writeAgentState(basePath, { version: 1, agents: [{ id: 'replacement', name: 'Later registration',
        builderId: 'later-builder', builderName: 'Later', registeredAt: now, threadSurfaceIds: [], version: 99 }] })
      const bundle = ExportBundleSchema.parse(await generateExportBundle(basePath, runId))
      const expected = { registration_id: hashSha256Bytes(registration.registration_id), registration_version: 2,
        composition_hash: 'a'.repeat(64), builder_id: hashSha256Bytes(registration.builder_id),
        supersedes_agent_id: hashSha256Bytes(registration.supersedes_agent_id), prompt_content_hash: 'b'.repeat(64) }
      expect(bundle.attempts[0]?.agent_registration).toEqual(expected)
      expect(bundle.attempts[0]?.agent_ref).toBe(expected.registration_id)
      const expectedRegistrations = { step: expected, [hashSha256Bytes(`${privateRoot}/step`)]: expected }
      expect(bundle.workflow_run?.agent_registrations).toEqual(expectedRegistrations)
      expect(bundle.trace_events[0]?.agent_registrations).toEqual(expectedRegistrations)
      expect(bundle.trace_events[1]?.agent_registration).toEqual(expected)
      expect(JSON.stringify(bundle)).not.toContain(privateRoot)
      expect(JSON.stringify(bundle)).not.toContain('private-tool-payload')
      expect(JSON.stringify(bundle.attempts[0]?.agent_registration)).not.toContain('prompt_ref')
      expect(JSON.stringify(bundle.attempts[0]?.agent_registration)).not.toContain('skill_refs')
    },
  )

  test('rejects run ids that are not file-safe identifiers', async () => {
    await expect(generateExportBundle(basePath, '../escape')).rejects.toThrow('runId must be a file-safe identifier')
  })

  test('rejects an escaping sequence snapshot symlink', async () => {
    const threadosDir = join(basePath, '.threados')
    await mkdir(threadosDir, { recursive: true })
    const outsideSequence = join(basePath, 'outside-sequence.yaml')
    await writeFile(outsideSequence, 'id: EXTERNAL_SEQUENCE\nsteps: []\n')
    await symlink(outsideSequence, join(threadosDir, 'sequence.yaml'), 'file')

    await expect(generateExportBundle(basePath, 'run-safe')).rejects.toThrow()
  })

  test('rejects an escaping policy snapshot symlink', async () => {
    const threadosDir = join(basePath, '.threados')
    await mkdir(threadosDir, { recursive: true })
    await writeFile(join(threadosDir, 'sequence.yaml'), 'id: safe\nsteps: []\n')
    const outsidePolicy = join(basePath, 'outside-policy.yaml')
    await writeFile(outsidePolicy, 'export_mode: local_bundle\nsecret: EXTERNAL_POLICY\n')
    await symlink(outsidePolicy, join(threadosDir, 'policy.yaml'), 'file')

    await expect(generateExportBundle(basePath, 'run-safe')).rejects.toThrow()
  })
})
