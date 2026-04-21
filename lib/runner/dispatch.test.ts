import { describe, test, expect } from 'bun:test'
import { readFile } from 'fs/promises'
import { dispatch, checkAgentAvailable, exitCodeToStatus, getSupportedModels } from './dispatch'
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
