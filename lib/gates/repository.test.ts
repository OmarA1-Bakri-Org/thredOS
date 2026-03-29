import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendGateDecision, readGateDecisions } from './repository'
import type { GateDecision } from '@/lib/contracts/schemas'

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

describe('gate decision repository', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-gate-decisions-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('append and read a gate decision — verify fields', async () => {
    const decision = makeGateDecision()
    await appendGateDecision(basePath, 'run-1', decision)
    const results = await readGateDecisions(basePath, 'run-1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('decision-1')
    expect(results[0].subject_type).toBe('step')
    expect(results[0].subject_ref).toBe('step-abc')
    expect(results[0].gate_type).toBe('policy_pass')
    expect(results[0].status).toBe('PASS')
    expect(results[0].decided_by).toBe('threados')
    expect(results[0].decided_at).toBe('2026-03-29T00:00:00.000Z')
  })

  test('returns empty array for missing file', async () => {
    const results = await readGateDecisions(basePath, 'nonexistent-run')
    expect(results).toEqual([])
  })

  test('append multiple decisions, read back, verify count', async () => {
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-1', status: 'PASS' }))
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-2', status: 'BLOCK' }))
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-3', status: 'NEEDS_APPROVAL' }))
    const results = await readGateDecisions(basePath, 'run-2')
    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('decision-1')
    expect(results[1].id).toBe('decision-2')
    expect(results[2].id).toBe('decision-3')
  })
})
