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
})
