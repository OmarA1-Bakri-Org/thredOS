import { afterEach, describe, expect, test } from 'bun:test'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import type { LatestAttemptQuery } from '@/lib/runtime/service-types'

afterEach(() => {
  delete globalThis.__THREADOS_RUNTIME_SERVICE__
})

function terminalAttempt(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    id: 'attempt-failed',
    revision: 0,
    workflow_run_id: 'run-1',
    sequence_id: 'sequence-1',
    step_id: 'step-a',
    surface_id: 'thread-step-a',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status: 'failed',
    agent_ref: null,
    model: 'codex',
    side_effect_class: 'execute',
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: null,
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null,
    output_manifest_ref: null,
    artifact_manifest_ref: null,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: '2026-08-28T00:00:00.000Z',
    started_at: '2026-08-28T00:00:01.000Z',
    ended_at: '2026-08-28T00:00:02.000Z',
    last_heartbeat_at: null,
    exit_code: 1,
    signal: null,
    duration_ms: 1000,
    error_code: 'PROCESS_EXIT_FAILED',
    error_message: 'failed',
    ...overrides,
  }
}

describe('POST /api/stop', () => {
  test('queries only the latest running attempt before cancelling', async () => {
    const queries: LatestAttemptQuery[] = []
    let cancelCalls = 0
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      findLatestAttempt: async (query: LatestAttemptQuery) => {
        queries.push(query)
        return query.statuses?.includes('running')
          ? null
          : terminalAttempt()
      },
      cancelAttempt: async () => {
        cancelCalls += 1
        return terminalAttempt({ status: 'cancelled', ended_at: '2026-08-28T00:00:03.000Z' }) as never
      },
    } as unknown as RuntimeServicePort

    const { POST } = await import('@/app/api/stop/route')
    const response = await POST(new Request('http://localhost/api/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    expect(queries).toEqual([{ sequenceId: '$current', stepId: 'step-a', statuses: ['running'] }])
    expect(cancelCalls).toBe(0)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'ATTEMPT_NOT_RUNNING' })
  })
})
