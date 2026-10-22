import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from '@/lib/runtime/factory'
import type { RuntimeServiceDependencies } from '@/lib/runtime/service-types'
import { CommandRepository } from '@/lib/runtime/command-repository'
import { stableRuntimeHash } from '@/lib/runtime/attempt-executor'
import { RuntimeServiceError } from '@/lib/runtime/errors'
import YAML from 'yaml'
import { registerSequenceAgents } from '../helpers/registered-sequence'

const NOW = '2026-07-16T00:00:00.000Z'

function run(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2, id: 'run-1', revision: 0, sequence_id: 'sequence-1',
    sequence_snapshot_hash: 'sha256:sequence', target: { kind: 'step', step_id: 'step-1' },
    strategy: 'sequential', status: 'pending', max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy', baseline_snapshot_id: null, attempt_ids: [],
    created_by: 'local@thredos', created_via: 'api', created_at: NOW, started_at: null,
    ended_at: null, cancellation_requested_at: null, summary: null,
    error_code: null, error_message: null, ...overrides,
  }
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2, id: 'attempt-1', revision: 0, workflow_run_id: 'run-1',
    sequence_id: 'sequence-1', step_id: 'step-1', surface_id: 'thread-step-1',
    execution_index: 1, attempt_number: 1, retry_of_attempt_id: null, status: 'running',
    agent_ref: null, model: 'codex', side_effect_class: 'execute', baseline_snapshot_id: null,
    workspace_id: null, process_id: 'process-1', compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null, output_manifest_ref: null, artifact_manifest_ref: null,
    change_set_id: null, gate_decision_refs: [], created_at: NOW, started_at: NOW,
    ended_at: null, last_heartbeat_at: null, exit_code: null, signal: null, duration_ms: null,
    error_code: null, error_message: null, ...overrides,
  }
}

