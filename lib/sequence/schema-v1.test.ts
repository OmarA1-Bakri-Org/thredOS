import { describe, test, expect } from 'bun:test'
import { StepSchema, SequenceSchema } from './schema'

const validStep = {
  id: 'my-step-1',
  name: 'My Step',
  type: 'base',
  model: 'claude-code',
  prompt_file: '.threados/prompts/test.md',
}

describe('SequenceSchema V.1 extensions', () => {
  test('accepts pack_id and pack_version', () => {
    const result = SequenceSchema.safeParse({
      name: 'test-sequence',
      pack_id: 'my-pack',
      pack_version: '1.0.0',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_id).toBe('my-pack')
      expect(result.data.pack_version).toBe('1.0.0')
    }
  })

  test('pack_id defaults to null when omitted', () => {
    const result = SequenceSchema.safeParse({ name: 'test-sequence' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_id).toBeNull()
      expect(result.data.pack_version).toBeNull()
      expect(result.data.default_policy_ref).toBeNull()
    }
  })

  test('accepts default_policy_ref', () => {
    const result = SequenceSchema.safeParse({
      name: 'test-sequence',
      default_policy_ref: 'policy/standard.yaml',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.default_policy_ref).toBe('policy/standard.yaml')
    }
  })

  test('existing sequences without new fields still parse', () => {
    const result = SequenceSchema.safeParse({
      version: '1.0',
      name: 'legacy-sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'base',
          model: 'claude-code',
          prompt_file: '.threados/prompts/a.md',
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_id).toBeNull()
      expect(result.data.pack_version).toBeNull()
      expect(result.data.default_policy_ref).toBeNull()
    }
  })
})

describe('StepSchema V.1 extensions', () => {
  test('accepts phase', () => {
    const result = StepSchema.safeParse({ ...validStep, phase: 'research' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.phase).toBe('research')
  })

  test('accepts surface_ref', () => {
    const result = StepSchema.safeParse({ ...validStep, surface_ref: 'surface/main' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.surface_ref).toBe('surface/main')
  })

  test('accepts input_contract_ref', () => {
    const result = StepSchema.safeParse({ ...validStep, input_contract_ref: 'contracts/input.yaml' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.input_contract_ref).toBe('contracts/input.yaml')
  })

  test('accepts output_contract_ref', () => {
    const result = StepSchema.safeParse({ ...validStep, output_contract_ref: 'contracts/output.yaml' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.output_contract_ref).toBe('contracts/output.yaml')
  })

  test('accepts gate_set_ref', () => {
    const result = StepSchema.safeParse({ ...validStep, gate_set_ref: 'gates/standard.yaml' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.gate_set_ref).toBe('gates/standard.yaml')
  })

  test('accepts completion_contract', () => {
    const result = StepSchema.safeParse({ ...validStep, completion_contract: 'contracts/done.yaml' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.completion_contract).toBe('contracts/done.yaml')
  })

  test('accepts all side_effect_class values', () => {
    for (const cls of ['none', 'read', 'write', 'execute']) {
      const result = StepSchema.safeParse({ ...validStep, side_effect_class: cls })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.side_effect_class).toBe(cls)
    }
  })

  test('rejects invalid side_effect_class', () => {
    const result = StepSchema.safeParse({ ...validStep, side_effect_class: 'invalid' })
    expect(result.success).toBe(false)
  })

  test('V.1 fields default to undefined when omitted', () => {
    const result = StepSchema.safeParse(validStep)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phase).toBeUndefined()
      expect(result.data.surface_ref).toBeUndefined()
      expect(result.data.input_contract_ref).toBeUndefined()
      expect(result.data.output_contract_ref).toBeUndefined()
      expect(result.data.gate_set_ref).toBeUndefined()
      expect(result.data.completion_contract).toBeUndefined()
      expect(result.data.side_effect_class).toBeUndefined()
    }
  })

  test('existing steps without V.1 fields still parse', () => {
    const result = StepSchema.safeParse({
      id: 'legacy-step',
      name: 'Legacy Step',
      type: 'p',
      model: 'gpt-4o',
      prompt_file: '.threados/prompts/legacy.md',
      depends_on: ['step-prev'],
      status: 'READY',
    })
    expect(result.success).toBe(true)
  })
})
