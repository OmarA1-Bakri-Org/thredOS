import { describe, it, expect, afterEach } from 'bun:test'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { appendTraceEvent } from './writer'
import { readTraceEvents } from './reader'
import type { TraceEvent } from '@/lib/contracts/schemas'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { AgentExecutionSnapshotSchema, agentRegistrationEvidence } from '../agents/execution'
import { WorkflowRunSchema, StepAttemptSchema } from '../runtime/schema'

function makeTraceEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    ts: '2026-03-28T10:00:00Z',
    run_id: 'run-abc123',
    surface_id: 'surface-001',
    actor: 'threados',
    event_type: 'step-started',
    payload_ref: null,
    policy_ref: null,
    ...overrides,
  }
}

describe('appendTraceEvent + readTraceEvents', () => {
  let tmpDir: string

  afterEach(async () => {
    if (tmpDir) {
      await cleanTempDir(tmpDir)
    }
  })

  it('appends a trace event and persists it to NDJSON', async () => {
    tmpDir = await createTempDir()
    const event = makeTraceEvent()

    await appendTraceEvent(tmpDir, 'run-abc123', event)

    const events = await readTraceEvents(tmpDir, 'run-abc123')
    expect(events).toHaveLength(1)
    expect(events[0].run_id).toBe('run-abc123')
    expect(events[0].event_type).toBe('step-started')
    expect(events[0].ts).toBe('2026-03-28T10:00:00Z')
    expect(events[0].surface_id).toBe('surface-001')
    expect(events[0].actor).toBe('threados')
    expect(events[0].payload_ref).toBeNull()
    expect(events[0].policy_ref).toBeNull()
  })

  it('appends multiple events and reads them back in order', async () => {
    tmpDir = await createTempDir()
    const runId = 'run-multi'

    const event1 = makeTraceEvent({ run_id: runId, event_type: 'step-started', ts: '2026-03-28T10:00:00Z' })
    const event2 = makeTraceEvent({ run_id: runId, event_type: 'gate-evaluated', ts: '2026-03-28T10:01:00Z' })
    const event3 = makeTraceEvent({ run_id: runId, event_type: 'step-completed', ts: '2026-03-28T10:02:00Z' })

    await appendTraceEvent(tmpDir, runId, event1)
    await appendTraceEvent(tmpDir, runId, event2)
    await appendTraceEvent(tmpDir, runId, event3)

    const events = await readTraceEvents(tmpDir, runId)
    expect(events).toHaveLength(3)
    expect(events[0].event_type).toBe('step-started')
    expect(events[1].event_type).toBe('gate-evaluated')
    expect(events[2].event_type).toBe('step-completed')
    expect(events[0].ts).toBe('2026-03-28T10:00:00Z')
    expect(events[1].ts).toBe('2026-03-28T10:01:00Z')
    expect(events[2].ts).toBe('2026-03-28T10:02:00Z')
  })

  it('returns empty array for a missing trace file', async () => {
    tmpDir = await createTempDir()

    const events = await readTraceEvents(tmpDir, 'run-nonexistent')
    expect(events).toEqual([])
  })

  it('creates the run directory automatically on first append', async () => {
    tmpDir = await createTempDir()
    const runId = 'run-new-dir'

    // No pre-creation of directory — writer should handle it
    await appendTraceEvent(tmpDir, runId, makeTraceEvent({ run_id: runId }))

    const events = await readTraceEvents(tmpDir, runId)
    expect(events).toHaveLength(1)
  })

  it('validates event schema on write and rejects invalid events', async () => {
    tmpDir = await createTempDir()
    const invalidEvent = { ...makeTraceEvent(), event_type: 'not-a-valid-type' } as unknown as TraceEvent

    await expect(appendTraceEvent(tmpDir, 'run-abc', invalidEvent)).rejects.toThrow()
  })

  it('rejects an event whose body is bound to a different run', async () => {
    tmpDir = await createTempDir()

    await expect(appendTraceEvent(
      tmpDir,
      'run-target',
      makeTraceEvent({ run_id: 'run-other' }),
    )).rejects.toThrow('run_id must match')
    await expect(readTraceEvents(tmpDir, 'run-target')).resolves.toEqual([])
  })

  it('stores events with payload_ref and policy_ref when provided', async () => {
    tmpDir = await createTempDir()
    const runId = 'run-with-refs'
    const event = makeTraceEvent({
      run_id: runId,
      event_type: 'barrier-attested',
      payload_ref: 'payloads/barrier-001.json',
      policy_ref: 'policies/current.json',
    })

    await appendTraceEvent(tmpDir, runId, event)

    const events = await readTraceEvents(tmpDir, runId)
    expect(events).toHaveLength(1)
    expect(events[0].payload_ref).toBe('payloads/barrier-001.json')
    expect(events[0].policy_ref).toBe('policies/current.json')
  })

  it('links run and attempt traces to frozen records without trusting caller identity or a later registry', async () => {
    tmpDir = await createTempDir()
    const registration = AgentExecutionSnapshotSchema.parse({
      registration_id: 'registered-agent', registration_version: 2, composition_hash: 'a'.repeat(64),
      builder_id: 'builder', registered_at: '2026-01-01T00:00:00Z', supersedes_agent_id: 'previous-agent',
      model: 'shell', role: 'builder', prompt_ref: { id: 'canonical', version: 3, path: '.threados/prompts/private.md' },
      skill_refs: [], tools: ['private-tool'], prompt_content_hash: 'b'.repeat(64), skill_content_hashes: [],
    })
    const runId = 'run-frozen'
    const run = WorkflowRunSchema.parse({
      schema_version: 2, id: runId, revision: 0, sequence_id: 'sequence', sequence_snapshot_hash: 'sequence-hash',
      target: { kind: 'step', step_id: 'build' }, strategy: 'sequential', status: 'running', max_concurrency: 1,
      policy_snapshot_hash: 'policy-hash', baseline_snapshot_id: null, attempt_ids: ['attempt-frozen'],
      agent_registrations: { build: registration }, created_by: 'tester', created_via: 'system',
      created_at: '2026-01-01T00:00:00Z', started_at: null, ended_at: null, cancellation_requested_at: null,
      summary: null, error_code: null, error_message: null,
    })
    const attempt = StepAttemptSchema.parse({
      schema_version: 2, id: 'attempt-frozen', revision: 0, workflow_run_id: runId, sequence_id: 'sequence',
      step_id: 'build', surface_id: 'thread-build', execution_index: 1, attempt_number: 1, retry_of_attempt_id: null,
      status: 'running', agent_ref: registration.registration_id, agent_registration: registration, model: 'shell',
      side_effect_class: 'read', baseline_snapshot_id: null, workspace_id: null, process_id: null,
      compiled_prompt_hash: 'pending', input_manifest_ref: null, output_manifest_ref: null, artifact_manifest_ref: null,
      change_set_id: null, gate_decision_refs: [], created_at: run.created_at, started_at: null, ended_at: null,
      last_heartbeat_at: null, exit_code: null, signal: null, duration_ms: null, error_code: null, error_message: null,
    })
    const runRoot = join(tmpDir, '.threados/runs', runId)
    await mkdir(join(runRoot, 'attempts', attempt.id), { recursive: true })
    await writeFile(join(runRoot, 'run.json'), JSON.stringify(run))
    await writeFile(join(runRoot, 'attempts', attempt.id, 'attempt.json'), JSON.stringify(attempt))
    // A live registry may change independently; historical trace binding must not use it.
    await mkdir(join(tmpDir, '.threados/state'), { recursive: true })
    await writeFile(join(tmpDir, '.threados/state/agents.json'), JSON.stringify({ version: 1, agents: [] }))
    const claimed = { ...agentRegistrationEvidence(registration), registration_id: 'spoofed-agent' }
    await appendTraceEvent(tmpDir, runId, makeTraceEvent({ run_id: runId, agent_registration: claimed, event_type: 'snapshot-created' }))
    await appendTraceEvent(tmpDir, runId, makeTraceEvent({ run_id: runId, surface_id: attempt.surface_id, attempt_id: attempt.id, agent_registration: claimed }))
    const events = await readTraceEvents(tmpDir, runId)
    expect(events[0]!.agent_registrations).toEqual({ build: agentRegistrationEvidence(registration) })
    expect(events[1]!.agent_registration).toEqual(agentRegistrationEvidence(registration))
    expect(JSON.stringify(events)).not.toContain('private.md')
    expect(JSON.stringify(events)).not.toContain('private-tool')
    expect(JSON.stringify(events)).not.toContain('spoofed-agent')
    await expect(appendTraceEvent(tmpDir, runId, makeTraceEvent({
      run_id: runId, surface_id: 'another-surface', attempt_id: attempt.id,
    }))).rejects.toThrow('Trace surface does not match')
    await writeFile(join(runRoot, 'attempts', attempt.id, 'attempt.json'), JSON.stringify({ ...attempt, agent_registration: { ...registration, registration_version: 99 } }))
    await expect(appendTraceEvent(tmpDir, runId, makeTraceEvent({ run_id: runId, surface_id: attempt.surface_id, attempt_id: attempt.id }))).rejects.toThrow('frozen run registration')
    expect(await readTraceEvents(tmpDir, runId)).toHaveLength(2)
  })
})
