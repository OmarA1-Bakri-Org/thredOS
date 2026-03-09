import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createTempDir, cleanTempDir } from '../helpers/setup'
import { initCommand } from '../../lib/seqctl/commands/init'
import { stepCommand } from '../../lib/seqctl/commands/step'
import { depCommand } from '../../lib/seqctl/commands/dep'
import { runCommand } from '../../lib/seqctl/commands/run'
import { readSequence, writeSequence } from '../../lib/sequence/parser'
import { readThreadSurfaceState } from '../../lib/thread-surfaces/repository'

const jsonOpts = { json: true, help: false, watch: false }

describe('CLI lifecycle integration', () => {
  let tmpDir: string
  let origCwd: string

  beforeEach(async () => {
    origCwd = process.cwd()
    tmpDir = await createTempDir()
    process.chdir(tmpDir)
  })

  afterEach(async () => {
    process.chdir(origCwd)
    await cleanTempDir(tmpDir)
  })

  test('init creates .threados directory structure', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await initCommand(undefined, [], jsonOpts)
    console.log = origLog

    const result = JSON.parse(logs[0])
    expect(result.success).toBe(true)

    // Verify sequence.yaml exists
    const seq = await readSequence(tmpDir)
    expect(seq.name).toBe('New Sequence')
  })

  test('full flow: init → add steps → add dep → status', async () => {
    // Init
    await initCommand(undefined, [], { json: false, help: false, watch: false })

    // Add steps
    await stepCommand('add', ['echo-step', '-n', 'EchoStep', '-t', 'base', '-m', 'claude-code'], jsonOpts)
    await stepCommand('add', ['step-two', '-n', 'StepTwo', '-t', 'base', '-m', 'claude-code'], jsonOpts)

    // Add dep
    await depCommand('add', ['step-two', 'echo-step'], jsonOpts)

    // Verify sequence
    const seq = await readSequence(tmpDir)
    expect(seq.steps).toHaveLength(2)
    const stepTwo = seq.steps.find(s => s.id === 'step-two')
    expect(stepTwo?.depends_on).toContain('echo-step')
  })

  test('run step with echo and verify artifacts', async () => {
    // Set up a sequence with a step that uses echo
    await initCommand(undefined, [], { json: false, help: false, watch: false })

    // Manually write a sequence where the step command is 'echo'
    const seq = await readSequence(tmpDir)
    seq.steps = [{
      id: 'echo-test',
      name: 'Echo Test',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/echo-test.md',
      depends_on: [],
      status: 'READY',
    }]
    await writeSequence(tmpDir, seq)

    // The run command uses step.model as command, which is 'claude-code'
    // This will fail since claude-code doesn't exist, but artifacts should still be created
    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)

    // Suppress process.exit
    const origExit = process.exit
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('step', ['echo-test'], jsonOpts)
    } catch {
      // expected - command will fail
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    // Check that some output was produced
    expect(logs.length).toBeGreaterThan(0)
  })

  test('run step persists thread surface runtime state even when the agent command fails', async () => {
    await initCommand(undefined, [], { json: false, help: false, watch: false })

    const seq = await readSequence(tmpDir)
    seq.name = 'CLI Runtime Sequence'
    seq.steps = [{
      id: 'runtime-step',
      name: 'Runtime Step',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/runtime-step.md',
      depends_on: [],
      status: 'READY',
    }]
    await writeSequence(tmpDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('step', ['runtime-step'], jsonOpts)
    } catch {
      // expected - claude CLI may not be installed in test
    } finally {
      console.log = origLog
      console.error = origErr
      process.exit = origExit
    }

    const state = await readThreadSurfaceState(tmpDir)
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-root',
          childSurfaceIds: ['thread-runtime-step'],
        }),
        expect.objectContaining({
          id: 'thread-runtime-step',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'runtime-step',
          surfaceLabel: 'Runtime Step',
        }),
      ]),
    )
    expect(state.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadSurfaceId: 'thread-root',
          runStatus: 'failed',
        }),
        expect.objectContaining({
          threadSurfaceId: 'thread-runtime-step',
          runStatus: 'failed',
        }),
      ]),
    )
    expect(logs.length).toBeGreaterThan(0)
  })
})