describe.serial('runtime V2 API routes', () => {
  let basePath: string
  let calls: Array<{ method: string; args: unknown[] }>

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-v2-routes-'))
    process.env.THREADOS_BASE_PATH = basePath
    calls = []
    const service = {
      startRun: async (...args: unknown[]) => { calls.push({ method: 'startRun', args }); return run() },
      runAndWait: async (...args: unknown[]) => {
        calls.push({ method: 'runAndWait', args })
        return { run: run({ status: 'successful', attempt_ids: ['attempt-1'], ended_at: NOW }), attempts: [attempt({ status: 'completed', ended_at: NOW, exit_code: 0 })], replayed: false }
      },
      listRuns: async (...args: unknown[]) => { calls.push({ method: 'listRuns', args }); return [{ run: run(), attempts: [] }] },
      inspectRun: async (...args: unknown[]) => { calls.push({ method: 'inspectRun', args }); return { run: run(), attempts: [attempt()] } },
      inspectAttempt: async (...args: unknown[]) => {
        calls.push({ method: 'inspectAttempt', args })
        return { attempt: args[0] === 'attempt-2' ? attempt({ id: 'attempt-2', status: 'pending', process_id: null, retry_of_attempt_id: 'attempt-1', attempt_number: 2, started_at: null }) : attempt(), process: null }
      },
      cancelRun: async (...args: unknown[]) => { calls.push({ method: 'cancelRun', args }); return run({ status: 'cancelled', ended_at: NOW }) },
      cancelAttempt: async (...args: unknown[]) => { calls.push({ method: 'cancelAttempt', args }); return attempt({ status: 'cancelled', ended_at: NOW }) },
      retryAttempt: async (...args: unknown[]) => { calls.push({ method: 'retryAttempt', args }); return attempt({ id: 'attempt-2', status: 'pending', process_id: null, retry_of_attempt_id: 'attempt-1', attempt_number: 2, started_at: null }) },
      findLatestAttempt: async (...args: unknown[]) => { calls.push({ method: 'findLatestAttempt', args }); return attempt({ status: 'failed', ended_at: NOW }) },
      getStatus: async (...args: unknown[]) => { calls.push({ method: 'getStatus', args }); return { name: 'sequence-1', version: '1.0', steps: [], gates: [], summary: { total: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 } } },
      reconcile: async (...args: unknown[]) => { calls.push({ method: 'reconcile', args }); return { checked: 0, changes: [], errors: [] } },
    }
    globalThis.__THREADOS_RUNTIME_SERVICE__ = service as unknown as RuntimeServicePort
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
    clearRuntimeServiceFactoryForTests()
  })

  test('POST /api/runs preserves or generates an idempotency key and trusts only server actor/interface', async () => {
    const { POST } = await import('@/app/api/runs/route')
    const body = { sequence_id: 'sequence-1', target: { kind: 'step', step_id: 'step-1' }, strategy: 'sequential', max_concurrency: 1, actor: 'spoofed', interface: 'cli' }
    const response = await POST(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': ' key-1 ' }, body: JSON.stringify(body),
    }))
    expect(response.status).toBe(202)
    expect(response.headers.get('idempotency-key')).toBe('key-1')
    expect(response.headers.get('location')).toBe('/api/runs/run-1')
    const context = calls[0]?.args[1] as Record<string, unknown>
    expect(context).toMatchObject({ actor: 'local@thredos', interface: 'api', idempotencyKey: 'key-1' })

    calls.length = 0
    const generated = await POST(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    expect(generated.status).toBe(202)
    expect(generated.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('present but blank Idempotency-Key is rejected without invoking the service', async () => {
    const { POST } = await import('@/app/api/runs/route')
    const response = await POST(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': '   ' },
      body: JSON.stringify({ sequence_id: 'sequence-1', target: { kind: 'runnable' }, strategy: 'sequential', max_concurrency: 1 }),
    }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(calls).toHaveLength(0)
  })

  test('resource reads and control routes delegate once and return canonical projections', async () => {
    const { GET: list } = await import('@/app/api/runs/route')
    const listResponse = await list(new Request('http://localhost/api/runs?sequence_id=sequence-1&status=pending'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual({ runs: [{ run: run(), attempts: [] }] })

    const { GET: inspectRun } = await import('@/app/api/runs/[runId]/route')
    expect((await inspectRun(new Request('http://localhost'), { params: Promise.resolve({ runId: 'run-1' }) })).status).toBe(200)
    const { POST: cancelRun } = await import('@/app/api/runs/[runId]/cancel/route')
    expect((await cancelRun(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ runId: 'run-1' }) })).status).toBe(200)

    const { GET: inspectAttempt } = await import('@/app/api/attempts/[attemptId]/route')
    expect((await inspectAttempt(new Request('http://localhost'), { params: Promise.resolve({ attemptId: 'attempt-1' }) })).status).toBe(200)
    const { POST: cancelAttempt } = await import('@/app/api/attempts/[attemptId]/cancel/route')
    expect((await cancelAttempt(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ attemptId: 'attempt-1' }) })).status).toBe(200)
    const { POST: retryAttempt } = await import('@/app/api/attempts/[attemptId]/retry/route')
    const retried = await retryAttempt(new Request('http://localhost', { method: 'POST', headers: { 'idempotency-key': 'retry-1' } }), { params: Promise.resolve({ attemptId: 'attempt-1' }) })
    expect(retried.status).toBe(202)
    await expect(retried.json()).resolves.toMatchObject({ attempt: { id: 'attempt-2', retry_of_attempt_id: 'attempt-1' } })
  })

  test('legacy /api/run delegates exactly once to runAndWait and preserves its envelope', async () => {
    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'legacy-1' },
      body: JSON.stringify({ stepId: 'step-1', confirmPolicy: true }),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, stepId: 'step-1', runId: 'run-1', status: 'DONE' })
    expect(calls.filter(call => call.method === 'runAndWait')).toHaveLength(1)
    expect(calls.filter(call => call.method === 'startRun')).toHaveLength(0)
  })

  test('compatibility stop/restart/status use only runtime service projections', async () => {
    const { POST: stop } = await import('@/app/api/stop/route')
    expect((await stop(new Request('http://localhost/api/stop', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'stop-1' }, body: JSON.stringify({ stepId: 'step-1' }) }))).status).toBe(200)
    const { POST: restart } = await import('@/app/api/restart/route')
    expect((await restart(new Request('http://localhost/api/restart', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'restart-1' }, body: JSON.stringify({ stepId: 'step-1' }) }))).status).toBe(200)
    const { GET: status } = await import('@/app/api/status/route')
    expect((await status(new Request('http://localhost/api/status'))).status).toBe(200)
    expect(calls.some(call => call.method === 'getStatus')).toBe(true)
  })

  test('execution routes contain no route-owned lifecycle or direct runner/mprocs imports', async () => {
    for (const path of ['app/api/run/route.ts', 'app/api/stop/route.ts', 'app/api/restart/route.ts', 'app/api/status/route.ts']) {
      const source = await readFile(join(process.cwd(), path), 'utf8')
      expect(source).not.toMatch(/@\/lib\/(runner|mprocs|gates|approvals|thread-surfaces|sequence\/parser|reconciliation)/)
      expect(source).not.toMatch(/\b(executeStep|transitionAttempt|writeSequence|writeThreadSurfaceState)\b/)
    }
  })

  test('runtime error registry maps workspace cleanup conflicts and lost processes consistently', async () => {
    const { handleRuntimeError } = await import('@/lib/api/runtime-request')
    const workspace = handleRuntimeError(new RuntimeServiceError('WORKSPACE_NOT_CLEANABLE', 'retained'))
    expect(workspace.status).toBe(409)
    await expect(workspace.json()).resolves.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
    const process = handleRuntimeError(new RuntimeServiceError('PROCESS_LOST', 'missing evidence'))
    expect(process.status).toBe(502)
    await expect(process.json()).resolves.toMatchObject({ code: 'PROCESS_LOST' })
  })

  test('real service route replay is spawn-once, conflicts on changed payload, and retry creates lineage', async () => {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
      version: '1.0', id: 'sequence-1', name: 'sequence-1', steps: await registerSequenceAgents(basePath, [{
        id: 'step-1', name: 'Step 1', type: 'base', model: 'codex',
        prompt_file: '.threados/prompts/step-1.md', depends_on: [], status: 'READY',
      }]), gates: [],
    }))
    await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
      mode: 'POWER', side_effect_mode: 'free',
    }))
    await writeFile(join(basePath, '.threados', 'prompts', 'step-1.md'), '# step 1')
    let spawns = 0
    const waitForSpawns = async (target: number): Promise<void> => {
      const deadline = Date.now() + 30_000
      while (spawns < target && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    const runStep: NonNullable<RuntimeServiceDependencies['runStep']> = async config => {
      spawns++
      return {
        stepId: config.stepId, runId: config.runId, exitCode: 0, status: 'SUCCESS' as const,
        duration: 1, stdout: 'ok', stderr: '', startTime: new Date(NOW), endTime: new Date(NOW),
      }
    }
    const service = await getThreadOSRuntimeService(basePath, { dependencies: {
      dispatch: async (_model, options) => ({
        stepId: options.stepId, runId: options.runId, command: 'mock-agent', args: [],
        cwd: options.cwd, timeout: options.timeout,
        executablePayload: { command: 'mock-agent', args: [], cwd: options.cwd },
      }),
    }, testCompatibility: { runStep } })
    globalThis.__THREADOS_RUNTIME_SERVICE__ = service
    const { POST: start } = await import('@/app/api/runs/route')
    const startBody = JSON.stringify({
      sequence_id: 'sequence-1', target: { kind: 'step', step_id: 'step-1' },
      strategy: 'sequential', max_concurrency: 1, policy_confirmed: true,
    })
    const first = await start(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'start-real-1' }, body: startBody,
    }))
    const firstRun = (await first.json()).run as { id: string }
    const replay = await start(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'start-real-1' }, body: startBody,
    }))
    expect((await replay.json()).run.id).toBe(firstRun.id)
    const conflict = await start(new Request('http://localhost/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'start-real-1' },
      body: JSON.stringify({ ...JSON.parse(startBody), target: { kind: 'runnable' } }),
    }))
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('idempotency-key')).toBe('start-real-1')
    await expect(conflict.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    let projection = await service.inspectRun(firstRun.id)
    const projectionDeadline = Date.now() + 30_000
    while (!['successful', 'failed'].includes(projection.run.status) && Date.now() < projectionDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
      projection = await service.inspectRun(firstRun.id)
    }
    expect(projection.run.status, JSON.stringify(projection)).toBe('successful')
    expect(spawns).toBe(1)
    const original = projection.attempts[0]!

    const { POST: stop } = await import('@/app/api/stop/route')
    const stopped = await stop(new Request('http://localhost/api/stop', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'stop-real-1' },
      body: JSON.stringify({ stepId: 'step-1' }),
    }))
    expect(stopped.status).toBe(409)
    expect(stopped.headers.get('idempotency-key')).toBe('stop-real-1')
    await expect(stopped.json()).resolves.toMatchObject({ code: 'ATTEMPT_NOT_RUNNING' })

    const { POST: retry } = await import('@/app/api/attempts/[attemptId]/retry/route')
    const retryRequest = () => new Request('http://localhost', {
      method: 'POST', headers: { 'idempotency-key': 'retry-real-1' },
    })
    const [retryResponse, retryReplay] = await Promise.all([
      retry(retryRequest(), { params: Promise.resolve({ attemptId: original.id }) }),
      retry(retryRequest(), { params: Promise.resolve({ attemptId: original.id }) }),
    ])
    const retryBody = await retryResponse.json() as Record<string, unknown>
    const retryReplayBody = await retryReplay.json() as Record<string, unknown>
    expect(retryResponse.status, JSON.stringify(retryBody)).toBe(202)
    expect(retryReplay.status, JSON.stringify(retryReplayBody)).toBe(202)
    const retried = retryBody.attempt as { id: string; retry_of_attempt_id: string; attempt_number: number }
    const replayedRetry = retryReplayBody.attempt as { id: string }
    expect(replayedRetry.id).toBe(retried.id)
    expect(retried.id).not.toBe(original.id)
    expect(retried.retry_of_attempt_id).toBe(original.id)
    expect(retried.attempt_number).toBe(2)
    const directProjection = await service.inspectAttempt(retried.id)
    expect(directProjection.attempt).toMatchObject({
      id: retried.id, retry_of_attempt_id: original.id, attempt_number: 2,
    })
    await waitForSpawns(2)
    expect(spawns).toBe(2)

    const commands = new CommandRepository(basePath)
    const outerId = 'command-crash-retry'
    const childRunId = 'run-crash-retry'
    const crashContext = {
      actor: 'local@thredos', interface: 'api' as const,
      idempotencyKey: 'retry-crash-1', policyConfirmed: false,
    }
    await commands.createOrReplay({
      schema_version: 1, id: outerId, idempotency_key: crashContext.idempotencyKey,
      command_type: 'retry-attempt',
      request_hash: stableRuntimeHash({
        commandType: 'retry-attempt', targetId: original.id,
        actor: crashContext.actor, interface: crashContext.interface, policyConfirmed: false,
      }),
      status: 'accepted', result_ref: `retry:${encodeURIComponent(original.id)}:run:${encodeURIComponent(childRunId)}`,
      error_code: null, error_message: null, created_at: NOW, completed_at: null,
    })
    const childRequest = {
      sequence_id: original.sequence_id,
      target: { kind: 'step' as const, step_id: original.step_id },
      strategy: 'sequential' as const,
      max_concurrency: 1,
      allow_empty: undefined,
    }
    await commands.createOrReplay({
      schema_version: 1, id: 'command-crash-child', idempotency_key: `retry-start:${outerId}`,
      command_type: 'start-run',
      request_hash: stableRuntimeHash({
        request: childRequest, actor: crashContext.actor,
        interface: crashContext.interface, policyConfirmed: false,
      }),
      status: 'accepted', result_ref: childRunId, error_code: null, error_message: null,
      created_at: NOW, completed_at: null,
    })

    const repaired = await Promise.race([
      service.retryAttempt(original.id, crashContext),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('retry repair timed out')), 15_000)),
    ])
    expect(repaired.workflow_run_id).toBe(childRunId)
    expect(repaired.retry_of_attempt_id).toBe(original.id)
    await waitForSpawns(3)
    expect(spawns).toBe(3)
  }, 180_000)
})
