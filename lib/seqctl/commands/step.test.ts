import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string
let origCwd: string

const baseSequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [
    { id: 'step-a', name: 'Step A', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'READY' },
    { id: 'step-b', name: 'Step B', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-b.md', depends_on: ['step-a'], status: 'READY' },
  ],
  gates: [],
}

async function setupTestEnv() {
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(baseSequence))
  await writeFile(join(basePath, '.threados/prompts/step-a.md'), '# Step A')
  await writeFile(join(basePath, '.threados/prompts/step-b.md'), '# Step B')
}

describe.serial('stepCommand', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-step-test-'))
    origCwd = process.cwd()
    process.chdir(basePath)
    await setupTestEnv()
  })

  afterEach(async () => {
    process.chdir(origCwd)
    await rm(basePath, { recursive: true, force: true })
  })

  test('add creates a new step', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('add', ['step-c', '--name', 'Step C'], { json: true, help: false, watch: false })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps.length).toBe(3)
    expect(seq.steps[2].id).toBe('step-c')
  })

  test('edit updates a step name', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('edit', ['step-a', '--name', 'Updated A'], { json: true, help: false, watch: false })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps[0].name).toBe('Updated A')
  })

  test('clone duplicates a step', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('clone', ['step-a', 'step-a-copy'], { json: true, help: false, watch: false })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML parse returns any
    const cloned = seq.steps.find((s: any) => s.id === 'step-a-copy')
    expect(cloned).toBeDefined()
    expect(cloned.name).toContain('copy')
  })
})
