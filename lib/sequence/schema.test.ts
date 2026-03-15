import { describe, test, expect } from 'bun:test'
import { StepSchema, GateSchema, SequenceSchema, PolicySchema, MetadataSchema } from './schema'

const validStep = {
  id: 'my-step-1',
  name: 'My Step',
  type: 'base',
  model: 'claude-code',
  prompt_file: '.threados/prompts/test.md',
}

describe('StepSchema', () => {
  test('parses valid step with defaults', () => {
    const result = StepSchema.safeParse(validStep)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.depends_on).toEqual([])
      expect(result.data.status).toBe('READY')
    }
  })

  test('rejects invalid ID chars (uppercase)', () => {
    const result = StepSchema.safeParse({ ...validStep, id: 'My_Step' })
    expect(result.success).toBe(false)
  })

  test('rejects invalid ID chars (underscore)', () => {
    const result = StepSchema.safeParse({ ...validStep, id: 'my_step' })
    expect(result.success).toBe(false)
  })

  test('rejects empty ID', () => {
    const result = StepSchema.safeParse({ ...validStep, id: '' })
    expect(result.success).toBe(false)
  })

  test('rejects missing name', () => {
    const { name: _name, ...noName } = validStep
    const result = StepSchema.safeParse(noName)
    expect(result.success).toBe(false)
  })

  test('rejects missing prompt_file', () => {
    const { prompt_file: _pf, ...noPF } = validStep
    const result = StepSchema.safeParse(noPF)
    expect(result.success).toBe(false)
  })

  test('validates enum type values', () => {
    for (const t of ['base', 'p', 'c', 'f', 'b', 'l']) {
      const result = StepSchema.safeParse({ ...validStep, type: t })
      expect(result.success).toBe(true)
    }
    const result = StepSchema.safeParse({ ...validStep, type: 'invalid' })
    expect(result.success).toBe(false)
  })

  test('accepts any non-empty model string (model-agnostic)', () => {
    for (const m of ['claude-code', 'codex', 'gemini', 'shell', 'gpt-4o', 'meta-llama/llama-3.1-70b']) {
      expect(StepSchema.safeParse({ ...validStep, model: m }).success).toBe(true)
    }
    expect(StepSchema.safeParse({ ...validStep, model: '' }).success).toBe(false)
  })

  test('validates status enum', () => {
    for (const s of ['READY', 'RUNNING', 'NEEDS_REVIEW', 'DONE', 'FAILED', 'BLOCKED']) {
      expect(StepSchema.safeParse({ ...validStep, status: s }).success).toBe(true)
    }
  })

  // M3 fields
  test('accepts group_id', () => {
    const result = StepSchema.safeParse({ ...validStep, group_id: 'grp-1' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.group_id).toBe('grp-1')
  })

  test('accepts fanout', () => {
    const result = StepSchema.safeParse({ ...validStep, fanout: 3 })
    expect(result.success).toBe(true)
  })

  test('accepts fusion_candidates', () => {
    const result = StepSchema.safeParse({ ...validStep, fusion_candidates: true })
    expect(result.success).toBe(true)
  })

  test('accepts fusion_synth', () => {
    const result = StepSchema.safeParse({ ...validStep, fusion_synth: true })
    expect(result.success).toBe(true)
  })

  test('accepts fail_policy', () => {
    for (const fp of ['stop-all', 'continue', 'retry']) {
      expect(StepSchema.safeParse({ ...validStep, fail_policy: fp }).success).toBe(true)
    }
    expect(StepSchema.safeParse({ ...validStep, fail_policy: 'invalid' }).success).toBe(false)
  })

  test('accepts timeout_ms', () => {
    const result = StepSchema.safeParse({ ...validStep, timeout_ms: 5000 })
    expect(result.success).toBe(true)
  })

  test('accepts watchdog_for', () => {
    const result = StepSchema.safeParse({ ...validStep, watchdog_for: 'main-step' })
    expect(result.success).toBe(true)
  })

  test('accepts orchestrator', () => {
    const result = StepSchema.safeParse({ ...validStep, orchestrator: 'orch-1' })
    expect(result.success).toBe(true)
  })

  test('accepts assigned_agent_id', () => {
    const result = StepSchema.safeParse({ ...validStep, assigned_agent_id: 'agent-1' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.assigned_agent_id).toBe('agent-1')
  })

  test('assigned_agent_id defaults to undefined', () => {
    const result = StepSchema.safeParse(validStep)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.assigned_agent_id).toBeUndefined()
  })
})

describe('GateSchema', () => {
  test('parses valid gate with default status', () => {
    const result = GateSchema.safeParse({ id: 'gate-1', name: 'Gate', depends_on: ['step-1'] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe('PENDING')
  })

  test('rejects invalid gate ID', () => {
    expect(GateSchema.safeParse({ id: 'GATE!', name: 'G', depends_on: [] }).success).toBe(false)
  })

  test('accepts gate criteria fields', () => {
    const result = GateSchema.safeParse({
      id: 'gate-1', name: 'Gate', depends_on: ['step-1'],
      description: 'Quality checkpoint',
      acceptance_conditions: ['Tests pass', 'No lint errors'],
      required_review: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe('Quality checkpoint')
      expect(result.data.acceptance_conditions).toHaveLength(2)
      expect(result.data.required_review).toBe(true)
    }
  })

  test('gate criteria fields default to undefined', () => {
    const result = GateSchema.safeParse({ id: 'g', name: 'G', depends_on: [] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBeUndefined()
      expect(result.data.acceptance_conditions).toBeUndefined()
      expect(result.data.required_review).toBeUndefined()
    }
  })
})

describe('SequenceSchema', () => {
  test('parses minimal valid sequence', () => {
    const result = SequenceSchema.safeParse({ name: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.version).toBe('1.0')
      expect(result.data.steps).toEqual([])
      expect(result.data.gates).toEqual([])
    }
  })

  test('rejects missing name', () => {
    expect(SequenceSchema.safeParse({ version: '1.0' }).success).toBe(false)
  })
})

describe('PolicySchema', () => {
  test('accepts valid policy', () => {
    const result = PolicySchema.safeParse({ safe_mode: true, max_parallel: 4, default_fail_policy: 'continue' })
    expect(result!.success).toBe(true)
  })
})

describe('MetadataSchema', () => {
  test('accepts valid metadata', () => {
    const result = MetadataSchema.safeParse({ author: 'test', tags: ['m3', 'quality'] })
    expect(result!.success).toBe(true)
  })
})
