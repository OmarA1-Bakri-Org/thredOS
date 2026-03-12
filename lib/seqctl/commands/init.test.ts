import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, access, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let basePath: string
let origCwd: string

describe.serial('initCommand', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-init-test-'))
    origCwd = process.cwd()
    process.chdir(basePath)
  })

  afterEach(async () => {
    process.chdir(origCwd)
    await rm(basePath, { recursive: true, force: true })
  })

  test('creates .threados directory structure', async () => {
    const { initCommand } = await import('./init')
    await initCommand(undefined, [], { json: true, help: false, watch: false })

    // Verify directory structure
    await access(join(basePath, '.threados'))
    await access(join(basePath, '.threados/prompts'))
    await access(join(basePath, '.threados/runs'))
    await access(join(basePath, '.threados/state'))
    await access(join(basePath, '.threados/sequence.yaml'))
  })

  test('creates default sequence.yaml', async () => {
    const { initCommand } = await import('./init')
    await initCommand(undefined, [], { json: true, help: false, watch: false })

    const content = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf8')
    expect(content).toContain('New Sequence')
    expect(content).toContain('version')
  })

  test('does not reinitialize if already initialized', async () => {
    const { initCommand } = await import('./init')
    // First init
    await initCommand(undefined, [], { json: true, help: false, watch: false })
    // Second init should detect existing
    await initCommand(undefined, [], { json: true, help: false, watch: false })
    // If we get here without error, the test passes
    // The command outputs "ThreadOS already initialized" via console.log
  })
})
