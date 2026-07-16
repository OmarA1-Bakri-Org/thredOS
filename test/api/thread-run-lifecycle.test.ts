import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { RuntimeServiceError } from '@/lib/runtime/errors'

const THREAD_SURFACE_STATE_PATH = ['.threados', 'state', 'thread-surfaces.json']

let basePath = ''

async function setupTestSequence() {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(
    join(basePath, '.threados', 'sequence.yaml'),
    YAML.stringify({
      version: '1.0',
      name: 'Lifecycle Sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/step-a.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    }),
  )
  await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# Step A')
}

function confirmedBody(payload: Record<string, unknown>) {
  return JSON.stringify({ ...payload, confirmPolicy: true })
}

async function readThreadSurfaceState() {
  const content = await readFile(join(basePath, ...THREAD_SURFACE_STATE_PATH), 'utf-8')
  return JSON.parse(content) as {
    threadSurfaces: Array<{ id: string; childSurfaceIds?: string[]; parentSurfaceId?: string | null; parentAgentNodeId?: string | null }>
    runs: Array<{ id: string; threadSurfaceId: string; runStatus: string; endedAt: string | null }>
    mergeEvents: Array<{ id: string }>
    runEvents: Array<{ id: string }>
  }
}

function controlAttempt(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2, id: 'attempt-old', revision: 0, workflow_run_id: 'run-old',
    sequence_id: 'Lifecycle Sequence', step_id: 'step-a', surface_id: 'thread-step-a',
    execution_index: 1, attempt_number: 1, retry_of_attempt_id: null, status: 'failed',
    agent_ref: null, model: 'codex', side_effect_class: 'none', baseline_snapshot_id: null,
    workspace_id: null, process_id: null, compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null, output_manifest_ref: null, artifact_manifest_ref: null,
    change_set_id: null, gate_decision_refs: [], created_at: '2026-03-09T10:00:00.000Z',
    started_at: '2026-03-09T10:00:00.000Z', ended_at: '2026-03-09T10:00:12.000Z',
    last_heartbeat_at: null, exit_code: 1, signal: null, duration_ms: 12,
    error_code: 'PROCESS_EXIT_FAILED', error_message: 'failed', ...overrides,
  }
}

function installControlService(overrides: Record<string, unknown>): void {
  globalThis.__THREADOS_RUNTIME_SERVICE__ = {
    findLatestAttempt: async () => controlAttempt(),
    cancelAttempt: async () => controlAttempt({ status: 'cancelled' }),
    retryAttempt: async () => controlAttempt({
      id: 'attempt-retry', workflow_run_id: 'run-retry', status: 'pending',
      attempt_number: 2, retry_of_attempt_id: 'attempt-old', started_at: null, ended_at: null,
    }),
    ...overrides,
  } as unknown as RuntimeServicePort
}

describe.serial('thread run lifecycle routes', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-thread-run-lifecycle-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupTestSequence()
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      dispatch: async (_model: string, opts: { stepId: string; runId: string; cwd: string; timeout: number; runtimeEventLogPath?: string; runtimeEventEmitterCommand?: string }) => ({
        stepId: opts.stepId,
        runId: opts.runId,
        command: 'mock-agent',
        args: [],
        cwd: opts.cwd,
        timeout: opts.timeout,
        env: {
          THREADOS_EVENT_LOG: opts.runtimeEventLogPath ?? '',
          THREADOS_EVENT_EMITTER: opts.runtimeEventEmitterCommand ?? '',
        },
      }),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 0,
        status: 'SUCCESS',
        duration: 12,
        stdout: 'ok',
        stderr: '',
        startTime: new Date('2026-03-09T10:00:00.000Z'),
        endTime: new Date('2026-03-09T10:00:12.000Z'),
      }),
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
    }
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('first run initializes root thread surface state when absent', async () => {
    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'step-a' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
        childSurfaceIds: [],
      }),
    ])
    expect(state.runs).toHaveLength(1)
    expect(state.runs).toEqual([
      expect.objectContaining({
        threadSurfaceId: 'thread-root',
        runStatus: 'successful',
      }),
    ])
    expect(state.runEvents).toEqual([])
  })

  test('a new run request creates a new RunScope instead of mutating the old run', async () => {
    const { POST } = await import('@/app/api/run/route')

    await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'step-a' }),
    }))
    await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'step-a' }),
    }))

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toHaveLength(1)
    expect(state.runs).toHaveLength(2)

    const rootRuns = state.runs.filter(run => run.threadSurfaceId === 'thread-root')

    expect(rootRuns).toHaveLength(2)
    expect(rootRuns[0]?.id).not.toBe(rootRuns[1]?.id)
    expect(rootRuns.every(run => run.runStatus === 'successful')).toBe(true)
    expect(state.runEvents).toEqual([])
  }, 15_000)

  test('stop delegates the latest canonical attempt to the runtime service', async () => {
    const calls: string[] = []
    installControlService({
      findLatestAttempt: async () => controlAttempt({ status: 'running', ended_at: null }),
      cancelAttempt: async (attemptId: string) => {
        calls.push(attemptId)
        return controlAttempt({ status: 'cancelled' })
      },
    })
    const { POST } = await import('@/app/api/stop/route')
    const response = await POST(new Request('http://localhost/api/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    expect(response.status).toBe(200)
    expect(calls).toEqual(['attempt-old'])
  })

  test('stop preserves typed process-control failures', async () => {
    installControlService({
      findLatestAttempt: async () => controlAttempt({ status: 'running', ended_at: null }),
      cancelAttempt: async () => { throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'connection refused') },
    })
    const { POST } = await import('@/app/api/stop/route')
    const response = await POST(new Request('http://localhost/api/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })
  })

  test('restart returns the new canonical attempt lineage', async () => {
    installControlService({})
    const { POST } = await import('@/app/api/restart/route')
    const response = await POST(new Request('http://localhost/api/restart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      attemptId: 'attempt-retry', retryOfAttemptId: 'attempt-old',
    })
  })

  test('restart preserves typed retry failures', async () => {
    installControlService({
      retryAttempt: async () => { throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'connection refused') },
    })
    const { POST } = await import('@/app/api/restart/route')
    const response = await POST(new Request('http://localhost/api/restart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })
  })
})
