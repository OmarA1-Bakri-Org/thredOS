import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { depCommand } from './dep'
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

describe('dep add', () => {
  test('adds dependency between steps', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' }), makeStep({ id: 'b' })],
    })
    await writeTestSequence(tempDir, seq)
    await depCommand('add', ['b', 'a'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.steps.find(s => s.id === 'b')!.depends_on).toContain('a')
  })

  test('rejects dep to nonexistent step', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)
    // Capture console output - should log JSON with error
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    const origExit = process.exit
    process.exit = (() => { throw new Error('exit') }) as never
    try {
      await depCommand('add', ['a', 'nonexistent'], { ...jsonOpts, basePath: tempDir })
    } catch {}
    console.log = origLog
    process.exit = origExit
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
  })

  test('rejects circular dependency', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a', depends_on: ['b'] }), makeStep({ id: 'b' })],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    const origExit = process.exit
    process.exit = (() => { throw new Error('exit') }) as never
    try {
      await depCommand('add', ['b', 'a'], { ...jsonOpts, basePath: tempDir })
    } catch {}
    console.log = origLog
    process.exit = origExit
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.error).toContain('Circular')
  })
})

describe('dep rm', () => {
  test('removes dependency', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' }), makeStep({ id: 'b', depends_on: ['a'] })],
    })
    await writeTestSequence(tempDir, seq)
    await depCommand('rm', ['b', 'a'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    expect(result.steps.find(s => s.id === 'b')!.depends_on).not.toContain('a')
  })
})
