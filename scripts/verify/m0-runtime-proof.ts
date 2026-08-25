import { spawnSync } from 'child_process'
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { isDeepStrictEqual } from 'util'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import {
  clearRuntimeServiceFactoryForTests,
  getThreadOSRuntimeService,
} from '@/lib/runtime/factory'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { RunRepository } from '@/lib/runtime/run-repository'
import type { ThreadOSRuntimeService } from '@/lib/runtime/service'
import type { RuntimeServiceDependencies } from '@/lib/runtime/service-types'
import {
  setProcessTerminationHookForTests,
  startProcess,
} from '@/lib/runner/wrapper'
import type { RunningProcessHandle } from '@/lib/runner/process-handle'
import { controlCommand } from '@/lib/seqctl/commands/control'
import { runCommand } from '@/lib/seqctl/commands/run'
import {
  normalizeProofValue,
  readCanonicalRuntimeTree,
  scanRuntimeServiceBoundary,
  validateM0ProofBundle,
  verificationTimestamp,
  withoutThreadOSBasePath,
  writeProofJson,
} from './m0-proof-helpers'

const repositoryRoot = process.cwd()
const proofRoot = join(
  repositoryRoot,
  'test-results',
  'verify',
  'm0',
  verificationTimestamp(),
  'm0-proof',
)
const processFixturePath = fileURLToPath(
  new URL('../../test/fixtures/process/long-running.mjs', import.meta.url),
)
const FIXED_NOW = '2026-07-16T00:00:00.000Z'
const CLI_OPTIONS = {
  json: true,
  help: false,
  watch: false,
  policyConfirmed: true,
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function createSequenceFixture(
  basePath: string,
  {
    id,
    stepId,
    model,
    name,
  }: {
    id: string
    stepId: string
    model: string
    name: string
  },
): Promise<void> {
  const promptPath = join(basePath, '.threados', 'prompts', `${stepId}.md`)
  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0',
    id,
    name,
    steps: [{
      id: stepId,
      name: stepId,
      type: 'base',
      model,
      prompt_file: `.threados/prompts/${stepId}.md`,
      depends_on: [],
      status: 'READY',
    }],
    gates: [],
  }))
  await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
    mode: 'POWER',
    side_effect_mode: 'free',
  }))
  await writeFile(promptPath, `# ${name}\n`)
}

