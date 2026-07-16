import { afterEach, describe, expect, test } from 'bun:test'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import { controlCommand } from './control'

const options = { json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli' }

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
})

describe('compatibility controls', () => {
  test('stop resolves latest active attempt through the service', async () => {
    const calls: string[] = []
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      findLatestAttempt: async query => {
        calls.push(`find:${query.stepId}:${query.statuses?.join(',')}`)
        return { id: 'attempt-running', status: 'running' } as never
      },
      cancelAttempt: async attemptId => {
        calls.push(`cancel:${attemptId}`)
        return { id: attemptId, status: 'cancelled' } as never
      },
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await controlCommand('stop', ['step-a'], options)
    } finally {
      console.log = original
    }

    expect(calls).toEqual(['find:step-a:running', 'cancel:attempt-running'])
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('restart retries the latest terminal attempt with lineage', async () => {
    const calls: string[] = []
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      findLatestAttempt: async query => {
        calls.push(`find:${query.stepId}:${query.statuses?.join(',')}`)
        return { id: 'attempt-old', status: 'failed' } as never
      },
      retryAttempt: async attemptId => {
        calls.push(`retry:${attemptId}`)
        return { id: 'attempt-new', retry_of_attempt_id: attemptId, status: 'pending' } as never
      },
      inspectAttempt: async attemptId => ({
        attempt: { id: attemptId, retry_of_attempt_id: 'attempt-old', status: 'pending' },
        process: null,
      }) as never,
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await controlCommand('restart', ['step-a'], options)
    } finally {
      console.log = original
    }

    expect(calls).toEqual([
      'find:step-a:completed,needs_review,failed,cancelled,timed_out,interrupted',
      'retry:attempt-old',
    ])
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(true)
  })

  test('stop cannot claim success when process cancellation fails', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      findLatestAttempt: async () => ({ id: 'attempt-running', status: 'running' }) as never,
      cancelAttempt: async () => {
        const error = new Error('process tree did not terminate')
        Object.assign(error, { code: 'PROCESS_CONTROL_FAILED' })
        throw error
      },
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await controlCommand('stop', ['step-a'], options)
    } finally {
      console.log = original
    }

    expect(lines).toHaveLength(1)
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1,
      success: false,
      error: { code: 'PROCESS_CONTROL_FAILED', message: 'process tree did not terminate' },
    })
    expect(process.exitCode).toBe(7)
  })
})
