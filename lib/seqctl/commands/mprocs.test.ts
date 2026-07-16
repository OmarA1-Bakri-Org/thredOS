import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import YAML from 'yaml'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import { mprocsCommand } from './mprocs'

let basePath: string
const options = { json: true, help: false, watch: false }

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-mprocs-cli-'))
  await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0', name: 'mprocs-test', steps: [], gates: [],
  }))
})

afterEach(async () => {
  delete globalThis.__THREADOS_CLI_MPROCS_RUNTIME__
  process.exitCode = 0
  await rm(basePath, { recursive: true, force: true })
})

async function capture(action: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => lines.push(line)
  try { await action() } finally { console.log = original }
  return lines
}

describe('mprocs optional observer', () => {
  test('open failure is truthful and nonzero', async () => {
    globalThis.__THREADOS_CLI_MPROCS_RUNTIME__ = {
      open: () => { throw new Error('mprocs executable unavailable') },
    }
    const lines = await capture(async () => {
      await mprocsCommand('open', [], { ...options, basePath })
    })
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(false)
    expect(process.exitCode).not.toBe(0)
  })

  test('select failure is not swallowed', async () => {
    await writeFile(join(basePath, '.threados', 'state', 'mprocs-map.json'), JSON.stringify({ 'step-a': 2 }))
    globalThis.__THREADOS_CLI_MPROCS_RUNTIME__ = {
      select: async () => { throw new Error('observer socket unavailable') },
    }
    const lines = await capture(async () => {
      await mprocsCommand('select', ['step-a'], { ...options, basePath })
    })
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(false)
    expect(process.exitCode).not.toBe(0)
  })
})