function deterministicDependencies(
  onSpawn: () => void,
): Partial<RuntimeServiceDependencies> {
  const counters = new Map<string, number>()
  return {
    now: () => FIXED_NOW,
    loadSequence: async () => ({
      version: '1.0',
      id: 'sequence-parity',
      name: 'M0 parity proof',
      steps: [{
        id: 'step-a',
        name: 'step-a',
        type: 'base',
        model: 'codex',
        prompt_file: '.threados/prompts/step-a.md',
        depends_on: [],
        status: 'READY',
      }],
      gates: [],
    }),
    validatePrompt: async () => true,
    compilePrompt: async () => '# canonical M0 parity prompt\n',
    newId: prefix => {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}-${next}`
    },
    dispatch: async (_model, options) => ({
      stepId: options.stepId,
      runId: options.runId,
      command: 'proof-agent',
      args: [],
      cwd: options.cwd,
      timeout: options.timeout,
      executablePayload: {
        command: 'proof-agent',
        args: [],
        cwd: options.cwd,
      },
    }),
    runStep: async config => {
      onSpawn()
      return {
        stepId: config.stepId,
        runId: config.runId,
        exitCode: 0,
        status: 'SUCCESS' as const,
        duration: 1,
        stdout: 'ok',
        stderr: '',
        startTime: new Date(FIXED_NOW),
        endTime: new Date(FIXED_NOW),
      }
    },
    evaluatePreGates: () => [],
    evaluateCompletionGates: () => [],
    persistGateDecisions: async () => {},
  }
}

function clearRuntimeGlobals(): void {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  delete globalThis.__THREADOS_RUNTIME_SERVICE__
  delete process.env.THREDOS_BASE_PATH
  delete process.env.THREADOS_BASE_PATH
  clearRuntimeServiceFactoryForTests()
  process.exitCode = 0
}

async function silenceConsole<T>(operation: () => Promise<T>): Promise<T> {
  const originalLog = console.log
  console.log = () => {}
  try {
    return await operation()
  } finally {
    console.log = originalLog
  }
}

async function runParityProof(): Promise<void> {
  const cliPath = await mkdtemp(join(tmpdir(), 'threados-m0-cli-proof-'))
  const apiPath = await mkdtemp(join(tmpdir(), 'threados-m0-api-proof-'))
  let cliSpawns = 0
  let apiSpawns = 0

  try {
    await createSequenceFixture(cliPath, {
      id: 'sequence-parity',
      stepId: 'step-a',
      model: 'codex',
      name: 'M0 parity proof',
    })
    await createSequenceFixture(apiPath, {
      id: 'sequence-parity',
      stepId: 'step-a',
      model: 'codex',
      name: 'M0 parity proof',
    })

    const cliDependencies = deterministicDependencies(() => { cliSpawns += 1 })
    const apiDependencies = deterministicDependencies(() => { apiSpawns += 1 })
    const cliService = await getThreadOSRuntimeService(cliPath, {
      dependencies: cliDependencies,
      testCompatibility: { runStep: cliDependencies.runStep! },
    })
    const apiService = await getThreadOSRuntimeService(apiPath, {
      dependencies: apiDependencies,
      testCompatibility: { runStep: apiDependencies.runStep! },
    })

    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = cliService
    await silenceConsole(async () => {
      await runCommand('step', ['step-a'], {
        ...CLI_OPTIONS,
        basePath: cliPath,
        idempotencyKey: 'm0-parity-key',
      })
      process.exitCode = 0
      await runCommand('step', ['step-a'], {
        ...CLI_OPTIONS,
        basePath: cliPath,
        idempotencyKey: 'm0-parity-key',
      })
    })
    invariant(process.exitCode === 0, 'CLI parity request failed')
    process.exitCode = 0

    globalThis.__THREADOS_RUNTIME_SERVICE__ = apiService as RuntimeServicePort
    process.env.THREDOS_BASE_PATH = apiPath
    const { POST } = await import('@/app/api/run/route')
    const makeRequest = () => new Request('http://localhost/api/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'm0-parity-key',
      },
      body: JSON.stringify({ stepId: 'step-a', confirmPolicy: true }),
    })
    const firstResponse = await POST(makeRequest())
    const secondResponse = await POST(makeRequest())
    invariant(firstResponse.status === 200, `API parity request returned ${firstResponse.status}`)
    invariant(secondResponse.status === 200, `API replay returned ${secondResponse.status}`)

    const cliProjection = await cliService.inspectRun('run-1')
    const apiProjection = await apiService.inspectRun('run-1')
    const normalizedCliProjection = normalizeProofValue(cliProjection, cliPath)
    const normalizedApiProjection = normalizeProofValue(apiProjection, apiPath)
    const cliTree = await readCanonicalRuntimeTree(cliPath)
    const apiTree = await readCanonicalRuntimeTree(apiPath)
    const projectionsMatch = isDeepStrictEqual(
      normalizedCliProjection,
      normalizedApiProjection,
    )
    const stateTreesMatch = isDeepStrictEqual(cliTree, apiTree)

    await writeFile(
      join(proofRoot, 'cli-run-tree.txt'),
      `${JSON.stringify(cliTree, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      join(proofRoot, 'api-run-tree.txt'),
      `${JSON.stringify(apiTree, null, 2)}\n`,
      'utf8',
    )

    invariant(cliSpawns === 1, `CLI replay spawned ${cliSpawns} processes`)
    invariant(apiSpawns === 1, `API replay spawned ${apiSpawns} processes`)
    invariant(projectionsMatch, 'API and CLI runtime projections differ')
    invariant(stateTreesMatch, 'API and CLI canonical state trees differ')

    await writeProofJson(join(proofRoot, 'parity.json'), {
      passed: true,
      service: 'ThreadOSRuntimeService',
      schemaVersion: cliProjection.run.schema_version,
      projectionsMatch,
      stateTreesMatch,
      idempotentReplay: {
        cliSpawnCount: cliSpawns,
        apiSpawnCount: apiSpawns,
        duplicateProcessCreated: false,
      },
      terminalState: {
        run: cliProjection.run.status,
        attempt: cliProjection.attempts[0]?.status ?? null,
      },
    })
  } finally {
    clearRuntimeGlobals()
    await rm(cliPath, { recursive: true, force: true })
    await rm(apiPath, { recursive: true, force: true })
  }
}

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
    const retry = (await service.listRuns({ sequenceId: 'sequence-process-proof' }))
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

async function runProcessProof(): Promise<void> {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-m0-process-proof-'))
  const runtimeHandles = new Set<RunningProcessHandle>()
  let orphanHandle: RunningProcessHandle | null = null

  try {
    process.env.THREDOS_BASE_PATH = basePath
    await createSequenceFixture(basePath, {
      id: 'sequence-process-proof',
      stepId: 'step-process',
      model: 'shell',
      name: 'M0 real process proof',
    })
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
          args: [processFixturePath],
          cwd: options.cwd,
          timeout: 60_000,
          cancellationGraceMs: 250,
          forceKillWaitMs: 2_000,
          executablePayload: {
            command: process.execPath,
            args: [processFixturePath],
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
        'idempotency-key': 'm0-process-start',
      },
      body: JSON.stringify({
        sequence_id: 'sequence-process-proof',
        target: { kind: 'step', step_id: 'step-process' },
        strategy: 'sequential',
        max_concurrency: 1,
        policy_confirmed: true,
      }),
    }))
    invariant(started.status === 202, `real process start returned ${started.status}`)
    const runId = ((await started.json()) as { run: { id: string } }).run.id
    const original = await waitForRunningAttempt(service, runId)
    invariant(original.process?.pid, 'real process did not persist a PID')

    await silenceConsole(async () => {
      await controlCommand('stop', ['step-process'], {
        ...CLI_OPTIONS,
        basePath,
        idempotencyKey: 'm0-cli-stop',
      })
    })
    invariant(process.exitCode === 0, 'CLI real-process cancellation failed')
    process.exitCode = 0
    const cancelledOriginal = await service.inspectAttempt(original.attempt.id)
    invariant(
      cancelledOriginal.attempt.status === 'cancelled',
      `cancelled attempt remained ${cancelledOriginal.attempt.status}`,
    )
    invariant(
      cancelledOriginal.process?.status === 'exited',
      `cancelled process remained ${cancelledOriginal.process?.status ?? 'missing'}`,
    )

    await silenceConsole(async () => {
      await controlCommand('restart', ['step-process'], {
        ...CLI_OPTIONS,
        basePath,
        idempotencyKey: 'm0-cli-restart',
      })
    })
    invariant(process.exitCode === 0, 'CLI retry failed')
    process.exitCode = 0
    const retry = await waitForRetryAttempt(service, original.attempt.id)
    const runningRetry = await waitForRunningAttempt(service, retry.workflow_run_id)
    invariant(retry.id !== original.attempt.id, 'retry reused the historical attempt ID')
    invariant(
      retry.retry_of_attempt_id === original.attempt.id,
      'retry lineage does not reference the original attempt',
    )
    invariant(
      runningRetry.process?.id !== original.process?.id,
      'retry reused the original process record',
    )

    const { POST: stopRun } = await import('@/app/api/stop/route')
    const stopped = await stopRun(new Request('http://localhost/api/stop', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'm0-api-stop',
      },
      body: JSON.stringify({ stepId: 'step-process' }),
    }))
    invariant(stopped.status === 200, `API real-process cancellation returned ${stopped.status}`)
    const cancelledRetry = await service.inspectAttempt(retry.id)
    invariant(
      cancelledRetry.attempt.status === 'cancelled'
      && cancelledRetry.process?.status === 'exited',
      'API cancellation did not persist terminal retry state',
    )

    await writeProofJson(join(proofRoot, 'process-cancel.json'), {
      passed: true,
      controls: ['cli-stop', 'api-stop'],
      original: {
        attemptId: original.attempt.id,
        processId: original.process?.id,
        hadPid: typeof original.process?.pid === 'number',
        attemptStatus: cancelledOriginal.attempt.status,
        processStatus: cancelledOriginal.process?.status,
      },
      retry: {
        attemptId: retry.id,
        processId: runningRetry.process?.id,
        hadPid: typeof runningRetry.process?.pid === 'number',
        attemptStatus: cancelledRetry.attempt.status,
        processStatus: cancelledRetry.process?.status,
      },
    })
    await writeProofJson(join(proofRoot, 'retry-lineage.json'), {
      passed: true,
      originalAttemptId: original.attempt.id,
      retryAttemptId: retry.id,
      retryOfAttemptId: retry.retry_of_attempt_id,
      attemptIdChanged: retry.id !== original.attempt.id,
      processIdChanged: runningRetry.process?.id !== original.process?.id,
      historicalAttemptRemainedTerminal: cancelledOriginal.attempt.status === 'cancelled',
    })

    const now = new Date().toISOString()
    const runs = new RunRepository(basePath)
    const attempts = new AttemptRepository(basePath)
    const processes = new ProcessRepository(basePath)
    await runs.create({
      schema_version: 2,
      id: 'recovery-run',
      revision: 0,
      sequence_id: 'sequence-process-proof',
      sequence_snapshot_hash: 'recovery-sequence-hash',
      target: { kind: 'step', step_id: 'step-process' },
      strategy: 'sequential',
      status: 'running',
      max_concurrency: 1,
      policy_snapshot_hash: 'recovery-policy-hash',
      baseline_snapshot_id: null,
      attempt_ids: ['recovery-attempt'],
      created_by: 'm0-proof',
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
      sequence_id: 'sequence-process-proof',
      step_id: 'step-process',
      surface_id: 'thread-step-process',
      execution_index: 3,
      attempt_number: 3,
      retry_of_attempt_id: retry.id,
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
      stepId: 'step-process',
      runId: 'recovery-run',
      command: process.execPath,
      args: [processFixturePath],
      cwd: basePath,
      timeout: 60_000,
      cancellationGraceMs: 250,
      forceKillWaitMs: 2_000,
    })
    invariant(orphanHandle.pid, 'recovery fixture did not start')
    await processes.update('recovery-process', 0, current => ({
      ...current,
      provider_handle: `local:${orphanHandle!.pid}`,
      pid: orphanHandle!.pid,
      status: 'running',
      started_at: new Date().toISOString(),
    }))

    clearRuntimeServiceFactoryForTests()
    const restarted = await getThreadOSRuntimeService(basePath)
    const recoveredAttempt = await restarted.inspectAttempt('recovery-attempt')
    const recoveredRun = await restarted.inspectRun('recovery-run')
    invariant(
      recoveredAttempt.attempt.status === 'interrupted'
      && recoveredAttempt.attempt.error_code === 'PROCESS_LOST',
      'startup recovery did not interrupt the stale attempt',
    )
    invariant(
      recoveredAttempt.process?.status === 'lost',
      'startup recovery did not mark the absent managed process lost',
    )
    invariant(
      recoveredRun.run.status === 'interrupted'
      && recoveredRun.run.error_code === 'PROCESS_LOST',
      'startup recovery did not interrupt the stale run',
    )

    await writeProofJson(join(proofRoot, 'recovery-report.json'), {
      passed: true,
      run: {
        id: recoveredRun.run.id,
        status: recoveredRun.run.status,
        errorCode: recoveredRun.run.error_code,
      },
      attempt: {
        id: recoveredAttempt.attempt.id,
        status: recoveredAttempt.attempt.status,
        errorCode: recoveredAttempt.attempt.error_code,
      },
      process: {
        id: recoveredAttempt.process?.id,
        status: recoveredAttempt.process?.status,
        hadPersistedPid: typeof recoveredAttempt.process?.pid === 'number',
      },
      staleRunningStateEliminated: true,
    })
  } finally {
    for (const handle of runtimeHandles) {
      await handle.cancel('SIGKILL').catch(() => undefined)
      await handle.result.catch(() => undefined)
    }
    if (orphanHandle) {
      await orphanHandle.cancel('SIGKILL').catch(() => undefined)
      await orphanHandle.result.catch(() => undefined)
    }
    setProcessTerminationHookForTests(null)
    clearRuntimeGlobals()
    await rm(basePath, { recursive: true, force: true })
  }
}

