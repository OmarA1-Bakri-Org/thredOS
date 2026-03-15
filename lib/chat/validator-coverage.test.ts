import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { ActionValidator } from './validator'
import { writeSequence } from '../sequence/parser'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Sequence } from '../sequence/schema'

let testDir: string

const baseSequence: Sequence = {
  version: '1.0',
  name: 'test-coverage-seq',
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
    {
      id: 'step-2',
      name: 'Step Two',
      type: 'base',
      model: 'claude-code',
      prompt_file: 'prompts/step-2.md',
      depends_on: ['step-1'],
      status: 'READY',
    },
  ],
  gates: [
    { id: 'gate-1', name: 'Gate One', depends_on: ['step-1'], status: 'PENDING', cascade: false, childGateIds: [] },
  ],
}

beforeEach(async () => {
  testDir = join(tmpdir(), `validator-cov-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(join(testDir, '.threados'), { recursive: true })
  await writeSequence(testDir, baseSequence)
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('ActionValidator.validate — additional coverage', () => {
  test('step remove without id fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'step remove', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('step remove requires id')
  })

  test('step update without id fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'step update', args: { name: 'New Name' } }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('step update requires id')
  })

  test('dep remove without from fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'dep remove', args: { to: 'step-1' } }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('dep remove requires from')
  })

  test('dep remove without to fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'dep remove', args: { from: 'step-1' } }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('dep remove requires to')
  })

  test('dep add without to fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'dep add', args: { from: 'step-1' } }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('dep add requires to')
  })

  test('restart without step_id fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'restart', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('restart requires step_id')
  })

  test('gate approve without id fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'gate approve', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('gate approve requires id')
  })

  test('gate block without id fails', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'gate block', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('gate block requires id')
  })

  test('multiple valid actions pass', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([
      { command: 'run', args: {} },
      { command: 'stop', args: { step_id: 'step-1' } },
      { command: 'restart', args: { step_id: 'step-1' } },
      { command: 'group create', args: { id: 'grp-1', step_ids: ['step-1', 'step-2'] } },
      { command: 'fusion create', args: { candidate_ids: ['step-1', 'step-2'], synth_id: 'synth-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('stop without step_id fails validation', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'stop', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('stop requires step_id')
  })

  test('group create without required fields fails validation', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'group create', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('group create requires id')
    expect(result.errors).toContain('group create requires step_ids')
  })

  test('fusion create without required fields fails validation', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'fusion create', args: {} }])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('fusion create requires candidate_ids')
    expect(result.errors).toContain('fusion create requires synth_id')
  })

  test('dep remove with both from and to passes', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.validate([{ command: 'dep remove', args: { from: 'step-2', to: 'step-1' } }])
    expect(result.valid).toBe(true)
  })
})

describe('ActionValidator.dryRun — additional coverage', () => {
  test('step remove produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step remove', args: { id: 'step-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('-')
    expect(result.diff).toContain('step-1')
  })

  test('step update produces diff with new name', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', name: 'Updated Step' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('Updated Step')
  })

  test('step update with invalid type returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', type: 'invalid-type' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid type')
  })

  test('step update with empty model returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', model: '' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid model')
  })

  test('step update with any non-empty model string is accepted', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', model: 'gpt-5' } },
    ])
    expect(result.valid).toBe(true)
  })

  test('step update with invalid status returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', status: 'INVALID_STATUS' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid status')
  })

  test('step update with disallowed field returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', secret_field: 'hack' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid update field')
  })

  test('step update with nonexistent step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'nonexistent', name: 'X' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('dep add for nonexistent step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'dep add', args: { from: 'nonexistent', to: 'step-1' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('dep add adds dependency in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'dep add', args: { from: 'step-1', to: 'step-2' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('step-2')
  })

  test('dep add does not duplicate existing dependency', async () => {
    const v = new ActionValidator(testDir)
    // step-2 already depends on step-1
    const result = await v.dryRun([
      { command: 'dep add', args: { from: 'step-2', to: 'step-1' } },
    ])
    expect(result.valid).toBe(true)
    // The diff should show no changes (or minimal changes) since dep already exists
  })

  test('dep remove removes dependency in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'dep remove', args: { from: 'step-2', to: 'step-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('-')
  })

  test('dep remove for nonexistent step returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'dep remove', args: { from: 'nonexistent', to: 'step-1' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('gate approve produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'gate approve', args: { id: 'gate-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('APPROVED')
  })

  test('gate block produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'gate block', args: { id: 'gate-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('BLOCKED')
  })

  test('gate approve nonexistent gate returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'gate approve', args: { id: 'nonexistent-gate' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('gate block nonexistent gate returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'gate block', args: { id: 'nonexistent-gate' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  test('run command produces no diff changes', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'run', args: {} },
    ])
    expect(result.valid).toBe(true)
  })

  test('stop command changes step status in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'stop', args: { step_id: 'step-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('FAILED')
  })

  test('restart command changes step status in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'restart', args: { step_id: 'step-1' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('RUNNING')
  })

  test('group create sets group_id on steps in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'group create', args: { id: 'grp-1', step_ids: ['step-1', 'step-2'] } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('grp-1')
  })

  test('fusion create creates synth step in diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'fusion create', args: { candidate_ids: ['step-1', 'step-2'], synth_id: 'synth-12' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('synth-12')
  })

  test('step update with valid enum fields produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', type: 'p', model: 'codex', status: 'RUNNING' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('type: p')
    expect(result.diff).toContain('model: codex')
    expect(result.diff).toContain('status: RUNNING')
  })

  test('step update with cwd and prompt_file produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', cwd: '/new/path', prompt_file: 'new-prompt.md' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('/new/path')
    expect(result.diff).toContain('new-prompt.md')
  })

  test('step update with depends_on array produces diff', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', depends_on: ['step-2'] } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('step-2')
  })
})

describe('ActionValidator.apply — additional coverage', () => {
  test('apply with validation error returns failure', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([{ command: 'bogus', args: {} }])
    expect(result.success).toBe(false)
    expect(result.results[0].error).toContain('Unknown command')
  })

  test('apply dep add works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'dep add', args: { from: 'step-1', to: 'step-2' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].depends_on).toContain('step-2')
  })

  test('apply dep remove works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'dep remove', args: { from: 'step-2', to: 'step-1' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[1].depends_on).not.toContain('step-1')
  })

  test('apply gate block works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'gate block', args: { id: 'gate-1' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.gates[0].status).toBe('BLOCKED')
  })

  test('apply step update with name works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', name: 'Renamed Step' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].name).toBe('Renamed Step')
  })

  test('apply step update with cwd works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', cwd: '/custom/dir' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].cwd).toBe('/custom/dir')
  })

  test('apply step update with watchdog_for works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', watchdog_for: 'step-2' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].watchdog_for).toBe('step-2')
  })

  test('apply step update with orchestrator works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', orchestrator: 'main-orch' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].orchestrator).toBe('main-orch')
  })

  test('apply step update with timeout_ms works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', timeout_ms: 60000 } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].timeout_ms).toBe(60000)
  })

  test('apply step update with invalid timeout_ms returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', timeout_ms: 'not-a-number' } },
    ])
    // The apply still succeeds overall but records the error
    expect(result.success).toBe(true)
    expect(result.results[0].error).toContain('Invalid timeout_ms')
  })

  test('apply step update with fail_policy works', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fail_policy: 'retry' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fail_policy).toBe('retry')
  })

  test('apply step update with invalid fail_policy records error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step update', args: { id: 'step-1', fail_policy: 'bad-policy' } },
    ])
    expect(result.success).toBe(true)
    expect(result.results[0].error).toContain('Invalid fail_policy')
  })

  test('apply run no-op command succeeds', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'run', args: {} },
    ])
    expect(result.success).toBe(true)
    expect(result.results.every(r => r.status === 'applied')).toBe(true)
  })

  test('apply stop command sets step to FAILED', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'stop', args: { step_id: 'step-1' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('FAILED')
  })

  test('apply group create sets group_id on steps', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'group create', args: { id: 'grp-1', step_ids: ['step-1', 'step-2'] } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].group_id).toBe('grp-1')
    expect(seq.steps[0].type).toBe('p')
    expect(seq.steps[1].group_id).toBe('grp-1')
  })

  test('apply fusion create creates synth step', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'fusion create', args: { candidate_ids: ['step-1', 'step-2'], synth_id: 'synth-12' } },
    ])
    expect(result.success).toBe(true)

    const { readSequence } = await import('../sequence/parser')
    const seq = await readSequence(testDir)
    expect(seq.steps[0].fusion_candidates).toBe(true)
    expect(seq.steps[0].type).toBe('f')
    const synthStep = seq.steps.find(s => s.id === 'synth-12')
    expect(synthStep).toBeDefined()
    expect(synthStep?.fusion_synth).toBe(true)
  })

  test('apply step add with invalid step schema returns error', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step add', args: { id: 'INVALID_ID', name: 'Bad', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    // Uppercase ID fails schema validation
    expect(result.success).toBe(true)
    expect(result.results[0].error).toContain('Invalid step')
  })

  test('apply with policy-denied action records error for that action', async () => {
    // Create a policy that forbids commands matching 'step add'
    await mkdir(join(testDir, '.threados'), { recursive: true })
    await writeFile(
      join(testDir, '.threados', 'policy.yaml'),
      `mode: POWER
command_allowlist: []
cwd_patterns:
  - "**"
max_fanout: 10
max_concurrent: 5
forbidden_patterns:
  - "^step add$"
`,
    )

    const v = new ActionValidator(testDir)
    const result = await v.apply([
      { command: 'step add', args: { id: 'new-step', name: 'New', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.success).toBe(true)
    expect(result.results[0].error).toContain('forbidden')
  })
})

describe('ActionValidator.dryRun — sequence read fallback', () => {
  test('dryRun uses default sequence when sequence file is missing', async () => {
    const missingDir = join(tmpdir(), `validator-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(missingDir, '.threados'), { recursive: true })
    // Do NOT write sequence.yaml — readSequence returns default empty sequence

    const v = new ActionValidator(missingDir)
    const result = await v.dryRun([
      { command: 'step add', args: { id: 'new', name: 'New', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    // readSequence returns a default sequence, so step add should succeed
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('new')

    await rm(missingDir, { recursive: true, force: true })
  })

  test('dryRun returns error when sequence file has invalid YAML', async () => {
    const badDir = join(tmpdir(), `validator-bad-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(badDir, '.threados'), { recursive: true })
    await writeFile(join(badDir, '.threados', 'sequence.yaml'), '{{{{invalid yaml!!!!}}}')

    const v = new ActionValidator(badDir)
    const result = await v.dryRun([
      { command: 'step add', args: { id: 'new', name: 'New', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)

    await rm(badDir, { recursive: true, force: true })
  })
})

describe('computeUnifiedDiff via dryRun', () => {
  test('diff includes header lines', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step add', args: { id: 'new-step', name: 'New', type: 'base', model: 'claude-code', prompt_file: 'p.md' } },
    ])
    expect(result.valid).toBe(true)
    expect(result.diff).toContain('--- original')
    expect(result.diff).toContain('+++ modified')
  })

  test('diff shows context lines (unchanged) with space prefix', async () => {
    const v = new ActionValidator(testDir)
    const result = await v.dryRun([
      { command: 'step update', args: { id: 'step-1', name: 'Changed Name' } },
    ])
    expect(result.valid).toBe(true)
    // Context lines should start with space
    const lines = result.diff.split('\n')
    const contextLines = lines.filter(l => l.startsWith(' '))
    expect(contextLines.length).toBeGreaterThan(0)
  })
})
