import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string

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
    await setupTestEnv()
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('add creates a new step', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('add', ['step-c', '--name', 'Step C'], { json: true, help: false, watch: false, basePath })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps.length).toBe(3)
    expect(seq.steps[2].id).toBe('step-c')
  })

  test('edit updates a step name', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('edit', ['step-a', '--name', 'Updated A'], { json: true, help: false, watch: false, basePath })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps[0].name).toBe('Updated A')
  })

  test('clone duplicates a step', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('clone', ['step-a', 'step-a-copy'], { json: true, help: false, watch: false, basePath })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML parse returns any
    const cloned = seq.steps.find((s: any) => s.id === 'step-a-copy')
    expect(cloned).toBeDefined()
    expect(cloned.name).toContain('copy')
  })

  // --- rm subcommand tests ---

  test('rm removes an existing step with no dependents', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    // step-b depends on step-a, so remove step-b first (no dependents)
    await stepCommand('rm', ['step-b'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.action).toBe('rm')
    expect(output.stepId).toBe('step-b')

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps.length).toBe(1)
    expect(seq.steps[0].id).toBe('step-a')
  })

  test('rm fails when step has dependents', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    // step-a has step-b depending on it
    await stepCommand('rm', ['step-a'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('step-b')
    expect(output.error).toContain('depend on')
  })

  test('rm fails for nonexistent step', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('rm', ['nonexistent'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('not found')
  })

  test('rm fails when no step ID is provided', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('rm', [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Step ID required')
  })

  // --- add error path tests ---

  test('add fails when step already exists', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('add', ['step-a'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('already exists')
  })

  test('add fails when no step ID is provided', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('add', [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Step ID required')
  })

  // --- edit error path tests ---

  test('edit fails for nonexistent step', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('edit', ['nonexistent', '--name', 'New Name'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('not found')
  })

  test('edit fails when no step ID is provided', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('edit', [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Step ID required')
  })

  test('edit updates step type and model', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('edit', ['step-a', '--type', 'p', '--model', 'codex'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps[0].type).toBe('p')
    expect(seq.steps[0].kind).toBe('p')
    expect(seq.steps[0].model).toBe('codex')
  })

  test('edit updates depends-on', async () => {
    const { stepCommand } = await import('./step')
    // Add step-c first
    await stepCommand('add', ['step-c', '--name', 'Step C'], { json: true, help: false, watch: false, basePath })

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('edit', ['step-c', '--depends-on', 'step-a'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepC = seq.steps.find((s: any) => s.id === 'step-c')
    expect(stepC.depends_on).toContain('step-a')
  })

  // --- clone error path tests ---

  test('clone fails when source step not found', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('clone', ['nonexistent', 'new-step'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('not found')
  })

  test('clone fails when target ID already exists', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('clone', ['step-a', 'step-b'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('already exists')
  })

  test('clone fails when no IDs provided', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('clone', [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Usage')
  })

  // --- unknown subcommand ---

  test('unknown subcommand returns error', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('invalid', [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Unknown subcommand')
  })

  test('undefined subcommand returns error', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand(undefined, [], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Unknown subcommand')
  })

  // --- add with options ---

  test('add creates step with custom type, model, side effect, workspace, and cwd', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('add', [
      'step-d', '--type', 'p', '--model', 'codex', '--cwd', 'packages/app',
      '--side-effect', 'read', '--workspace', 'isolated',
    ], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepD = seq.steps.find((s: any) => s.id === 'step-d')
    expect(stepD.type).toBe('p')
    expect(stepD.model).toBe('codex')
    expect(stepD.cwd).toBe('packages/app')
    expect(stepD.side_effect_class).toBe('read')
    expect(stepD.workspace_mode).toBe('isolated')
  })

  test('add rejects an absolute or traversing cwd without changing the sequence', async () => {
    const { stepCommand } = await import('./step')

    for (const [stepId, cwd] of [['step-absolute', '/tmp/workdir'], ['step-traversal', '../escape']]) {
      const logs: string[] = []
      const origLog = console.log
      console.log = (msg: string) => logs.push(msg)
      await stepCommand('add', [stepId, '--cwd', cwd], { json: true, help: false, watch: false, basePath })
      console.log = origLog

      expect(JSON.parse(logs[0])).toMatchObject({ success: false, action: 'add', stepId })
    }

    const seq = YAML.parse(await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8'))
    expect(seq.steps.map((step: { id: string }) => step.id)).not.toContain('step-absolute')
    expect(seq.steps.map((step: { id: string }) => step.id)).not.toContain('step-traversal')
  })

  test('edit rejects a traversing cwd without changing the step', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await stepCommand('edit', ['step-a', '--cwd', '../escape'], {
      json: true, help: false, watch: false, basePath,
    })
    console.log = origLog

    expect(JSON.parse(logs[0])).toMatchObject({ success: false, action: 'edit', stepId: 'step-a' })
    const seq = YAML.parse(await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8'))
    expect(seq.steps[0].cwd).toBeUndefined()
  })

  test('edit persists explicit side effect and workspace values', async () => {
    const { stepCommand } = await import('./step')
    await stepCommand('edit', ['step-a', '--side-effect', 'execute', '--workspace', 'isolated'], {
      json: true, help: false, watch: false, basePath,
    })

    const seq = YAML.parse(await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8'))
    expect(seq.steps[0].side_effect_class).toBe('execute')
    expect(seq.steps[0].workspace_mode).toBe('isolated')
  })

  test('add creates step with depends-on', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('add', ['step-e', '--depends-on', 'step-a,step-b'], { json: true, help: false, watch: false, basePath })

    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepE = seq.steps.find((s: any) => s.id === 'step-e')
    expect(stepE.depends_on).toContain('step-a')
    expect(stepE.depends_on).toContain('step-b')
  })

  // --- non-JSON output mode ---

  test('successful add prints human-readable message', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('add', ['step-f', '--name', 'Step F'], { json: false, help: false, watch: false, basePath })

    console.log = origLog
    expect(logs.some(l => l.includes('added successfully'))).toBe(true)
  })

  test('successful rm prints human-readable message', async () => {
    const { stepCommand } = await import('./step')
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await stepCommand('rm', ['step-b'], { json: false, help: false, watch: false, basePath })

    console.log = origLog
    expect(logs.some(l => l.includes('removed successfully'))).toBe(true)
  })
})
