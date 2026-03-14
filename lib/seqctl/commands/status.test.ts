import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string

const sequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [
    { id: 'step-a', name: 'Step A', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'READY' },
    { id: 'step-b', name: 'Step B', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-b.md', depends_on: ['step-a'], status: 'RUNNING' },
    { id: 'step-c', name: 'Step C', type: 'p', model: 'codex', prompt_file: '.threados/prompts/step-c.md', depends_on: [], status: 'DONE' },
  ],
  gates: [
    { id: 'gate-1', name: 'Review', depends_on: ['step-a'], status: 'PENDING' },
  ],
}

describe.serial('statusCommand', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-status-test-'))
    await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
    await mkdir(join(basePath, '.threados/state'), { recursive: true })
    await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(sequence))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('outputs valid JSON in json mode', async () => {
    const { statusCommand } = await import('./status')

    // Capture console.log output
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await statusCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.name).toBe('test-seq')
    expect(output.version).toBe('1.0')
    expect(output.steps).toHaveLength(3)
    expect(output.gates).toHaveLength(1)
  })

  test('computes summary correctly', async () => {
    const { statusCommand } = await import('./status')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await statusCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.summary.total).toBe(3)
    expect(output.summary.ready).toBe(1)
    expect(output.summary.running).toBe(1)
    expect(output.summary.done).toBe(1)
    expect(output.summary.failed).toBe(0)
  })

  test('includes gate status info', async () => {
    const { statusCommand } = await import('./status')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await statusCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.gates[0].id).toBe('gate-1')
    expect(output.gates[0].status).toBe('PENDING')
    expect(output.gates[0].dependsOn).toContain('step-a')
  })

  // --- Human-readable output tests ---

  test('displays human-readable output with steps and gates', async () => {
    const { statusCommand } = await import('./status')

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    // Should include sequence name
    expect(combined).toContain('test-seq')
    // Should include step IDs
    expect(combined).toContain('step-a')
    expect(combined).toContain('step-b')
    expect(combined).toContain('step-c')
    // Should include step statuses
    expect(combined).toContain('READY')
    expect(combined).toContain('RUNNING')
    expect(combined).toContain('DONE')
    // Should include gate info
    expect(combined).toContain('gate-1')
    expect(combined).toContain('PENDING')
    // Should include summary section
    expect(combined).toContain('Total: 3')
    expect(combined).toContain('Ready: 1')
    expect(combined).toContain('Running: 1')
    expect(combined).toContain('Done: 1')
    expect(combined).toContain('Failed: 0')
  })

  test('displays step type and model in human-readable output', async () => {
    const { statusCommand } = await import('./status')

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    // Steps should show type/model
    expect(combined).toContain('base/claude-code')
    expect(combined).toContain('p/codex')
  })

  test('displays dependency info in human-readable output', async () => {
    const { statusCommand } = await import('./status')

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    // step-b depends on step-a
    expect(combined).toContain('deps: step-a')
  })

  // --- Summary computation for all status types ---

  test('computes summary with FAILED, BLOCKED, and NEEDS_REVIEW steps', async () => {
    const { statusCommand } = await import('./status')

    const allStatusSequence = {
      version: '1.0',
      name: 'all-status-seq',
      steps: [
        { id: 'ready-step', name: 'Ready', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/ready.md', depends_on: [], status: 'READY' },
        { id: 'running-step', name: 'Running', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/running.md', depends_on: [], status: 'RUNNING' },
        { id: 'done-step', name: 'Done', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/done.md', depends_on: [], status: 'DONE' },
        { id: 'failed-step', name: 'Failed', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/failed.md', depends_on: [], status: 'FAILED' },
        { id: 'blocked-step', name: 'Blocked', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/blocked.md', depends_on: [], status: 'BLOCKED' },
        { id: 'review-step', name: 'Needs Review', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/review.md', depends_on: [], status: 'NEEDS_REVIEW' },
      ],
      gates: [],
    }
    await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(allStatusSequence))

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await statusCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.summary.total).toBe(6)
    expect(output.summary.ready).toBe(1)
    expect(output.summary.running).toBe(1)
    expect(output.summary.done).toBe(1)
    expect(output.summary.failed).toBe(1)
    expect(output.summary.blocked).toBe(1)
    expect(output.summary.needsReview).toBe(1)
  })

  // --- Edge cases ---

  test('handles sequence with no steps', async () => {
    const { statusCommand } = await import('./status')

    const emptySequence = { version: '1.0', name: 'empty-seq', steps: [], gates: [] }
    await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(emptySequence))

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    expect(combined).toContain('(no steps)')
    expect(combined).toContain('Total: 0')
  })

  test('handles sequence with no gates in human-readable mode', async () => {
    const { statusCommand } = await import('./status')

    const noGateSequence = {
      version: '1.0',
      name: 'no-gate-seq',
      steps: [
        { id: 'step-x', name: 'Step X', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-x.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    }
    await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(noGateSequence))

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    // Gates section should not appear when there are no gates
    expect(combined).not.toContain('Gates:')
    // But steps section should
    expect(combined).toContain('step-x')
  })

  test('step status includes processIndex from mprocs map', async () => {
    const { statusCommand } = await import('./status')

    // Create a mprocs map with a process index
    await mkdir(join(basePath, '.threados/state'), { recursive: true })
    await writeFile(join(basePath, '.threados/state/mprocs-map.json'), JSON.stringify({ 'step-a': 0, 'step-b': 1 }))

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await statusCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.steps[0].processIndex).toBe(0)
    expect(output.steps[1].processIndex).toBe(1)
  })

  test('human-readable output shows process info when mprocs map exists', async () => {
    const { statusCommand } = await import('./status')

    await mkdir(join(basePath, '.threados/state'), { recursive: true })
    await writeFile(join(basePath, '.threados/state/mprocs-map.json'), JSON.stringify({ 'step-a': 3 }))

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    await statusCommand(undefined, [], { json: false, help: false, watch: false, basePath })

    console.log = origLog

    const combined = logs.join('\n')
    expect(combined).toContain('proc:3')
  })
})
