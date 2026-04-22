import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDir, cleanTempDir, makeSequence, makeStep, writeTestSequence } from '../../../test/helpers/setup'
import { runCommand } from './run'
import { readSequence } from '../../sequence/parser'
import { appendApproval, readApprovals } from '../../approvals/repository'
import { readTraceEvents } from '../../traces/reader'
import { runStep as executeProcess } from '../../runner/wrapper'
import { emptyThreadSurfaceState, createRootThreadSurfaceRun, createChildThreadSurfaceRun } from '../../thread-surfaces/mutations'
import { writeThreadSurfaceState } from '../../thread-surfaces/repository'
import { deriveStepThreadSurfaceId } from '../../thread-surfaces/constants'

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

describe('run step native action execution', () => {
  test('executes cli, write_file, sub_agent, and rube_tool actions with runtime context outputs', async () => {
    const artifactDir = join(tempDir, 'apollo-artifacts')
    const icpConfigPath = join(artifactDir, 'icp-config.json')
    const qualifiedSegmentPath = join(artifactDir, 'qualified-segment.json')
    const composioCalls: Array<{ toolSlug: string; arguments: Record<string, unknown> }> = []

    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'native-actions',
          model: 'codex',
          status: 'READY',
          prompt_file: '.threados/prompts/native-actions.md',
          actions: [
            { id: 'cli-action', type: 'cli', config: { command: "printf 'cli-ok'" }, output_key: 'cli_result' },
            { id: 'write-icp', type: 'write_file', config: { file_path: icpConfigPath }, output_key: 'icp_config_file' },
            { id: 'spawn-artifact-agent', type: 'sub_agent', config: { prompt: 'Write the qualified segment artifact JSON.', subagent_type: 'general-purpose' }, output_key: 'sub_agent_result' },
            { id: 'apollo-alias', type: 'rube_tool' as any, config: { tool_slug: 'APOLLO_TEST_TOOL', arguments: { query: 'segment' } }, output_key: 'apollo_tool_result' },
          ] as any,
        }),
      ],
    })

    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/native-actions.md'), '# native actions')
    await writeFile(
      join(tempDir, '.threados/state/runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved'], output: { apollo_stage_name: 'Review' } } }),
      'utf-8',
    )

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        if (opts.stepId.endsWith('spawn-artifact-agent')) {
          const script = `const fs=require('fs');fs.mkdirSync(${JSON.stringify(artifactDir)},{recursive:true});fs.writeFileSync(${JSON.stringify(qualifiedSegmentPath)}, JSON.stringify({segment_name:'Mid-Market',total_qualified:1}, null, 2));`
          return {
            stepId: opts.stepId,
            runId: opts.runId,
            command: process.execPath,
            args: ['-e', script],
            cwd: opts.cwd,
            timeout: opts.timeout,
          }
        }

        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: executeProcess,
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async input => {
        composioCalls.push({ toolSlug: input.toolSlug, arguments: input.arguments })
        return { ok: true, tool: input.toolSlug }
      },
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['native-actions'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.status).toBe('DONE')

    const runtimeContext = JSON.parse(await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.cli_result).toMatchObject({ stdout: 'cli-ok', exitCode: 0, status: 'success' })
    expect(runtimeContext.icp_config_file).toMatchObject({ path: icpConfigPath, status: 'written', sourceKey: 'icp_config' })
    expect(runtimeContext.sub_agent_result).toMatchObject({ status: 'success', exitCode: 0, subagentType: 'general-purpose' })
    expect(runtimeContext.apollo_tool_result).toEqual({ ok: true, tool: 'APOLLO_TEST_TOOL' })

    expect(JSON.parse(await readFile(icpConfigPath, 'utf-8'))).toEqual({ sources: ['apollo_saved'], output: { apollo_stage_name: 'Review' } })
    expect(JSON.parse(await readFile(qualifiedSegmentPath, 'utf-8'))).toEqual({ segment_name: 'Mid-Market', total_qualified: 1 })
    expect(composioCalls).toEqual([{ toolSlug: 'APOLLO_TEST_TOOL', arguments: { query: 'segment' } }])
  })

  test('sub_agent under a shell parent falls back to claude-code instead of inheriting shell', async () => {
    const dispatchModels: string[] = []

    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'shell-parent-subagent',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/shell-parent-subagent.md',
          actions: [
            { id: 'spawn-subagent', type: 'sub_agent', config: { prompt: 'Say OK.', subagent_type: 'general-purpose' }, output_key: 'sub_agent_result' },
          ] as any,
        }),
      ],
    })

    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/shell-parent-subagent.md'), 'exit 0\n')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (model, opts) => {
        dispatchModels.push(model)
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: executeProcess,
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['shell-parent-subagent'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(dispatchModels).toEqual(['claude-code', 'shell'])

    const runtimeContext = JSON.parse(await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.sub_agent_result).toMatchObject({ status: 'success', model: 'claude-code', subagentType: 'general-purpose' })
    expect(runtimeContext.sub_agent_result.prompt).toContain('Exit 0 only if you actually completed the requested work')
  })

  test('sub_agent zero-exit refusal payload fails the parent step instead of being treated as success', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'blocked-subagent',
          model: 'codex',
          status: 'READY',
          prompt_file: '.threados/prompts/blocked-subagent.md',
          actions: [
            { id: 'spawn-subagent', type: 'sub_agent', config: { prompt: 'Open the restricted admin tool and finish the task.', subagent_type: 'general-purpose' }, output_key: 'sub_agent_result' },
          ] as any,
        }),
      ],
    })

    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/blocked-subagent.md'), '# blocked subagent')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: opts.cwd,
        timeout: opts.timeout,
      }),
      runStep: async config => config.stepId.endsWith('spawn-subagent')
        ? {
            stepId: config.stepId,
            runId: config.runId,
            exitCode: 0,
            status: 'SUCCESS' as const,
            duration: 5,
            stdout: 'I cannot access the requested admin tool because I do not have permission to use it.',
            stderr: '',
            startTime: new Date('2026-03-10T10:00:00.000Z'),
            endTime: new Date('2026-03-10T10:00:05.000Z'),
          }
        : {
            stepId: config.stepId,
            runId: config.runId,
            exitCode: 0,
            status: 'SUCCESS' as const,
            duration: 5,
            stdout: 'parent ok',
            stderr: '',
            startTime: new Date('2026-03-10T10:00:10.000Z'),
            endTime: new Date('2026-03-10T10:00:15.000Z'),
          },
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['blocked-subagent'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('FAILED')
    expect(output.error).toContain('did not produce completion evidence')

    const persisted = await readSequence(tempDir)
    expect(persisted.steps.find(step => step.id === 'blocked-subagent')?.status).toBe('FAILED')

    const runtimeContext = JSON.parse(await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.sub_agent_result).toMatchObject({ status: 'needs_review', exitCode: 0 })
    expect(runtimeContext.sub_agent_result.reviewReasons).toContain('OBVIOUS_NON_COMPLETION_PAYLOAD')
  })
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
      gates: [{ id: 'gate-1', name: 'Gate', depends_on: ['a'], status: 'PENDING', cascade: false, childGateIds: [] }],
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

  test('marks false-condition READY steps as durable SKIPPED', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'a', status: 'READY', condition: "icp_config.sources contains 'apollo_discovery'" } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/state/runtime-context.json'), JSON.stringify({ icp_config: { sources: ['apollo_saved'] } }), 'utf-8')

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.executed).toHaveLength(0)
    expect(output.error).toBeUndefined()
    expect(output.skipped).toEqual(['a'])

    const updatedSequence = await readSequence(tempDir)
    expect(updatedSequence.steps.find(step => step.id === 'a')?.status).toBe('SKIPPED')
  })

  test('run step returns SKIPPED without dispatch when the top-level step condition is false', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'conditional-step',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/conditional-step.md',
          condition: "icp_config.sources contains 'apollo_discovery'",
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/conditional-step.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/state/runtime-context.json'), JSON.stringify({ icp_config: { sources: ['apollo_saved'] } }), 'utf-8')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: executeProcess,
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['conditional-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('SKIPPED')
    expect(output.error).toContain("condition evaluated false")
    expect(dispatchCalls).toBe(0)

    const updatedSequence = await readSequence(tempDir)
    expect(updatedSequence.steps.find(step => step.id === 'conditional-step')?.status).toBe('SKIPPED')
  })

  test('marks false-condition optional steps as SKIPPED and continues downstream mandatory work', async () => {
    const dispatchOrder: string[] = []
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'optional-branch',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/optional-branch.md',
          condition: "icp_config.sources contains 'apollo_discovery'",
        } as any),
        makeStep({
          id: 'mandatory-downstream',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/mandatory-downstream.md',
          depends_on: ['optional-branch'],
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/optional-branch.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/prompts/mandatory-downstream.md'), 'echo mandatory-ran')
    await writeFile(join(tempDir, '.threados/state/runtime-context.json'), JSON.stringify({ icp_config: { sources: ['apollo_saved'] } }), 'utf-8')

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
        dispatchOrder.push(config.stepId)
        return {
          stepId: config.stepId,
          runId: config.runId,
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
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
    expect(output.executed).toHaveLength(1)
    expect(output.executed[0]).toMatchObject({ stepId: 'mandatory-downstream', success: true, status: 'DONE' })
    expect(output.skipped).toEqual(['optional-branch'])
    expect(output.waiting).toEqual([])
    expect(dispatchOrder).toEqual(['mandatory-downstream'])

    const updatedSequence = await readSequence(tempDir)
    expect(updatedSequence.steps.find(step => step.id === 'optional-branch')?.status).toBe('SKIPPED')
    expect(updatedSequence.steps.find(step => step.id === 'mandatory-downstream')?.status).toBe('DONE')
  })

  test('returns runnable step when runtime context satisfies condition', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'ctx-step', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/ctx-step.md', condition: "icp_config.sources contains 'apollo_discovery'" } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/ctx-step.md'), 'echo ok')
    await writeFile(join(tempDir, '.threados/state/runtime-context.json'), JSON.stringify({ icp_config: { sources: ['apollo_saved', 'apollo_discovery'] } }), 'utf-8')

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
          duration: 10,
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
    expect(output.executed).toHaveLength(1)
    expect(executedSteps).toEqual(['ctx-step'])
  })

  test('surfaces malformed runtime context instead of silently treating it as empty', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'ctx-step', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/ctx-step.md', condition: "icp_config.sources contains 'apollo_discovery'" } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/ctx-step.md'), 'echo ok')
    await writeFile(join(tempDir, '.threados/state/runtime-context.json'), '{not valid json', 'utf-8')

    await expect(runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })).rejects.toThrow(/runtime-context\.json|JSON|Unexpected token|Expected property name/i)
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

  test('run step downgrades zero-exit blocked payloads to NEEDS_REVIEW', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'blocked-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/blocked-step.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/blocked-step.md'), '#!/bin/sh\necho blocked\n')

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
        duration: 50,
        exitCode: 0,
        stdout: 'I cannot complete this because the required tool is unavailable in this environment.',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['blocked-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('NEEDS_REVIEW')

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps[0].status).toBe('NEEDS_REVIEW')
  })

  test('run step downgrades zero-exit permission denied payloads to NEEDS_REVIEW', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'permission-denied-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/permission-denied-step.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/permission-denied-step.md'), '#!/bin/sh\necho blocked\n')

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
        duration: 50,
        exitCode: 0,
        stdout: 'Permission denied: cannot access the requested admin tool from this environment.',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['permission-denied-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('NEEDS_REVIEW')

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps[0].status).toBe('NEEDS_REVIEW')
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

  test('run step honors a custom prompt_file instead of the default step-id prompt path', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'custom-prompt-step', model: 'shell', status: 'READY', prompt_file: '.threados/prompts/custom/location.md' }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await mkdir(join(tempDir, '.threados/prompts/custom'), { recursive: true })
    await writeFile(join(tempDir, '.threados/prompts/custom/location.md'), '#!/bin/sh\necho custom prompt\n')

    let compiledPromptSeen = ''
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        compiledPromptSeen = opts.compiledPrompt
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 25,
        exitCode: 0,
        stdout: 'custom prompt',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['custom-prompt-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.status).toBe('DONE')
    expect(compiledPromptSeen).toContain('echo custom prompt')
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

  test('run step executes composio actions natively, persists output_key, and still dispatches the prompt', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'action-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/action-step.md',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: {
              tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
              arguments: { team: 'growth' },
            },
            output_key: 'apollo_usage',
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/action-step.md'), 'echo action')

    let compiledPromptSeen = ''
    const composioCalls: Array<{ toolSlug: string, arguments: Record<string, unknown> }> = []
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        compiledPromptSeen = opts.compiledPrompt
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async ({ toolSlug, arguments: args }) => {
        composioCalls.push({ toolSlug, arguments: args })
        return { usage_remaining: 42, team: args.team }
      },
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['action-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    expect(composioCalls).toEqual([{ toolSlug: 'APOLLO_VIEW_API_USAGE_STATS', arguments: { team: 'growth' } }])
    const runtimeContext = JSON.parse(await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.apollo_usage).toEqual({ usage_remaining: 42, team: 'growth' })
    expect(compiledPromptSeen).toContain('THREADOS ACTION CONTRACT')
    expect(compiledPromptSeen).toContain('apollo-usage')
    expect(compiledPromptSeen).toContain('APOLLO_VIEW_API_USAGE_STATS')
  })

  test('run step downgrades contract-bound composio steps when the expected persisted output is missing', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'contract-action-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/contract-action-step.md',
          output_contract_ref: 'contracts/apollo-usage.json',
          completion_contract: 'contracts/apollo-usage-complete.json',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: {
              tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
              arguments: { team: 'growth' },
            },
            output_key: 'apollo_usage',
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/contract-action-step.md'), 'echo action')

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
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async () => null,
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['contract-action-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('NEEDS_REVIEW')

    const persisted = await readSequence(tempDir)
    expect(persisted.steps.find(step => step.id === 'contract-action-step')?.status).toBe('NEEDS_REVIEW')
  })

  test('run step prints NEEDS_REVIEW in human-readable output when completion is downgraded', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'needs-review-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/needs-review-step.md',
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/needs-review-step.md'), 'echo ok')

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
        duration: 15,
        exitCode: 0,
        stdout: 'I do not have permission to perform that action.',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    const origErr = console.error
    console.log = (msg: string) => logs.push(msg)
    console.error = (msg: string) => logs.push(msg)

    await runCommand('step', ['needs-review-step'], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog
    console.error = origErr

    expect(logs.some(line => line.includes("needs review"))).toBe(true)
    expect(logs.some(line => line.includes('failed'))).toBe(false)
  })

  test('run step executes native conditional actions, supports nested path length checks, and persists only the selected branch output', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'conditional-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/conditional-step.md',
          actions: [{
            id: 'choose-apollo-source',
            type: 'conditional',
            config: {
              condition: 'icp_config.sources.length == 2',
              if_true: [{
                id: 'selected-source',
                type: 'composio_tool',
                config: {
                  tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
                  arguments: { team: 'growth' },
                },
                output_key: 'selected_branch',
              }],
              if_false: [{
                id: 'fallback-source',
                type: 'composio_tool',
                config: {
                  tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
                  arguments: { team: 'fallback' },
                },
                output_key: 'unselected_branch',
              }],
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/conditional-step.md'), 'echo conditional')
    await writeFile(
      join(tempDir, '.threados/state/runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved', 'apollo_discovery'] } }),
      'utf-8',
    )

    const composioCalls: Array<{ toolSlug: string, arguments: Record<string, unknown> }> = []
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
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async ({ toolSlug, arguments: args }) => {
        composioCalls.push({ toolSlug, arguments: args })
        return { team: args.team, branch: 'selected' }
      },
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['conditional-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(composioCalls).toEqual([{ toolSlug: 'APOLLO_VIEW_API_USAGE_STATS', arguments: { team: 'growth' } }])
    const runtimeContext = JSON.parse(await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.selected_branch).toEqual({ team: 'growth', branch: 'selected' })
    expect(runtimeContext.unselected_branch).toBeUndefined()
  })

  test('run step evaluates first_run as true for native conditional actions on the first execution', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'first-run-conditional-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/first-run-conditional-step.md',
          actions: [{
            id: 'first-run-gate',
            type: 'conditional',
            config: {
              condition: 'first_run == true',
              if_true: [{
                id: 'approval-on-first-run',
                type: 'approval',
                description: 'first_run branch executed',
              }],
              if_false: [{
                id: 'unexpected-branch',
                type: 'approval',
                description: 'wrong branch executed',
              }],
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/first-run-conditional-step.md'), 'echo should-not-run')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
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

    await runCommand('step', ['first-run-conditional-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('BLOCKED')
    expect(output.error).toContain('Awaiting approval')
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'first-run-conditional-step')?.status).toBe('BLOCKED')

    const approvals = await readApprovals(tempDir, output.runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      target_ref: 'step:first-run-conditional-step',
      requested_by: 'seqctl:run',
      status: 'pending',
      notes: 'first_run branch executed',
    })
  })

  test('run step aborts the step when a composio action fails with abort_step', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'abort-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/abort-step.md',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS' },
            on_failure: 'abort_step',
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/abort-step.md'), 'echo should-not-run')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async () => {
        throw new Error('apollo offline')
      },
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['abort-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('FAILED')
    expect(output.error).toContain('apollo offline')
    expect(dispatchCalls).toBe(0)
  })

  test('run step continues when a composio action fails with skip', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'skip-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/skip-step.md',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS' },
            on_failure: 'skip',
            output_key: 'apollo_usage',
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/skip-step.md'), 'echo skip')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async () => {
        throw new Error('transient composio issue')
      },
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['skip-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.status).toBe('DONE')
    expect(dispatchCalls).toBe(1)
    const runtimeContextRaw = await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8').catch(() => '{}')
    const runtimeContext = JSON.parse(runtimeContextRaw)
    expect(runtimeContext.apollo_usage).toBeUndefined()
  })

  test('run step warns and still dispatches when a composio action fails with warn', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'warn-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/warn-step.md',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS' },
            on_failure: 'warn',
            output_key: 'apollo_usage',
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/warn-step.md'), 'echo warn')

    let dispatchCalls = 0
    let compiledPromptSeen = ''
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        compiledPromptSeen = opts.compiledPrompt
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
      runComposioTool: async () => {
        throw new Error('transient composio issue')
      },
    } as any

    const logs: string[] = []
    const warns: string[] = []
    const origLog = console.log
    const origWarn = console.warn
    console.log = (msg: string) => logs.push(msg)
    console.warn = (msg: string) => warns.push(msg)

    await runCommand('step', ['warn-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog
    console.warn = origWarn

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.status).toBe('DONE')
    expect(dispatchCalls).toBe(1)
    expect(compiledPromptSeen).toContain('THREADOS ACTION CONTRACT')
    expect(compiledPromptSeen).toContain('apollo-usage')
    expect(warns).toContain("Composio action 'apollo-usage' failed: transient composio issue")
    const runtimeContextRaw = await readFile(join(tempDir, '.threados/state/runtime-context.json'), 'utf-8').catch(() => '{}')
    const runtimeContext = JSON.parse(runtimeContextRaw)
    expect(runtimeContext.apollo_usage).toBeUndefined()
  })

  test('run step turns approval actions into pending approval records and blocks dispatch', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Review outbound Apollo updates before continuing',
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('BLOCKED')
    expect(output.error).toContain('Awaiting approval')
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'approval-step')?.status).toBe('BLOCKED')

    const approvals = await readApprovals(tempDir, output.runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      action_type: 'run',
      status: 'pending',
      target_ref: 'step:approval-step',
      requested_by: 'seqctl:run',
      approved_by: null,
      approved_at: null,
      notes: 'Review outbound Apollo updates before continuing',
    })

    const traces = await readTraceEvents(tempDir, output.runId)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      run_id: output.runId,
      surface_id: 'step:approval-step',
      actor: 'seqctl:run',
      event_type: 'approval-requested',
    })
    expect(traces[0]?.payload_ref).toBe(approvals[0]?.id)
  })

  test('run step hydrates approval note placeholders from Apollo artifacts before interpolation', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Review {{qualified_segment.segment_name}} | Saved {{counts.saved}} | Discovery {{counts.discovery}} | Both {{counts.both}} | Persona A {{counts.A}} | Persona E {{counts.E}} | Excluded dupes {{excluded.duplicates}} | Credits {{enriched_segment.credits_used}}/{{icp_config.enrichment.max_apollo_credits}} | Stage {{icp_config.output.apollo_stage_name}} ({{stage_id_or_MISSING}}) | Missing {{missing.path}}',
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')
    const artifactDir = join(tempDir, 'apollo-segment-artifacts')
    await mkdir(artifactDir, { recursive: true })
    await writeFile(
      join(tempDir, '.threados/state/runtime-context.json'),
      JSON.stringify({
        apollo_artifact_dir: artifactDir,
        resolved_stage_id: null,
        icp_config: {
          enrichment: { max_apollo_credits: 55 },
          output: { apollo_stage_name: 'stage-2-review', tag_in_apollo: true },
        },
      }),
      'utf-8',
    )
    await writeFile(join(artifactDir, 'qualified-segment.json'), JSON.stringify({
      segment_name: 'Enterprise',
      total_qualified: 3,
      contacts: [
        { source: 'apollo_saved', persona_lane: 'A' },
        { source: 'apollo_discovery', persona_lane: 'E' },
        { source: ['apollo_saved', 'apollo_discovery'], persona_lane: 'A' },
      ],
      excluded: {
        duplicates: 2,
      },
    }), 'utf-8')
    await writeFile(join(artifactDir, 'enriched-segment.json'), JSON.stringify({
      credits_used: 12,
    }), 'utf-8')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async () => {
        throw new Error('approval action should block before dispatch')
      },
      runStep: async () => {
        throw new Error('approval action should block before runStep')
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    const approvals = await readApprovals(tempDir, output.runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.notes).toBe('Review Enterprise | Saved 1 | Discovery 1 | Both 1 | Persona A 2 | Persona E 1 | Excluded dupes 2 | Credits 12/55 | Stage stage-2-review (MISSING) | Missing {{missing.path}}')
  })

  test('run runnable reports approval-blocked steps as executed evidence and leaves later steps waiting', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          depends_on: [],
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
        makeStep({
          id: 'after-approval',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/after-approval.md',
          depends_on: ['approval-step'],
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/prompts/after-approval.md'), 'echo later')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.executed).toHaveLength(1)
    expect(output.executed[0]).toMatchObject({
      stepId: 'approval-step',
      status: 'BLOCKED',
      success: false,
    })
    expect(output.waiting).toEqual(['after-approval'])
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'approval-step')?.status).toBe('BLOCKED')
    expect(updatedSeq.steps.find(step => step.id === 'after-approval')?.status).toBe('READY')

    const approvals = await readApprovals(tempDir, output.executed[0].runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.status).toBe('pending')
  })

  test('run step consumes a previously approved approval record on rerun', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo approved-rerun')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'approved-rerun',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const firstLogs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => firstLogs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const firstOutput = JSON.parse(firstLogs[0])
    expect(firstOutput.status).toBe('BLOCKED')
    expect(dispatchCalls).toBe(0)

    const [pendingApproval] = await readApprovals(tempDir, firstOutput.runId)
    expect(pendingApproval).toBeDefined()
    await appendApproval(tempDir, firstOutput.runId, {
      ...pendingApproval!,
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T10:00:00.000Z',
    })

    const rerunLogs: string[] = []
    console.log = (msg: string) => rerunLogs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const rerunOutput = JSON.parse(rerunLogs[0])
    expect(rerunOutput.success).toBe(true)
    expect(rerunOutput.status).toBe('DONE')
    expect(dispatchCalls).toBe(1)
    expect(rerunOutput.runId).not.toBe(firstOutput.runId)
    await expect(readApprovals(tempDir, rerunOutput.runId)).resolves.toEqual([])
    await expect(readTraceEvents(tempDir, rerunOutput.runId)).resolves.toEqual([])

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'approval-step')?.status).toBe('DONE')
  })

  test('run runnable reopens blocked approval steps after approval and continues downstream', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
        makeStep({
          id: 'after-approval',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/after-approval.md',
          depends_on: ['approval-step'],
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo approved-rerun')
    await writeFile(join(tempDir, '.threados/prompts/after-approval.md'), 'echo downstream')

    const dispatchOrder: string[] = []
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchOrder.push(opts.stepId)
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: config.stepId,
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const firstLogs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => firstLogs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const firstOutput = JSON.parse(firstLogs[0])
    expect(firstOutput.executed).toHaveLength(1)
    expect(firstOutput.executed[0]?.status).toBe('BLOCKED')
    expect(dispatchOrder).toEqual([])

    const [pendingApproval] = await readApprovals(tempDir, firstOutput.executed[0].runId)
    await appendApproval(tempDir, firstOutput.executed[0].runId, {
      ...pendingApproval!,
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T10:00:00.000Z',
    })

    const rerunLogs: string[] = []
    console.log = (msg: string) => rerunLogs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const rerunOutput = JSON.parse(rerunLogs[0])
    expect(rerunOutput.success).toBe(true)
    expect(rerunOutput.executed).toHaveLength(2)
    expect(rerunOutput.executed.map((entry: { stepId: string }) => entry.stepId)).toEqual(['approval-step', 'after-approval'])
    expect(dispatchOrder).toEqual(['approval-step', 'after-approval'])
    await expect(readApprovals(tempDir, rerunOutput.executed[0].runId)).resolves.toEqual([])

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'approval-step')?.status).toBe('DONE')
    expect(updatedSeq.steps.find(step => step.id === 'after-approval')?.status).toBe('DONE')
  })

  test('run step persists BLOCKED when a READY step is stopped by unresolved dependency blockers', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'gated-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/gated-step.md',
          depends_on: ['quality-gate'],
        }),
      ],
      gates: [{ id: 'quality-gate', name: 'Quality Gate', depends_on: [], status: 'PENDING', cascade: false, childGateIds: [] }],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/gated-step.md'), 'echo should-not-run')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'should-not-run',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['gated-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('BLOCKED')
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'gated-step')?.status).toBe('BLOCKED')
  })

  test('run step keeps approval-blocked steps blocked when dependencies are still unsatisfied after approval', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'upstream',
          model: 'shell',
          status: 'RUNNING',
          prompt_file: '.threados/prompts/upstream.md',
        }),
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'BLOCKED',
          prompt_file: '.threados/prompts/approval-step.md',
          depends_on: ['upstream'],
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/upstream.md'), 'echo upstream')
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')
    await appendApproval(tempDir, 'run-approved-earlier', {
      id: 'approval-approved-earlier',
      action_type: 'run',
      target_ref: 'step:approval-step',
      requested_by: 'seqctl:run',
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T10:00:00.000Z',
      notes: 'Approved already',
    })

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'should-not-run',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('BLOCKED')
    expect(output.error).toContain('dependencies')
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'approval-step')?.status).toBe('BLOCKED')
  })

  test('run step blocks side-effecting write steps under SAFE approved_only when approval evidence is missing', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'policy-blocked-write-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/policy-blocked-write-step.md',
          side_effect_class: 'write',
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/policy-blocked-write-step.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/policy.yaml'), 'mode: SAFE\nside_effect_mode: approved_only\ncross_surface_reads: dependency_only\n')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'should-not-run',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['policy-blocked-write-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.status).toBe('BLOCKED')
    expect(dispatchCalls).toBe(0)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'policy-blocked-write-step')?.status).toBe('BLOCKED')
  })

  test('run step reopens policy-blocked write steps when approval evidence exists', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'step-approved-write',
          model: 'shell',
          status: 'BLOCKED',
          prompt_file: '.threados/prompts/step-approved-write.md',
          side_effect_class: 'write',
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/step-approved-write.md'), 'echo approved-write')
    await writeFile(join(tempDir, '.threados/policy.yaml'), 'mode: SAFE\nside_effect_mode: approved_only\ncross_surface_reads: dependency_only\n')
    await appendApproval(tempDir, 'run-approved-write-earlier', {
      id: 'approval-approved-write-earlier',
      action_type: 'run',
      target_ref: 'step:step-approved-write',
      requested_by: 'seqctl:run',
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T10:00:00.000Z',
      notes: 'Approved already',
    })

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'approved-write',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['step-approved-write'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(output.status).toBe('DONE')
    expect(dispatchCalls).toBe(1)

    const updatedSeq = await readSequence(tempDir)
    expect(updatedSeq.steps.find(step => step.id === 'step-approved-write')?.status).toBe('DONE')
  })

  test('run step keeps approval-blocked thread surface runs pending', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          name: 'Approval Step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')

    const seededState = createChildThreadSurfaceRun(
      createRootThreadSurfaceRun(emptyThreadSurfaceState, {
        surfaceId: 'thread-root',
        surfaceLabel: 'Sequence',
        createdAt: '2026-03-09T10:00:00.000Z',
        runId: 'run-root',
        startedAt: '2026-03-09T10:00:00.000Z',
        executionIndex: 1,
      }).state,
      {
        parentSurfaceId: 'thread-root',
        parentAgentNodeId: 'approval-step',
        childSurfaceId: deriveStepThreadSurfaceId('approval-step'),
        childSurfaceLabel: 'Approval Step',
        createdAt: '2026-03-09T10:00:05.000Z',
        runId: 'run-approval-seed',
        startedAt: '2026-03-09T10:00:05.000Z',
        executionIndex: 2,
      },
    ).state
    await writeThreadSurfaceState(tempDir, seededState)

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async () => {
        throw new Error('approval action should block before dispatch')
      },
      runStep: async () => {
        throw new Error('approval action should block before runStep')
      },
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['approval-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const surfaceState = JSON.parse(
      await readFile(join(tempDir, '.threados/surfaces', deriveStepThreadSurfaceId('approval-step'), 'state.json'), 'utf-8'),
    )
    expect(surfaceState.latestRunStatus).toBe('pending')
  })

  test('run runnable prints approval-blocked steps as BLOCKED in human-readable output', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/approval-step.md',
          actions: [{
            id: 'review-before-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before send',
            },
          }],
        } as any),
        makeStep({
          id: 'after-approval',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/prompts/after-approval.md',
          depends_on: ['approval-step'],
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-step.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/prompts/after-approval.md'), 'echo later')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog

    expect(dispatchCalls).toBe(0)
    expect(logs).toContain('Executed 1 step(s)')
    expect(logs.some(line => line.includes('approval-step: BLOCKED'))).toBe(true)
    expect(logs.some(line => line.includes('approval-step: FAILED'))).toBe(false)
    expect(logs.some(line => line.includes('Waiting 1 step(s) on blocked dependencies:'))).toBe(true)
    expect(logs.some(line => line.includes('after-approval'))).toBe(true)
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

  test('run step respects custom prompt_file paths and persists canonical artifacts like API', async () => {
    const dispatchedPrompts: string[] = []
    const savedArtifacts: Array<Record<string, unknown>> = []
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'custom-prompt-step',
          model: 'shell',
          status: 'READY',
          prompt_file: '.threados/custom-prompts/runtime/custom-prompt-step.md',
          surface_ref: 'thread-custom-prompt-step',
          actions: [{
            id: 'document-contract',
            type: 'conditional',
            config: {
              condition: '1 == 2',
              if_true: [],
              if_false: [],
            },
          }] as any,
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await mkdir(join(tempDir, '.threados/custom-prompts/runtime'), { recursive: true })
    await writeFile(join(tempDir, '.threados/custom-prompts/runtime/custom-prompt-step.md'), 'echo custom prompt path\n')

    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchedPrompts.push(opts.compiledPrompt)
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: executeProcess,
      saveRunArtifacts: async (_basePath, result, options) => {
        savedArtifacts.push({ result, options })
        return '.threados/runs/mock'
      },
    }

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('step', ['custom-prompt-step'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
    expect(dispatchedPrompts).toHaveLength(1)
    expect(dispatchedPrompts[0]).toContain('echo custom prompt path')
    expect(dispatchedPrompts[0]).toContain('## THREADOS ACTION CONTRACT')
    expect(savedArtifacts).toHaveLength(1)
    expect(savedArtifacts[0]?.options).toMatchObject({
      surfaceId: 'thread-custom-prompt-step',
      compiledPrompt: dispatchedPrompts[0],
      inputManifest: {
        stepId: 'custom-prompt-step',
        surfaceId: 'thread-custom-prompt-step',
        promptRef: '.threados/custom-prompts/runtime/custom-prompt-step.md',
      },
    })
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
  test('executes runnable steps in order and expands newly unblocked steps within the same invocation', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'step-1', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/step-1.md', depends_on: [] }),
        makeStep({ id: 'step-2', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/step-2.md', depends_on: ['step-1'] }),
        makeStep({ id: 'step-3', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/step-3.md', depends_on: ['step-2'] }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/step-1.md'), 'echo 1')
    await writeFile(join(tempDir, '.threados/prompts/step-2.md'), 'echo 2')
    await writeFile(join(tempDir, '.threados/prompts/step-3.md'), 'echo 3')

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
    expect(output.executed).toHaveLength(3)
    expect(executedSteps).toEqual(['step-1', 'step-2', 'step-3'])
  })

  test('run runnable aborts the workflow when a composio action fails with abort_workflow', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'step-1',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/step-1.md',
          depends_on: [],
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS' },
            on_failure: 'abort_workflow',
          }],
        } as any),
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
      runComposioTool: async () => {
        throw new Error('apollo offline')
      },
    } as any

    const logs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => logs.push(msg)

    await runCommand('runnable', [], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(false)
    expect(output.executed).toHaveLength(1)
    expect(output.executed[0].stepId).toBe('step-1')
    expect(output.executed[0].error).toContain('apollo offline')
    expect(executedSteps).toEqual([])
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

  test('run runnable prints NEEDS_REVIEW instead of FAILED in human-readable summaries', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({ id: 'review-me', status: 'READY', model: 'shell', prompt_file: '.threados/prompts/review-me.md', depends_on: [] }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/review-me.md'), 'echo ok')

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
        stdout: 'I cannot access the requested admin tool because I do not have permission to use it.',
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

    expect(logs.some(line => line.includes('review-me: NEEDS_REVIEW'))).toBe(true)
    expect(logs.some(line => line.includes('review-me: FAILED'))).toBe(false)
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

  test('run group reports approval-blocked steps as BLOCKED and surfaces downstream waiting steps', async () => {
    const seq = makeSequence({
      steps: [
        makeStep({
          id: 'approval-group-step',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/approval-group-step.md',
          group_id: 'grp-blocked',
          actions: [{
            id: 'review-before-group-send',
            type: 'approval',
            config: {
              approval_prompt: 'Human review required before grouped send',
            },
          }],
        } as any),
        makeStep({
          id: 'after-group-approval',
          status: 'READY',
          model: 'shell',
          prompt_file: '.threados/prompts/after-group-approval.md',
          group_id: 'grp-blocked',
          depends_on: ['approval-group-step'],
        }),
      ],
    })
    await writeTestSequence(tempDir, seq)
    await writeFile(join(tempDir, '.threados/prompts/approval-group-step.md'), 'echo should-not-run')
    await writeFile(join(tempDir, '.threados/prompts/after-group-approval.md'), 'echo later')

    let dispatchCalls = 0
    globalThis.__THREADOS_CLI_RUN_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        dispatchCalls += 1
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
        }
      },
      runStep: async config => ({
        stepId: config.stepId,
        runId: config.runId,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        startTime: new Date(),
        endTime: new Date(),
        duration: 15,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        timedOut: false,
        status: 'SUCCESS',
      }),
      saveRunArtifacts: async () => '.threados/runs/mock',
    } as any

    const jsonLogs: string[] = []
    const origLog = console.log
    console.log = (msg: string) => jsonLogs.push(msg)

    await runCommand('group', ['grp-blocked'], { ...jsonOpts, basePath: tempDir })

    console.log = origLog

    const output = JSON.parse(jsonLogs[0])
    expect(output.success).toBe(false)
    expect(output.executed).toHaveLength(1)
    expect(output.executed[0]).toMatchObject({
      stepId: 'approval-group-step',
      status: 'BLOCKED',
      success: false,
    })
    expect(output.waiting).toEqual(['after-group-approval'])
    expect(dispatchCalls).toBe(0)

    await writeTestSequence(tempDir, seq)

    const humanLogs: string[] = []
    console.log = (msg: string) => humanLogs.push(msg)

    await runCommand('group', ['grp-blocked'], { json: false, help: false, watch: false, basePath: tempDir })

    console.log = origLog

    expect(humanLogs.some(line => line.includes('approval-group-step: BLOCKED'))).toBe(true)
    expect(humanLogs.some(line => line.includes('approval-group-step: FAILED'))).toBe(false)
    expect(humanLogs.some(line => line.includes('Waiting 1 step(s) on blocked dependencies:'))).toBe(true)
    expect(humanLogs.some(line => line.includes('after-group-approval'))).toBe(true)
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
