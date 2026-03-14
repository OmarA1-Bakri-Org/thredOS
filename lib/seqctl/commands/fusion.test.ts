import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { fusionCommand } from './fusion'
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

describe('fusion create', () => {
  test('creates fusion with candidates and synth', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'c1', type: 'f' }),
        makeStep({ id: 'c2', type: 'f' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await fusionCommand('create', ['--candidates', 'c1,c2', '--synth', 'synth-1'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    const c1 = result.steps.find(s => s.id === 'c1')!
    expect(c1.fusion_candidates).toBe(true)
    expect(c1.type).toBe('f')
    const synth = result.steps.find(s => s.id === 'synth-1')!
    expect(synth).toBeDefined()
    expect(synth.fusion_synth).toBe(true)
    expect(synth.depends_on).toContain('c1')
    expect(synth.depends_on).toContain('c2')
  })

  test('rejects with missing candidates', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    const origExit = process.exit
    process.exit = (() => { throw new Error('exit') }) as never
    try {
      await fusionCommand('create', ['--candidates', 'a', '--synth', 's'], { ...jsonOpts, basePath: tempDir })
    } catch {}
    console.log = origLog
    process.exit = origExit
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
  })
})
