import { describe, test, expect } from 'bun:test'
import { ProcessTimeoutError } from '../errors'

async function importActualWrapper() {
  return import(new URL(`./wrapper.ts?cacheBust=${Date.now()}-${Math.random()}`, import.meta.url).href) as Promise<typeof import('./wrapper')>
}

describe('runStep', () => {
  test('successful command', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'test-step',
      runId: 'run-1',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("hello\\n")'],
    })
    expect(result.status).toBe('SUCCESS')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.stepId).toBe('test-step')
    expect(result.runId).toBe('run-1')
    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.startTime).toBeInstanceOf(Date)
    expect(result.endTime).toBeInstanceOf(Date)
  })

  test('failed command', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'fail-step',
      runId: 'run-2',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    })
    expect(result.status).toBe('FAILED')
    expect(result.exitCode).toBe(1)
  })

  test('command with stderr', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'stderr-step',
      runId: 'run-3',
      command: process.execPath,
      args: ['-e', 'process.stderr.write("error\\n")'],
    })
    expect(result.stderr.trim()).toBe('error')
  })

  test('timeout kills process', async () => {
    const { runStep } = await importActualWrapper()
    await expect(
      runStep({
        stepId: 'timeout-step',
        runId: 'run-4',
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        timeout: 100,
      })
    ).rejects.toThrow(ProcessTimeoutError)
  })

  test('nonexistent command returns ERROR', async () => {
    const { runStep } = await importActualWrapper()
    // shell: false means spawn emits an error event for not-found commands
    const result = await runStep({
      stepId: 'bad-cmd',
      runId: 'run-5',
      command: 'nonexistent_command_xyz',
    })
    expect(result.status).toBe('ERROR')
    expect(result.exitCode).toBe(null)
  })

  test('custom env vars', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'env-step',
      runId: 'run-6',
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.MY_VAR ?? "")'],
      env: { MY_VAR: 'test-value' },
    })
    expect(result.stdout.trim()).toBe('test-value')
  })

  test('inherited env vars filtered through allowlist', async () => {
  test('inherited env vars filtered through allowlist', async () => {
    const originalSensitive = process.env.AWS_SECRET_ACCESS_KEY
    process.env.AWS_SECRET_ACCESS_KEY = 'super-secret'

    try {
      const result = await runStep({
        stepId: 'env-filter-step',
        runId: 'run-7',
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.AWS_SECRET_ACCESS_KEY ?? "FILTERED")'],
      })
      expect(result.stdout.trim()).toBe('FILTERED')
    } finally {
      if (originalSensitive !== undefined) {
        process.env.AWS_SECRET_ACCESS_KEY = originalSensitive
      } else {
        delete process.env.AWS_SECRET_ACCESS_KEY
      }
    }
  })
})
