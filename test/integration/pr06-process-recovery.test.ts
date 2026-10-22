import { buildAgentComposition } from '@/lib/agents/composition'
import { writeAgentState } from '@/lib/agents/repository'
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import { controlCommand } from '@/lib/seqctl/commands/control'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import {
  clearRuntimeServiceFactoryForTests,
  getThreadOSRuntimeService,
} from '@/lib/runtime/factory'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { RunRepository } from '@/lib/runtime/run-repository'
import type { ThreadOSRuntimeService } from '@/lib/runtime/service'
import {
  setProcessTerminationHookForTests,
  startProcess,
} from '@/lib/runner/wrapper'
import type { RunningProcessHandle } from '@/lib/runner/process-handle'

const fixturePath = fileURLToPath(
  new URL('../fixtures/process/long-running.mjs', import.meta.url),
)
const cliOptions = {
  json: true,
  help: false,
  watch: false,
  policyConfirmed: true,
}

setDefaultTimeout(120_000)

async function waitForRunningAttempt(
  service: ThreadOSRuntimeService,
  runId: string,
) {
  for (let poll = 0; poll < 750; poll += 1) {
    const projection = await service.inspectRun(runId)
    const attempt = projection.attempts.find(candidate => candidate.status === 'running')
    if (attempt) {
      const inspected = await service.inspectAttempt(attempt.id)
      if (inspected.process?.status === 'running') return inspected
    }
    await Bun.sleep(20)
  }
  throw new Error(`run ${runId} did not reach a controllable real process`)
}

async function waitForRetryAttempt(
  service: ThreadOSRuntimeService,
  originalAttemptId: string,
) {
  for (let poll = 0; poll < 750; poll += 1) {
    const retry = (await service.listRuns({ sequenceId: 'sequence-1' }))
      .flatMap(projection => projection.attempts)
      .find(attempt => attempt.retry_of_attempt_id === originalAttemptId)
    if (retry) return retry
    await Bun.sleep(20)
  }
  throw new Error(`retry lineage for ${originalAttemptId} was not persisted`)
}

