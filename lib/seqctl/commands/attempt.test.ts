import { afterEach, describe, expect, test } from 'bun:test'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import { attemptCommand } from './attempt'

const options = { json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli' }

function captureLogs() {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  return { lines, restore: () => { console.log = original } }
}

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
})

describe('attempt runtime commands', () => {
  test('inspect emits the versioned success envelope', async () => {
    let inspected = ''
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      inspectAttempt: async attemptId => {
        inspected = attemptId
        return { attempt: { id: attemptId, status: 'completed' }, process: null } as never
      },
    }
    const capture = captureLogs()
    try {
      await attemptCommand('inspect', ['attempt-1'], options)
    } finally {
      capture.restore()
    }

    expect(inspected).toBe('attempt-1')
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))
    expect(envelope).toEqual({
      schemaVersion: 1,
      success: true,
      data: { attempt: { id: 'attempt-1', status: 'completed' }, process: null },
    })
    expect(process.exitCode).toBe(0)
  })

  test('retry forwards trusted CLI context and preserves idempotency', async () => {
    let received: unknown
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      retryAttempt: async (attemptId, context) => {
        received = { attemptId, context }
        return { id: 'attempt-2', retry_of_attempt_id: attemptId, status: 'pending' } as never
      },
      inspectAttempt: async attemptId => ({
        attempt: { id: attemptId, retry_of_attempt_id: 'attempt-1', status: 'pending' },
        process: null,
      }) as never,
    }
    const capture = captureLogs()
    try {
      await attemptCommand('retry', ['attempt-1'], { ...options, idempotencyKey: 'retry-key' })
    } finally {
      capture.restore()
    }

    expect(received).toEqual({
      attemptId: 'attempt-1',
      context: expect.objectContaining({
        interface: 'cli',
        idempotencyKey: 'retry-key',
        policyConfirmed: false,
      }),
    })
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))
    expect(envelope.success).toBe(true)
  })

  test('service failures emit a versioned error and nonzero exit', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      cancelAttempt: async () => {
        const error = new Error('controller refused cancellation')
        Object.assign(error, { code: 'PROCESS_CONTROL_FAILED' })
        throw error
      },
    }
    const capture = captureLogs()
    try {
      await attemptCommand('cancel', ['attempt-1'], options)
    } finally {
      capture.restore()
    }

    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))
    expect(envelope).toEqual({
      schemaVersion: 1,
      success: false,
      error: { code: 'PROCESS_CONTROL_FAILED', message: 'controller refused cancellation' },
    })
    expect(process.exitCode).not.toBe(0)
  })

  test('cancel emits the same refreshed attempt projection as the API', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      cancelAttempt: async attemptId => ({ id: attemptId, status: 'cancelled' }) as never,
      inspectAttempt: async attemptId => ({
        attempt: { id: attemptId, status: 'cancelled' },
        process: { id: 'process-1', status: 'exited' },
      }) as never,
    }
    const capture = captureLogs()
    try {
      await attemptCommand('cancel', ['attempt-1'], options)
    } finally {
      capture.restore()
    }
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))).toEqual({
      schemaVersion: 1,
      success: true,
      data: {
        attempt: { id: 'attempt-1', status: 'cancelled' },
        process: { id: 'process-1', status: 'exited' },
      },
    })
  })
})
