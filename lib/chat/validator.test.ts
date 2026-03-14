import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { ActionValidator } from './validator'
import { writeSequence } from '../sequence/parser'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Sequence } from '../sequence/schema'

let testDir: string

const baseSequence: Sequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [
    {
      id: 'step-1',
      name: 'Step One',
      type: 'base',
      model: 'claude-code',
      prompt_file: 'prompts/step-1.md',
      depends_on: [],
      status: 'READY',
    },
  ],
  gates: [
    { id: 'gate-1', name: 'Gate', depends_on: ['step-1'], status: 'PENDING', cascade: false, childGateIds: [] },
  ],
}

beforeEach(async () => {
  testDir = join(tmpdir(), `validator-test-${Date.now()}`)
  await mkdir(join(testDir, '.threados'), { recursive: true })
  await writeSequence(testDir, baseSequence)
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('ActionValidator.validate', () => {
  test('valid actions pass', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([
      { command: 'step add', args: { id: 'new', name: 'New', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('unknown command fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'destroy-all', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Unknown command')
  })

  test('step add missing fields fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'step add', args: { id: 'x' } }])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('dep add missing from fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'dep add', args: { to: 'x' } }])
    expect(result.valid).toBe(false)
  })
})

describe('ActionValidator.dryRun', () => {
  test('produces diff for step add', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step add', args: { id: 'step-2', name: 'Two', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('+')
    expect(result.diff).toContain('step-2')
  })

  test('invalid actions return errors', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{ command: 'bogus', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('duplicate step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step add', args: { id: 'step-1', name: 'Dup', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('already exists')
  })
})

describe('ActionValidator.apply', () => {
  test('applies step add and persists', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step add', args: { id: 'step-2', name: 'Two', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.success).toBe(true)

    // Verify persisted
    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps).toHaveLength(2)
    expect(seq.steps[1].id).toBe('step-2')
  })

  test('applies gate approve', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'gate approve', args: { id: 'gate-1' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.gates[0].status).toBe('APPROVED')
  })

  test('applies step remove and cleans deps', async () => {
    // First add step-2 that depends on step-1
    await writeSequence(testDir, {
      ...baseSequence,
      steps: [
        ...baseSequence.steps,
        { id: 'step-2', name: 'Two', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: ['step-1'], status: 'READY' },
      ],
    })

    const v = new ActionValidator(testDir)
    const result = await v.apply([{ command: 'step remove', args: { id: 'step-1' } }])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps).toHaveLength(1)
    expect(seq.steps[0].depends_on).toHaveLength(0)
  })
})

describe('ActionValidator fusion boolean coercion', () => {
  test('step update sets fusion_candidates true from boolean true', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fusion_candidates: true } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_candidates).toBe(true)
  })

  test('step update sets fusion_candidates false from boolean false', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fusion_candidates: false } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_candidates).toBe(false)
  })

  test('step update sets fusion_candidates false from string "false"', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fusion_candidates: 'false' as unknown as boolean } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_candidates).toBe(false)
  })

  test('step update sets fusion_candidates true from string "true"', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fusion_candidates: 'true' as unknown as boolean } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_candidates).toBe(true)
  })

  test('step update sets fusion_synth false from string "false"', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fusion_synth: 'false' as unknown as boolean } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_synth).toBe(false)
  })

  test('step update rejects invalid fusion_candidates value', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', fusion_candidates: 'yes' as unknown as boolean } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid fusion_candidates')
  })

  test('step update rejects invalid fusion_synth value', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', fusion_synth: 'nope' as unknown as boolean } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid fusion_synth')
  })
})
