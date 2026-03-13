import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDir, cleanTempDir, makeSequence, makeStep, writeTestSequence } from '../../../test/helpers/setup'
import { runCommand } from './run'
import { readSequence } from '../../sequence/parser'

let tempDir: string
const jsonOpts = { json: true, help: false, watch: false }

beforeEach(async () => {
  tempDir = await createTempDir()
  // Ensure state directory exists for thread surface operations
  await mkdir(join(tempDir, '.threados/state'), { recursive: true })
  await mkdir(join(tempDir, '.threados/prompts'), { recursive: true })
})

afterEach(async () => {
  delete globalThis.__THREADOS_CLI_RUN_RUNTIME__
  await cleanTempDir(tempDir)
})

describe('run command — unknown subcommand', () => {
  test('returns error for unknown subcommand in JSON mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('invalid', [], { ...jsonOpts, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    const jsonOutput = logs.find(l => {
      try { JSON.parse(l); return true } catch { return false }
    })
    expect(jsonOutput).toBeDefined()
    const output = JSON.parse(jsonOutput!)
    expect(output.success).toBe(false)
    expect(output.error).toContain('Unknown subcommand')
  })

  test('prints error for unknown subcommand in human-readable mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('invalid', [], { json: false, help: false, watch: false, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    expect(logs.some(l => l.includes('Unknown subcommand'))).toBe(true)
  })
})

describe('run step — missing step ID', () => {
  test('returns error when no step ID provided in JSON mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('step', [], { ...jsonOpts, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    const jsonOutput = logs.find(l => {
      try { JSON.parse(l); return true } catch { return false }
    })
    expect(jsonOutput).toBeDefined()
    const output = JSON.parse(jsonOutput!)
    expect(output.success).toBe(false)
    expect(output.error).toContain('Step ID required')
  })

  test('prints error when no step ID provided in human-readable mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('step', [], { json: false, help: false, watch: false, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    expect(logs.some(l => l.includes('Step ID required'))).toBe(true)
  })
})

describe('run group — missing group ID', () => {
  test('returns error when no group ID provided in JSON mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('group', [], { ...jsonOpts, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    const jsonOutput = logs.find(l => {
      try { JSON.parse(l); return true } catch { return false }
    })
    expect(jsonOutput).toBeDefined()
    const output = JSON.parse(jsonOutput!)
    expect(output.success).toBe(false)
    expect(output.error).toContain('Group ID required')
  })

  test('returns error for nonexistent group in JSON mode', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('group', ['nonexistent-group'], { ...jsonOpts, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    const jsonOutput = logs.find(l => {
      try { JSON.parse(l); return true } catch { return false }
    })
    expect(jsonOutput).toBeDefined()
    const output = JSON.parse(jsonOutput!)
    expect(output.success).toBe(false)
    expect(output.error).toContain('No steps found in group')
  })

  test('prints human-readable error for missing group ID', async () => {
    const seq = makeSequence({ steps: [makeStep({ id: 'a' })] })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    const origExit = process.exit
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)
    process.exit = (() => { throw new Error('exit') }) as never

    try {
      await runCommand('group', [], { json: false, help: false, watch: false, basePath: tempDir })
    } catch {
      // expected — process.exit throws
    }

    console.log = origLog
    console.error = origErr
    process.exit = origExit

    expect(logs.some(l => l.includes('Group ID required'))).toBe(true)
  })
})

describe('run runnable — no runnable steps', () => {
  test('returns no runnable steps when all are DONE', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'a', status: 'DONE' }),
        makeStep({ id: 'b', status: 'DONE', depends_on: ['a'] }),
      ],
    })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(0)
    expect(output.error).toContain('No runnable steps')
  })

  test('returns no runnable steps when blocked by dependencies', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'a', status: 'RUNNING' }),
        makeStep({ id: 'b', status: 'READY', depends_on: ['a'] }),
      ],
    })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(0)
    expect(output.error).toContain('No runnable steps')
  })

  test('returns no runnable steps when blocked by unapproved gate', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'a', status: 'DONE' }),
        makeStep({ id: 'b', status: 'READY', depends_on: ['a', 'gate-1'] }),
      ],
      gates: [{ id: 'gate-1', name: 'Gate', depends_on: ['a'], status: 'PENDING' }],
    })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(0)
  })

  test('prints human-readable message when no runnable steps', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a', status: 'DONE' })],
    })
    await writeTestSequence(tempDir, seq)

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog

    expect(logs.some(l => l.includes('No runnable steps'))).toBe(true)
  })
})

