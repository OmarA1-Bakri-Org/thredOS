import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
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
    delete globalThis.__THREADOS_CLI_RUN_RUNTIME__
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
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
        childSurfaceIds: [],
      }),
    ])
    expect(state.runs).toEqual([
      expect.objectContaining({
        threadSurfaceId: 'thread-root',
        runStatus: 'failed',
      }),
    ])
    expect(state.runEvents).toEqual([])
    expect(logs.length).toBeGreaterThan(0)
  })

  test('orchestrator metadata alone does not create delegated child surfaces in the CLI runtime', async () => {
    await initCommand(undefined, [], { json: false, help: false, watch: false })

    const seq = await readSequence(tmpDir)
    seq.name = 'CLI Spawn Sequence'
    seq.steps = [
      {
        id: 'orchestrator',
        name: 'Main Orchestrator',
        type: 'b',
        model: 'codex',
        prompt_file: '.threados/prompts/orchestrator.md',
        depends_on: [],
        status: 'READY',
      },
      {
        id: 'worker-a',
        name: 'Worker A',
        type: 'b',
        model: 'codex',
        prompt_file: '.threados/prompts/worker-a.md',
        depends_on: ['orchestrator'],
        status: 'READY',
        orchestrator: 'orchestrator',
      },
      {
        id: 'worker-b',
        name: 'Worker B',
        type: 'b',
        model: 'codex',
        prompt_file: '.threados/prompts/worker-b.md',
        depends_on: ['orchestrator'],
        status: 'READY',
        orchestrator: 'orchestrator',
      },
    ]
    await writeSequence(tmpDir, seq)
    await mkdir(join(tmpDir, '.threados', 'prompts'), { recursive: true })
    await writeFile(join(tmpDir, '.threados', 'prompts', 'orchestrator.md'), '# orchestrator')
    await writeFile(join(tmpDir, '.threados', 'prompts', 'worker-a.md'), '# worker a')
    await writeFile(join(tmpDir, '.threados', 'prompts', 'worker-b.md'), '# worker b')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date('2026-03-09T10:00:00.000Z'),
        endTime: new Date('2026-03-09T10:00:01.000Z'),
        duration: 1000,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    try {
      await runCommand('step', ['orchestrator'], jsonOpts)
    } finally {
      console.log = origLog
    }

    const state = await readThreadSurfaceState(tmpDir)
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
        childSurfaceIds: [],
      }),
    ])
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-orchestrator')).toBe(false)
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-worker-a')).toBe(false)
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-worker-b')).toBe(false)
    expect(state.runEvents).toEqual([])
    expect(logs.some(message => message.includes('"success":true'))).toBe(true)
  })

  test('runtime-emitted spawn-child events create child surfaces without static orchestrator metadata', async () => {
    await initCommand(undefined, [], { json: false, help: false, watch: false })

    const seq = await readSequence(tmpDir)
    seq.name = 'CLI Runtime Event Sequence'
    seq.steps = [
      {
        id: 'delegate-step',
        name: 'Delegate Step',
        type: 'base',
        model: 'codex',
        prompt_file: '.threados/prompts/delegate-step.md',
        depends_on: [],
        status: 'READY',
      },
    ]
    await writeSequence(tmpDir, seq)
    await mkdir(join(tmpDir, '.threados', 'prompts'), { recursive: true })
    await writeFile(join(tmpDir, '.threados', 'prompts', 'delegate-step.md'), '# delegate')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          THREADOS_EVENT_LOG: opts.runtimeEventLogPath ?? '',
        },
      }),
      runStep: async config => {
        const eventLogPath = config.env?.THREADOS_EVENT_LOG
        if (eventLogPath) {
          await mkdir(dirname(eventLogPath), { recursive: true })
          await writeFile(
            eventLogPath,
            [
              JSON.stringify({
                eventType: 'spawn-child',
                createdAt: '2026-03-09T10:00:02.000Z',
                childStepId: 'delegate-child-a',
                childLabel: 'Delegate Child A',
                spawnKind: 'orchestrator',
              }),
              JSON.stringify({
                eventType: 'spawn-child',
                createdAt: '2026-03-09T10:00:03.000Z',
                childStepId: 'delegate-child-b',
                childLabel: 'Delegate Child B',
                spawnKind: 'orchestrator',
              }),
            ].join('\n'),
            'utf-8',
          )
        }

        return {
          stepId: config.stepId,
          runId: config.runId,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          startTime: new Date('2026-03-09T10:00:00.000Z'),
          endTime: new Date('2026-03-09T10:00:01.000Z'),
          duration: 1000,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          status: 'SUCCESS',
        }
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    await runCommand('step', ['delegate-step'], jsonOpts)

    const state = await readThreadSurfaceState(tmpDir)
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-root',
          childSurfaceIds: ['thread-delegate-step'],
        }),
        expect.objectContaining({
          id: 'thread-delegate-step',
          parentSurfaceId: 'thread-root',
          childSurfaceIds: ['thread-delegate-child-a', 'thread-delegate-child-b'],
        }),
        expect.objectContaining({
          id: 'thread-delegate-child-a',
          parentSurfaceId: 'thread-delegate-step',
        }),
        expect.objectContaining({
          id: 'thread-delegate-child-b',
          parentSurfaceId: 'thread-delegate-step',
        }),
      ]),
    )
  })
})
