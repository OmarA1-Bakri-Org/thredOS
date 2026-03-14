import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string

const emptySequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [],
  gates: [],
}

describe.serial('templateCommand', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-template-test-'))
    await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
    await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(emptySequence))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('apply base template adds steps', async () => {
    const { templateCommand } = await import('./template')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await templateCommand('apply', ['base'], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.template).toBe('base')
    expect(output.stepsAdded.length).toBeGreaterThan(0)
  })

  test('apply parallel template adds multiple steps', async () => {
    const { templateCommand } = await import('./template')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await templateCommand('apply', ['parallel'], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.template).toBe('parallel')
    expect(output.stepsAdded.length).toBeGreaterThan(1)
  })

  test('apply chained template with gates', async () => {
    const { templateCommand } = await import('./template')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await templateCommand('apply', ['chained', '--gates'], { json: true, help: false, watch: false, basePath })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.template).toBe('chained')
    expect(output.gatesAdded.length).toBeGreaterThan(0)
  })

  test('apply updates sequence.yaml on disk', async () => {
    const { templateCommand } = await import('./template')
    await templateCommand('apply', ['base'], { json: true, help: false, watch: false, basePath })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    const seq = YAML.parse(content)
    expect(seq.steps.length).toBeGreaterThan(0)
  })
})