function runVerificationCommand(
  label: string,
  args: string[],
): {
  label: string
  command: string
  exitCode: number
  output: string
} {
  const command = `bun ${args.join(' ')}`
  console.log(`[verify:m0] ${label}: ${command}`)
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: withoutThreadOSBasePath(process.env),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 100 * 1024 * 1024,
  })
  const output = [
    result.stdout ?? '',
    result.stderr ?? '',
    result.error ? `${result.error.message}\n` : '',
  ].join('')
  if (output.trim()) console.log(output.trimEnd())
  return {
    label,
    command,
    exitCode: result.status ?? 1,
    output,
  }
}

function formatCommandResults(
  programmaticProof: string,
  results: ReturnType<typeof runVerificationCommand>[],
): string {
  return [
    `Programmatic proof: ${programmaticProof}`,
    '',
    ...results.flatMap(result => [
      `Command: ${result.command}`,
      `Label: ${result.label}`,
      `Exit code: ${result.exitCode}`,
      '',
      result.output.trimEnd(),
      '',
    ]),
  ].join('\n')
}

async function main(): Promise<void> {
  await mkdir(proofRoot, { recursive: true })
  console.log(`[verify:m0] evidence: ${proofRoot}`)

  await runParityProof()
  await runProcessProof()

  const architectureReport = await scanRuntimeServiceBoundary(repositoryRoot)
  await writeProofJson(
    join(proofRoot, 'architecture-boundary-report.json'),
    architectureReport,
  )
  invariant(architectureReport.passed, 'runtime service architecture boundary scan failed')

  const targeted = runVerificationCommand('targeted runtime proof tests', [
    'test',
    'scripts/verify/m0-proof-helpers.test.ts',
    'test/architecture/runtime-service-boundary.test.ts',
    'test/integration/runtime-interface-parity.test.ts',
    'test/integration/pr06-process-recovery.test.ts',
    'lib/runtime/projections.test.ts',
    'components/workbench/sections/RunSection.runtime.test.tsx',
    'components/workbench/sections/RunSection.test.tsx',
  ])
  const fullCheck = runVerificationCommand('full repository check', ['run', 'check'])
  await writeFile(
    join(proofRoot, 'test-results.txt'),
    formatCommandResults(
      'API/CLI parity, idempotent replay, real cancellation, retry lineage, recovery, and architecture scan passed.',
      [targeted, fullCheck],
    ),
    'utf8',
  )

  const build = runVerificationCommand('production build', ['run', 'build'])
  await writeFile(
    join(proofRoot, 'build-results.txt'),
    formatCommandResults('Canonical runtime evidence was generated before the build.', [build]),
    'utf8',
  )

  invariant(targeted.exitCode === 0, 'targeted M0 proof tests failed')
  invariant(fullCheck.exitCode === 0, 'full repository check failed')
  invariant(build.exitCode === 0, 'production build failed')

  const validation = await validateM0ProofBundle(proofRoot)
  invariant(
    validation.valid,
    `M0 proof bundle is incomplete: missing=${validation.missing.join(',')} empty=${validation.empty.join(',')}`,
  )

  console.log(`[verify:m0] passed: ${proofRoot}`)
}

await main().catch(error => {
  console.error(`[verify:m0] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
