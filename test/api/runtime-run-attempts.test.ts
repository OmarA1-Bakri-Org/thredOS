import { afterEach, describe, expect, test } from 'bun:test'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'

describe('GET /api/runs/:runId/attempts', () => {
  afterEach(() => {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
  })

  test('returns process-aware attempt projections through the shared runtime service', async () => {
    const calls: string[] = []
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      inspectRun: async (runId: string) => {
        calls.push(`run:${runId}`)
        return {
          source: 'v2',
          schemaVersion: 2,
          run: { id: runId },
          attempts: [{ id: 'attempt-1' }, { id: 'attempt-2' }],
        } as never
      },
      inspectAttempt: async (attemptId: string) => {
        calls.push(`attempt:${attemptId}`)
        return {
          source: 'v2',
          schemaVersion: 2,
          attempt: {
            id: attemptId,
            workflow_run_id: 'run-1',
            status: attemptId === 'attempt-1' ? 'running' : 'interrupted',
          },
          process: attemptId === 'attempt-1'
            ? { id: 'process-1', status: 'running', pid: 4242 }
            : { id: 'process-2', status: 'lost', pid: null },
        } as never
      },
    } as unknown as RuntimeServicePort

    const { GET } = await import('@/app/api/runs/[runId]/attempts/route')
    const response = await GET(
      new Request('http://localhost/api/runs/run-1/attempts'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      runId: 'run-1',
      source: 'v2',
      attempts: [
        {
          attempt: { id: 'attempt-1', status: 'running' },
          process: { id: 'process-1', status: 'running', pid: 4242 },
        },
        {
          attempt: { id: 'attempt-2', status: 'interrupted' },
          process: { id: 'process-2', status: 'lost', pid: null },
        },
      ],
    })
    expect(calls).toEqual(['run:run-1', 'attempt:attempt-1', 'attempt:attempt-2'])
  })
})
