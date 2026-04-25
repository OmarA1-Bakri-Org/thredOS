import { describe, test, expect } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { assessCompletionResult, dispatch, checkAgentAvailable, exitCodeToStatus, getSupportedModels } from './dispatch'
import type { ModelType } from '../sequence/schema'

const unsupportedModel = 'unknown-model' as ModelType

describe('exitCodeToStatus', () => {
  test('maps 0 to DONE', () => {
    expect(exitCodeToStatus(0)).toBe('DONE')
  })

  test('maps 42 to NEEDS_REVIEW', () => {
    expect(exitCodeToStatus(42)).toBe('NEEDS_REVIEW')
  })

  test('maps 1 to FAILED', () => {
    expect(exitCodeToStatus(1)).toBe('FAILED')
  })

  test('maps null to FAILED', () => {
    expect(exitCodeToStatus(null)).toBe('FAILED')
  })

  test('maps 130 (SIGINT) to FAILED', () => {
    expect(exitCodeToStatus(130)).toBe('FAILED')
  })

  test('maps 137 (SIGKILL) to FAILED', () => {
    expect(exitCodeToStatus(137)).toBe('FAILED')
  })
})

describe('assessCompletionResult', () => {
  test('keeps successful zero-exit runs as DONE when output looks complete', () => {
    expect(assessCompletionResult({ exitCode: 0, stdout: 'Work complete. FILES_CREATED: dist/out.json', stderr: '' }).status).toBe('DONE')
  })

  test('does not downgrade incidental troubleshooting text that is not a first-person blocker', () => {
    expect(
      assessCompletionResult({
        exitCode: 0,
        stdout: 'Updated docs with troubleshooting text about permission denied and access denied errors.',
        stderr: '',
      }).status,
    ).toBe('DONE')
  })

  test('downgrades zero-exit refusals to NEEDS_REVIEW', () => {
    const result = assessCompletionResult({
      exitCode: 0,
      stdout: 'I cannot access the requested system because I do not have permission to use that tool.',
      stderr: '',
    })

    expect(result.status).toBe('NEEDS_REVIEW')
    expect(result.reasons).toContain('OBVIOUS_NON_COMPLETION_PAYLOAD')
  })

  test('downgrades zero-exit line-start permission denied payloads to NEEDS_REVIEW', () => {
    const result = assessCompletionResult({
      exitCode: 0,
      stdout: 'Permission denied: cannot access the requested admin tool from this environment.',
      stderr: '',
    })

    expect(result.status).toBe('NEEDS_REVIEW')
    expect(result.reasons).toContain('OBVIOUS_NON_COMPLETION_PAYLOAD')
  })

  test('downgrades zero-exit unable-to-complete payloads to NEEDS_REVIEW', () => {
    const result = assessCompletionResult({
      exitCode: 0,
      stdout: "I'm unable to complete this because the billing console is unavailable in this environment.",
      stderr: '',
    })

    expect(result.status).toBe('NEEDS_REVIEW')
    expect(result.reasons).toContain('OBVIOUS_NON_COMPLETION_PAYLOAD')
  })
})

describe('getSupportedModels', () => {
  test('returns all supported models', () => {
    const models = getSupportedModels()
    expect(models).toContain('claude-code')
    expect(models).toContain('codex')
    expect(models).toContain('gemini')
    expect(models).toContain('shell')
  })
})

describe('checkAgentAvailable', () => {
  test('shell is always available', async () => {
    const available = await checkAgentAvailable('shell')
    expect(available).toBe(true)
  })

  test('finds agent binaries even when Bun.spawn is unavailable', async () => {
    const fakeBinDir = await mkdtemp(join(tmpdir(), 'threados-agent-bin-'))
    const fakeClaude = join(fakeBinDir, 'claude')
    await writeFile(fakeClaude, '#!/bin/sh\nexit 0\n', 'utf-8')
    await chmod(fakeClaude, 0o755)

    const originalPath = process.env.PATH
    const originalBunSpawn = Bun.spawn
    process.env.PATH = `${fakeBinDir}:/usr/bin:/bin`
    Bun.spawn = (() => {
      throw new Error('Bun.spawn unavailable in Node runtime')
    }) as typeof Bun.spawn

    try {
      const available = await checkAgentAvailable('claude-code')
      expect(available).toBe(true)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      Bun.spawn = originalBunSpawn
      await rm(fakeBinDir, { recursive: true, force: true })
    }
  })
})

