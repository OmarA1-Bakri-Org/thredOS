import { describe, it, expect, afterEach } from 'bun:test'
import { join } from 'path'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { appendTraceEvent } from './writer'
import { readTraceEvents } from './reader'
import type { TraceEvent } from '@/lib/contracts/schemas'

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
})
