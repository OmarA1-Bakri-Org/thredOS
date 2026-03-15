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

const twoStepSequence: Sequence = {
  version: '1.0',
  name: 'test-seq-2',
  steps: [
    {
      id: 'step-a',
      name: 'Step A',
      type: 'base',
      model: 'claude-code',
      prompt_file: 'prompts/step-a.md',
      depends_on: [],
      status: 'READY',
    },
    {
      id: 'step-b',
      name: 'Step B',
      type: 'base',
      model: 'claude-code',
      prompt_file: 'prompts/step-b.md',
      depends_on: [],
      status: 'RUNNING',
    },
  ],
  gates: [],
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

describe('ActionValidator stop/restart/group/fusion commands', () => {
  test('stop sets step status to FAILED', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{ command: 'stop', args: { step_id: 'step-b' } }])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('FAILED')
  })

  test('stop with nonexistent step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{ command: 'stop', args: { step_id: 'nonexistent' } }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('stop without step_id returns validation error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'stop', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('stop requires step_id')
  })

  test('restart sets step status to RUNNING', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{ command: 'restart', args: { step_id: 'step-1' } }])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('RUNNING')
  })

  test('restart with nonexistent step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{ command: 'restart', args: { step_id: 'nonexistent' } }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('group create sets group_id and type on steps', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'group create',
      args: { id: 'grp-1', step_ids: ['step-a', 'step-b'] },
    }])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('grp-1')
    expect(result.diff).toContain('type: p')
  })

  test('group create requires at least 2 step_ids', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'group create',
      args: { id: 'grp-1', step_ids: ['step-a'] },
    }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('at least 2')
  })

  test('group create requires id and step_ids', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'group create', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('group create requires id')
    expect(result.errors).toContain('group create requires step_ids')
  })

  test('group create with nonexistent step returns error', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'group create',
      args: { id: 'grp-1', step_ids: ['step-a', 'nonexistent'] },
    }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('fusion create marks candidates and creates synth step', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'fusion create',
      args: { candidate_ids: ['step-a', 'step-b'], synth_id: 'synth-ab' },
    }])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('synth-ab')
    expect(result.diff).toContain('type: f')
  })

  test('fusion create requires at least 2 candidate_ids', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'fusion create',
      args: { candidate_ids: ['step-a'], synth_id: 'synth-a' },
    }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('at least 2')
  })

  test('fusion create requires candidate_ids and synth_id', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'fusion create', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('fusion create requires candidate_ids')
    expect(result.errors).toContain('fusion create requires synth_id')
  })

  test('fusion create with nonexistent candidate returns error', async () => {
    await writeSequence(testDir, twoStepSequence)
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([{
      command: 'fusion create',
      args: { candidate_ids: ['step-a', 'nonexistent'], synth_id: 'synth-x' },
    }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
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