describe('dispatch', () => {
  test('shell dispatch builds sh config', async () => {
    const config = await dispatch('shell', {
      stepId: 'build',
      runId: 'run-123',
      compiledPrompt: '#!/bin/sh\necho "hello"',
      cwd: process.cwd(),
      timeout: 30000,
    })

    expect(config.command).toBe('sh')
    expect(config.stepId).toBe('build')
    expect(config.runId).toBe('run-123')
    expect(config.cwd).toBe(process.cwd())
    expect(config.timeout).toBe(30000)
    expect(config.env?.THREADOS_STEP_ID).toBe('build')
    expect(config.env?.THREADOS_RUN_ID).toBe('run-123')
  })

  test('shell dispatch writes prompt to workspace-local temp file', async () => {
    const cwd = process.cwd()
    const config = await dispatch('shell', {
      stepId: 'test',
      runId: 'run-456',
      compiledPrompt: 'echo "test"',
      cwd,
      timeout: 5000,
    })

    expect(config.args).toBeDefined()
    expect(config.args![0]).toContain('.threados/tmp-prompts/threados-prompt-test-')
    expect(config.args![0].startsWith(cwd)).toBe(true)
    await expect(readFile(config.args![0], 'utf-8')).resolves.toContain('echo "test"')
  })

  test('dispatch sanitizes nested step ids when writing prompt files', async () => {
    const cwd = process.cwd()
    const config = await dispatch('shell', {
      stepId: 'merge-dedup-comply::spawn_merge_agent',
      runId: 'run-789',
      compiledPrompt: 'echo nested',
      cwd,
      timeout: 5000,
    })

    expect(config.args).toBeDefined()
    expect(config.args![0]).toContain('threados-prompt-merge-dedup-comply-spawn_merge_agent-')
    expect(config.args![0]).not.toContain('::')
  })

  test('fails fast when the workspace-local temp prompt root is not writable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'threados-dispatch-preflight-'))
    const promptRoot = join(cwd, '.threados', 'tmp-prompts')
    await mkdir(promptRoot, { recursive: true })
    await chmod(promptRoot, 0o555)

    try {
      await expect(dispatch('shell', {
        stepId: 'blocked-write',
        runId: 'run-preflight',
        compiledPrompt: 'echo blocked',
        cwd,
        timeout: 5000,
      })).rejects.toThrow(`Runtime preflight failed: prompt temp root is not writable: ${promptRoot}`)
    } finally {
      await chmod(promptRoot, 0o755)
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('dispatch exposes THREADOS_EVENT_LOG to the child process', async () => {
    const config = await dispatch('shell', {
      stepId: 'runtime-events',
      runId: 'run-789',
      compiledPrompt: 'echo "runtime"',
      cwd: '/tmp',
      timeout: 5000,
      runtimeEventLogPath: '/tmp/threados/events.jsonl',
    })

    expect(config.env?.THREADOS_EVENT_LOG).toBe('/tmp/threados/events.jsonl')
  })

  test('dispatch exposes THREADOS_EVENT_EMITTER to the child process when provided', async () => {
    const config = await dispatch('shell', {
      stepId: 'runtime-events',
      runId: 'run-790',
      compiledPrompt: 'echo "runtime"',
      cwd: '/tmp',
      timeout: 5000,
      runtimeEventLogPath: '/tmp/threados/events.jsonl',
      runtimeEventEmitterCommand: 'thread event',
    })

    expect(config.env?.THREADOS_EVENT_EMITTER).toBe('thread event')
  })

  test('codex dispatch uses non-interactive exec syntax supported by the installed CLI', async () => {
    const config = await dispatch('codex', {
      stepId: 'codex-step',
      runId: 'run-codex',
      compiledPrompt: 'Do the work',
      cwd: process.cwd(),
      timeout: 5000,
    })

    expect(config.command).toBe('codex')
    expect(config.args).toEqual([
      'exec',
      '--full-auto',
      '--skip-git-repo-check',
      expect.stringContaining('Execute the task described in'),
    ])
  })

  test('rejects unsupported model', async () => {
    await expect(
      dispatch(unsupportedModel, {
        stepId: 'x',
        runId: 'r',
        compiledPrompt: 'p',
        cwd: process.cwd(),
        timeout: 1000,
      })
    ).rejects.toThrow('Agent')
  })
})