describe('run step — with mock runtime', () => {
  test('runs a shell step successfully with mock runtime', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'shell-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/shell-step.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/shell-step.md'), '#!/bin/sh\necho hello\n')

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
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
        exitCode: 0,
        stdout: 'hello',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['shell-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.stepId).toBe('shell-step')
    expect(output.status).toBe('DONE')

    // Verify the step status was persisted
    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps[0].status).toBe('DONE')
  })

  test('run step marks step as FAILED when runtime throws', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'fail-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/fail-step.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/fail-step.md'), '#!/bin/sh\nexit 1\n')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(1)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 50,
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        timedOut: false,
        status: 'FAILED',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['fail-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('FAILED')

    // Verify status persisted
    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps[0].status).toBe('FAILED')
  })

  test('run step prints human-readable output on success', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'hr-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/hr-step.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/hr-step.md'), 'echo ok')

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
        startTime: new Date(),
        endTime: new Date(),
        duration: 200,
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
    const origErr = console.error
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)

    await runCommand('step', ['hr-step'], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog
    console.error = origErr

    const combined = logs.join('\n')
    expect(combined).toContain('completed successfully')
    expect(combined).toContain('Duration')
  })

  test('run step prints human-readable output on failure', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'hr-fail', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/hr-fail.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/hr-fail.md'), 'exit 1')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(1)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 50,
        exitCode: 1,
        stdout: '',
        stderr: 'fail',
        timedOut: false,
        status: 'FAILED',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)

    await runCommand('step', ['hr-fail'], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog
    console.error = origErr

    expect(logs.some(l => l.includes('failed'))).toBe(true)
  })

  test('run step fails when prompt file is missing', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'no-prompt', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/no-prompt.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    // Intentionally do NOT create the prompt file

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['no-prompt'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('FAILED')
    expect(output.error).toContain('Prompt file not found')

    // Verify FAILED status is persisted
    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps[0].status).toBe('FAILED')
  })
})

describe('run runnable — with mock runtime', () => {
  test('executes runnable steps in order', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'step-1', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/step-1.md', depends_on: [] }),
        makeStep({ id: 'step-2', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/step-2.md', depends_on: [] }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/step-1.md'), 'echo 1')
    await writeFile(join(tempDir, '.threados/prompts/step-2.md'), 'echo 2')

    const executedSteps: string[] = []
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => {
        executedSteps.push(config.stepId)
        return {
          stepId: config.stepId,
          runId: config.runId,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          status: 'SUCCESS',
        }
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(2)
    expect(executedSteps).toContain('step-1')
    expect(executedSteps).toContain('step-2')
  })

  test('run runnable prints human-readable summary', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'r-1', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/r-1.md', depends_on: [] }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/r-1.md'), 'echo ok')

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
        startTime: new Date(),
        endTime: new Date(),
        duration: 150,
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

    await runCommand('runnable', [], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog

    const combined = logs.join('\n')
    expect(combined).toContain('Executed 1 step(s)')
    expect(combined).toContain('r-1')
    expect(combined).toContain('DONE')
  })
})

describe('run group — with mock runtime', () => {
  test('runs steps within a group', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'g-1', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/g-1.md', group_id: 'my-group' }),
        makeStep({ id: 'g-2', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/g-2.md', group_id: 'my-group' }),
        makeStep({ id: 'other', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/other.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/g-1.md'), 'echo g1')
    await writeFile(join(tempDir, '.threados/prompts/g-2.md'), 'echo g2')
    await writeFile(join(tempDir, '.threados/prompts/other.md'), 'echo other')

    const executedSteps: string[] = []
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => {
        executedSteps.push(config.stepId)
        return {
          stepId: config.stepId,
          runId: config.runId,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          status: 'SUCCESS',
        }
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('group', ['my-group'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(2)
    expect(executedSteps).toContain('g-1')
    expect(executedSteps).toContain('g-2')
    expect(executedSteps).not.toContain('other')
  })

  test('run group prints human-readable summary', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'gr-1', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/gr-1.md', group_id: 'grp' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/gr-1.md'), 'echo ok')

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
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
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

    await runCommand('group', ['grp'], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog

    const combined = logs.join('\n')
    expect(combined).toContain("Executed 1 step(s) from group 'grp'")
    expect(combined).toContain('DONE')
  })

  test('run group only runs READY steps with satisfied dependencies', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'dep-done', status: 'DONE', model: 'shell', prompt_file: '.threados/prompts/dep-done.md' }),
        makeStep({ id: 'grp-ready', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/grp-ready.md', group_id: 'grp2', depends_on: ['dep-done'] }),
        makeStep({ id: 'grp-blocked', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/grp-blocked.md', group_id: 'grp2', depends_on: ['not-done'] }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/dep-done.md'), 'echo done')
    await writeFile(join(tempDir, '.threados/prompts/grp-ready.md'), 'echo ready')
    await writeFile(join(tempDir, '.threados/prompts/grp-blocked.md'), 'echo blocked')

    const executedSteps: string[] = []
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => {
        executedSteps.push(config.stepId)
        return {
          stepId: config.stepId,
          runId: config.runId,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          status: 'SUCCESS',
        }
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('group', ['grp2'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    // Only grp-ready should run, grp-blocked should not (dep not satisfied)
    expect(executedSteps).toContain('grp-ready')
    expect(executedSteps).not.toContain('grp-blocked')
  })
})
