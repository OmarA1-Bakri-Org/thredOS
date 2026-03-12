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
})
