import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateExportBundle } from './bundler'
import type { TraceEvent, GateDecision } from '@/lib/contracts/schemas'

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

    const traceEvent = makeTraceEvent({ run_id: runId })
    await writeFile(join(runDir, 'trace.ndjson'), JSON.stringify(traceEvent) + '\n', 'utf-8')

    const gateDecision = makeGateDecision()
    await writeFile(join(runDir, 'gate-decisions.ndjson'), JSON.stringify(gateDecision) + '\n', 'utf-8')

    const bundle = await generateExportBundle(basePath, runId)

    expect(bundle.bundle_version).toBe('1.0')
    expect(bundle.run_id).toBe(runId)
    expect(bundle.pack).toEqual({ id: null, version: null })
    expect(bundle.sequence_snapshot).toContain('test-sequence')
    expect(bundle.policy_snapshot).toBeNull()
    expect(bundle.surfaces).toEqual([])
    expect(bundle.artifact_manifests).toEqual([])
    expect(bundle.timing_summary).toBeNull()
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
    expect(bundle.trace_events).toEqual([])
    expect(bundle.gate_decisions).toEqual([])
    expect(bundle.approvals).toEqual([])
  })
})
