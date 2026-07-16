import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { depCommand } from '../../lib/seqctl/commands/dep'
import { initCommand } from '../../lib/seqctl/commands/init'
import { runCommand } from '../../lib/seqctl/commands/run'
import { stepCommand } from '../../lib/seqctl/commands/step'
import { clearRuntimeServiceFactoryForTests } from '../../lib/runtime/factory'
import { readSequence, writeSequence } from '../../lib/sequence/parser'
import { readThreadSurfaceState } from '../../lib/thread-surfaces/repository'
import { cleanTempDir, createTempDir } from '../helpers/setup'

const jsonOptions = { json: true, help: false, watch: false }

describe('CLI lifecycle integration', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await createTempDir()
    process.exitCode = 0
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
    delete globalThis.__THREADOS_CLI_RUN_RUNTIME__
    clearRuntimeServiceFactoryForTests()
    process.exitCode = 0
    await cleanTempDir(basePath)
  })

  test('init creates the local sequence', async () => {
    await initCommand(undefined, [], { ...jsonOptions, basePath })
    expect((await readSequence(basePath)).name).toBe('New Sequence')
  })

  test('configuration flow remains compatible', async () => {
    await initCommand(undefined, [], { ...jsonOptions, basePath })
    await stepCommand('add', ['echo-step', '-n', 'EchoStep', '-t', 'base', '-m', 'claude-code'], { ...jsonOptions, basePath })
    await stepCommand('add', ['step-two', '-n', 'StepTwo', '-t', 'base', '-m', 'claude-code'], { ...jsonOptions, basePath })
    await depCommand('add', ['step-two', 'echo-step'], { ...jsonOptions, basePath })
    const sequence = await readSequence(basePath)
    expect(sequence.steps).toHaveLength(2)
    expect(sequence.steps.find(step => step.id === 'step-two')?.depends_on).toContain('echo-step')
  })

  test('run step delegates through the real shared service and persists canonical state', async () => {
    await initCommand(undefined, [], { ...jsonOptions, basePath })
    const sequence = await readSequence(basePath)
    sequence.steps = [{
      id: 'echo-test', name: 'Echo Test', type: 'base', model: 'shell',
      prompt_file: '.threados/prompts/echo-test.md', depends_on: [], status: 'READY',
    }]
    await writeSequence(basePath, sequence)
    await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'prompts', 'echo-test.md'), '#!/bin/sh\necho hello-threados\n')

    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await runCommand('step', ['echo-test'], { ...jsonOptions, basePath })
    } finally {
      console.log = original
    }

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).schemaVersion).toBe(1)
    const state = await readThreadSurfaceState(basePath)
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({ id: 'thread-root', workflowRunId: expect.any(String) }),
    ])
    expect(state.runs).toHaveLength(1)
  })

  test('agent unavailability is a truthful failure and still persists runtime evidence', async () => {
    await initCommand(undefined, [], { ...jsonOptions, basePath })
    const sequence = await readSequence(basePath)
    sequence.steps = [{
      id: 'missing-agent', name: 'Missing Agent', type: 'base', model: 'claude-code',
      prompt_file: '.threados/prompts/missing-agent.md', depends_on: [], status: 'READY',
    }]
    await writeSequence(basePath, sequence)

    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await runCommand('step', ['missing-agent'], { ...jsonOptions, basePath })
    } finally {
      console.log = original
    }

    expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({ schemaVersion: 1, success: false }))
    expect(process.exitCode).not.toBe(0)
    const state = await readThreadSurfaceState(basePath)
    expect(state.runs).toEqual([expect.objectContaining({ runStatus: 'failed' })])
  })
})
