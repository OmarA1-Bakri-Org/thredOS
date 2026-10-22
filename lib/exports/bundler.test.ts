import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateExportBundle } from './bundler'
import type { TraceEvent, GateDecision } from '@/lib/contracts/schemas'
import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { RunRepository } from '@/lib/runtime/run-repository'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import { writeAgentState } from '@/lib/agents/repository'
import { appendTraceEvent } from '@/lib/traces/writer'
import { hashSha256Bytes } from '@/lib/workspaces/hash'
import { ExportBundleSchema } from './schema'

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
    expect(bundle.sequence_snapshot).toContain('test-sequence')
    expect(bundle.policy_snapshot).toBeNull()
    expect(bundle.surfaces).toHaveLength(1)
    expect(bundle.artifact_manifests).toEqual([
      `.threados/runs/${runId}/gate-decisions.ndjson`,
      `.threados/runs/${runId}/step-abc/status.json`,
      `.threados/runs/${runId}/trace.ndjson`,
    ])
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
    expect(bundle.sequence_snapshot).toContain('minimal-sequence')
    expect(bundle.surfaces).toEqual([])
    expect(bundle.trace_events).toEqual([])
    expect(bundle.gate_decisions).toEqual([])
    expect(bundle.approvals).toEqual([])
    expect(bundle.artifact_manifests).toEqual([])
    expect(bundle.timing_summary).toBeNull()
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
