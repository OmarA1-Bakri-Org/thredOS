import { describe, test, expect } from 'bun:test'
import { dispatch, checkAgentAvailable, exitCodeToStatus, getSupportedModels } from './dispatch'

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
      cwd: '/tmp',
      timeout: 30000,
    })

    expect(config.command).toBe('sh')
    expect(config.stepId).toBe('build')
    expect(config.runId).toBe('run-123')
    expect(config.cwd).toBe('/tmp')
    expect(config.timeout).toBe(30000)
    expect(config.env?.THREADOS_STEP_ID).toBe('build')
    expect(config.env?.THREADOS_RUN_ID).toBe('run-123')
  })

  test('shell dispatch writes prompt to temp file', async () => {
    const config = await dispatch('shell', {
      stepId: 'test',
      runId: 'run-456',
      compiledPrompt: 'echo "test"',
      cwd: '/tmp',
      timeout: 5000,
    })

    // args[0] should be the temp file path
    expect(config.args).toBeDefined()
    expect(config.args![0]).toContain('threados-prompt-test-')
  })

  test('rejects unsupported model', async () => {
    await expect(
      dispatch('unknown-model' as any, {
        stepId: 'x',
        runId: 'r',
        compiledPrompt: 'p',
        cwd: '/tmp',
        timeout: 1000,
      })
    ).rejects.toThrow('Agent')
  })
})
