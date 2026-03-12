import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { groupCommand } from './group'
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

describe('group parallelize', () => {
  test('assigns group_id and type p to steps', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' }), makeStep({ id: 'b' }), makeStep({ id: 'c' })],
    })
    await writeTestSequence(tempDir, seq)
    await groupCommand('parallelize', ['a', 'b', 'c'], { ...jsonOpts, basePath: tempDir })
    const result = await readSequence(tempDir)
    const gid = result.steps[0].group_id
    expect(gid).toBeDefined()
    for (const s of result.steps) {
      expect(s.group_id).toBe(gid)
      expect(s.type).toBe('p')
    }
  })
})

describe('group list', () => {
  test('lists groups as JSON', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'a', group_id: 'grp-1', type: 'p' }),
        makeStep({ id: 'b', group_id: 'grp-1', type: 'p' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await groupCommand('list', [], { ...jsonOpts, basePath: tempDir })
    console.log = origLog
    const output = JSON.parse(logs[0])
    expect(output.groups['grp-1']).toEqual(['a', 'b'])
  })
})