async function terminateFixtureDirectly(
  pid: number,
  signal: 'SIGTERM' | 'SIGKILL',
) {
  try {
    process.kill(pid, signal)
    return { success: true, signaled: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return { success: true, signaled: false }
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

describe.serial('PR-06 real process exit gate', () => {
  let basePath: string | null = null
  let orphanHandle: RunningProcessHandle | null = null
  const runtimeHandles = new Set<RunningProcessHandle>()

  afterEach(async () => {
    for (const handle of runtimeHandles) {
      await handle.cancel('SIGKILL').catch(() => undefined)
      await handle.result.catch(() => undefined)
    }
    runtimeHandles.clear()
    if (orphanHandle) {
      await orphanHandle.cancel('SIGKILL').catch(() => undefined)
      await orphanHandle.result.catch(() => undefined)
    }
    setProcessTerminationHookForTests(null)
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
    delete process.env.THREADOS_BASE_PATH
    process.exitCode = 0
    clearRuntimeServiceFactoryForTests()
    if (basePath) await rm(basePath, { recursive: true, force: true })
    basePath = null
    orphanHandle = null
  })

  test('API and CLI cancel and retry a real fixture before startup recovery interrupts a live orphan', async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-pr06-proof-'))
    process.env.THREADOS_BASE_PATH = basePath
    const promptPath = join(basePath, '.threados', 'prompts', 'step-1.md')
    await mkdir(dirname(promptPath), { recursive: true })
    await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
      version: '1.0',
      id: 'sequence-1',
      name: 'PR-06 proof',
      steps: [{
        id: 'step-1',
        name: 'Long-running fixture',
        type: 'base',
        model: 'shell',
        assigned_agent_id: 'fixture-agent-step-1', agent_ref: 'fixture-agent-step-1',
        prompt_ref: { id: 'step-1', version: 1, path: '.threados/prompts/step-1.md' },
        prompt_file: '.threados/prompts/step-1.md',
        depends_on: [],
        status: 'READY',
      }],
      gates: [],
    }))
    await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
      mode: 'POWER',
      side_effect_mode: 'free',
    }))
    await writeFile(promptPath, '# real process proof')
    await writeAgentState(basePath, { version: 1, agents: [{
      id: 'fixture-agent-step-1', name: 'Fixture Agent', builderId: 'fixture-builder', builderName: 'Fixture Builder',
      registeredAt: '2026-07-16T00:00:00.000Z', version: 1, threadSurfaceIds: [],
      composition: buildAgentComposition({ model: 'shell', promptRef: { id: 'step-1', version: 1, path: '.threados/prompts/step-1.md' } }),
    }] })
    setProcessTerminationHookForTests(terminateFixtureDirectly)

    const service = await getThreadOSRuntimeService(basePath, {
      dependencies: {
        allowModelExecution: () => ({ allowed: true }),
        startProcess: async config => {
          const handle = await startProcess(config)
          runtimeHandles.add(handle)
          void handle.result.then(
            () => runtimeHandles.delete(handle),
            () => runtimeHandles.delete(handle),
          )
          return handle
        },
        dispatch: async (_model, options) => ({
          stepId: options.stepId,
          runId: options.runId,
          command: process.execPath,
          args: [fixturePath],
          cwd: options.cwd,
          timeout: 60_000,
          cancellationGraceMs: 250,
          forceKillWaitMs: 2_000,
          executablePayload: {
            command: process.execPath,
            args: [fixturePath],
            cwd: options.cwd,
          },
        }),
      },
    })
    globalThis.__THREADOS_RUNTIME_SERVICE__ = service
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service

    const { POST: startRun } = await import('@/app/api/runs/route')
    const started = await startRun(new Request('http://localhost/api/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'pr06-start',
      },
      body: JSON.stringify({
        sequence_id: 'sequence-1',
        target: { kind: 'step', step_id: 'step-1' },
        strategy: 'sequential',
        max_concurrency: 1,
        policy_confirmed: true,
      }),
    }))
    expect(started.status).toBe(202)
    const runId = ((await started.json()) as { run: { id: string } }).run.id
    const original = await waitForRunningAttempt(service, runId)
    expect(original.process?.pid).toBeNumber()

    const output: string[] = []
    const originalLog = console.log
    console.log = (line: string) => output.push(line)
    try {
      await controlCommand('stop', ['step-1'], {
        ...cliOptions,
        basePath,
        idempotencyKey: 'pr06-cli-stop',
      })
      expect(process.exitCode, output.at(-1)).toBe(0)
      process.exitCode = 0
      await controlCommand('restart', ['step-1'], {
        ...cliOptions,
        basePath,
        idempotencyKey: 'pr06-cli-restart',
      })
      expect(process.exitCode).toBe(0)
    } finally {
      console.log = originalLog
      process.exitCode = 0
    }

    expect(output).toHaveLength(2)
    await expect(service.inspectAttempt(original.attempt.id)).resolves.toMatchObject({
      attempt: { status: 'cancelled' },
      process: { status: 'exited' },
    })
    const retried = await waitForRetryAttempt(service, original.attempt.id)
    expect(retried.id).not.toBe(original.attempt.id)
    expect(retried.retry_of_attempt_id).toBe(original.attempt.id)
    const activeRetry = await waitForRunningAttempt(service, retried.workflow_run_id)
    expect(activeRetry.process?.id).not.toBe(original.process?.id)

    const { POST: stopRun } = await import('@/app/api/stop/route')
    const stopped = await stopRun(new Request('http://localhost/api/stop', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'pr06-api-stop',
      },
      body: JSON.stringify({ stepId: 'step-1' }),
    }))
    expect(stopped.status).toBe(200)
    await expect(service.inspectAttempt(retried.id)).resolves.toMatchObject({
      attempt: { status: 'cancelled' },
      process: { status: 'exited' },
    })

    const now = new Date().toISOString()
    const runs = new RunRepository(basePath)
    const attempts = new AttemptRepository(basePath)
    const processes = new ProcessRepository(basePath)
    await runs.create({
      schema_version: 2,
      id: 'recovery-run',
      revision: 0,
      sequence_id: 'sequence-1',
      sequence_snapshot_hash: 'recovery-sequence-hash',
      target: { kind: 'step', step_id: 'step-1' },
      strategy: 'sequential',
      status: 'running',
      max_concurrency: 1,
      policy_snapshot_hash: 'recovery-policy-hash',
      baseline_snapshot_id: null,
      attempt_ids: ['recovery-attempt'],
      created_by: 'proof',
      created_via: 'system',
      created_at: now,
      started_at: now,
      ended_at: null,
      cancellation_requested_at: null,
      summary: null,
      error_code: null,
      error_message: null,
    })
    await attempts.create({
      schema_version: 2,
      id: 'recovery-attempt',
      revision: 0,
      workflow_run_id: 'recovery-run',
      sequence_id: 'sequence-1',
      step_id: 'step-1',
      surface_id: 'thread-step-1',
      execution_index: 3,
      attempt_number: 3,
      retry_of_attempt_id: retried.id,
      status: 'running',
      agent_ref: null,
      model: 'shell',
      side_effect_class: 'execute',
      baseline_snapshot_id: null,
      workspace_id: null,
      process_id: 'recovery-process',
      compiled_prompt_hash: 'recovery-prompt-hash',
      input_manifest_ref: null,
      output_manifest_ref: null,
      artifact_manifest_ref: null,
      change_set_id: null,
      gate_decision_refs: [],
      created_at: now,
      started_at: now,
      ended_at: null,
      last_heartbeat_at: null,
      exit_code: null,
      signal: null,
      duration_ms: null,
      error_code: null,
      error_message: null,
    })
    await processes.create({
      schema_version: 1,
      id: 'recovery-process',
      revision: 0,
      workflow_run_id: 'recovery-run',
      attempt_id: 'recovery-attempt',
      provider: 'local-process',
      provider_handle: null,
      pid: null,
      command: process.execPath,
      redacted_args: ['<long-running-fixture>'],
      environment_keys: [],
      cwd: basePath,
      status: 'starting',
      launch_requested_at: now,
      started_at: null,
      ended_at: null,
      last_output_at: null,
      last_heartbeat_at: null,
      cancellation_requested_at: null,
      exit_code: null,
      signal: null,
    })

    orphanHandle = await startProcess({
      processId: 'recovery-process',
      stepId: 'step-1',
      runId: 'recovery-run',
      command: process.execPath,
      args: [fixturePath],
      cwd: basePath,
      timeout: 60_000,
      cancellationGraceMs: 250,
      forceKillWaitMs: 2_000,
    })
    expect(orphanHandle.pid).toBeNumber()
    await processes.update('recovery-process', 0, current => ({
      ...current,
      provider_handle: `local:${orphanHandle!.pid}`,
      pid: orphanHandle!.pid,
      status: 'running',
      started_at: new Date().toISOString(),
    }))

    clearRuntimeServiceFactoryForTests()
    const restarted = await getThreadOSRuntimeService(basePath)
    await expect(restarted.inspectAttempt('recovery-attempt')).resolves.toMatchObject({
      attempt: {
        status: 'interrupted',
        error_code: 'PROCESS_LOST',
      },
      process: {
        status: 'lost',
        pid: orphanHandle.pid,
      },
    })
    await expect(restarted.inspectRun('recovery-run')).resolves.toMatchObject({
      run: {
        status: 'interrupted',
        error_code: 'PROCESS_LOST',
      },
    })

    const cleanup = await orphanHandle.cancel('SIGKILL')
    expect(cleanup.success).toBe(true)
    await orphanHandle.result
    orphanHandle = null
  }, 120_000)
})
