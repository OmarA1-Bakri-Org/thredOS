import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { gateCommand } from './gate'
import { readSequence } from '../../sequence/parser'
import { createTempDir, cleanTempDir, makeSequence, makeStep, writeTestSequence } from '../../../test/helpers/setup'

let tempDir: string
const jsonOpts = { json: true, help: false, watch: false }

beforeEach(async () => {
  tempDir = await createTempDir()
})

afterEach(async () => {
  await cleanTempDir(tempDir)
})

describe('gate insert', () => {
  test('inserts a gate', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)
    await gateCommand('insert', ['gate-1', '--name', 'Quality Gate', '--depends-on', 'a'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.gates).toHaveLength(1)
    expect(result.gates[0].id).toBe('gate-1')
    expect(result.gates[0].status).toBe('PENDING')
  })
})

describe('gate approve', () => {
  test('approves a gate', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    await gateCommand('approve', ['gate-1'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.gates[0].status).toBe('APPROVED')
  })
})

describe('gate block', () => {
  test('blocks a gate', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    await gateCommand('block', ['gate-1'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.gates[0].status).toBe('BLOCKED')
  })
})

describe('gate list', () => {
  test('lists gates as JSON', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('list', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.gates).toHaveLength(1)
  })

  test('lists gates in human-readable format', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'Quality Gate', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('list', [], { json: false, help: false, watch: false, basePath: tempDir })
    console.log = origLog
    expect(logs.some(l => l.includes('gate-1'))).toBe(true)
    expect(logs.some(l => l.includes('PENDING'))).toBe(true)
    expect(logs.some(l => l.includes('Quality Gate'))).toBe(true)
  })

  test('lists no gates message when empty', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('list', [], { json: false, help: false, watch: false, basePath: tempDir })
    console.log = origLog
    expect(logs.some(l => l.includes('No gates found'))).toBe(true)
  })
})

// --- Error path tests ---

describe('gate approve error paths', () => {
  test('approve fails when gate not found', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('approve', ['nonexistent'], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('not found')
  })

  test('approve fails when no gate ID provided', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('approve', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Gate ID required')
  })
})

describe('gate block error paths', () => {
  test('block fails when gate not found', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('block', ['nonexistent'], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('not found')
  })

  test('block fails when no gate ID provided', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('block', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Gate ID required')
  })
})

describe('gate insert error paths', () => {
  test('insert fails when gate already exists', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('insert', ['gate-1', '--name', 'Dupe Gate'], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('already exists')
  })

  test('insert fails when no gate ID provided', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('insert', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Usage')
  })

  test('insert with default name uses gate ID', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    await gateCommand('insert', ['gate-2', '--depends-on', 'a'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.gates[0].name).toBe('gate-2')
  })
})

describe('gate unknown subcommand', () => {
  test('unknown subcommand returns error in JSON', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('invalid' as unknown as 'add', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Unknown subcommand')
  })
})

describe('gate human-readable output', () => {
  test('approve prints human-readable success', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('approve', ['gate-1'], { json: false, help: false, watch: false, basePath: tempDir })
    console.log = origLog
    expect(logs.some(l => l.includes('approved'))).toBe(true)
  })

  test('block prints human-readable success', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' })],
      gates: [{ id: 'gate-1', name: 'G', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('block', ['gate-1'], { json: false, help: false, watch: false, basePath: tempDir })
    console.log = origLog
    expect(logs.some(l => l.includes('blocked'))).toBe(true)
  })

  test('insert prints human-readable success', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })], gates: [] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await gateCommand('insert', ['gate-new', '--name', 'New Gate', '--depends-on', 'a'], { json: false, help: false, watch: false, basePath: tempDir })
    console.log = origLog
    expect(logs.some(l => l.includes('inserted'))).toBe(true)
  })
})
