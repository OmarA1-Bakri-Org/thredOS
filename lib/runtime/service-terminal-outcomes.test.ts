import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PolicyConfigSchema } from '../policy/schema'
import type { GateDecision } from '../contracts/schemas'
import type { RawProcessResult } from '../runner/process-handle'
import { reconcileCanonicalRuntime } from './recovery'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from './factory'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
import type { RuntimeCommandContext, RuntimeServiceDependencies, StartRunRequest } from './service-types'
import type { ProcessRecord, RuntimeCommandReceipt, StepAttempt, WorkflowRun } from './schema'
import type { Sequence } from '../sequence/schema'
import { stableRuntimeHash } from './attempt-executor'
import { buildAgentComposition } from '../agents/composition'
import { writeAgentState } from '../agents/repository'

const roots: string[] = []
const NOW = '2026-08-28T00:00:00.000Z'

afterEach(async () => {
  clearRuntimeServiceFactoryForTests()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function makeStep(id: string) {
  return {
    id,
    name: id,
    type: 'base' as const,
    model: 'shell',
    assigned_agent_id: `registered-${id}`,
    agent_ref: `registered-${id}`,
    prompt_file: `.threados/prompts/${id}.md`,
    prompt_ref: { id, version: 1, path: `.threados/prompts/${id}.md` },
    status: 'READY' as const,
    depends_on: [],
    side_effect_class: 'execute' as const,
  }
}

function sequence(stepIds: string[]): Sequence {
  return {
    version: '1',
    id: 'sequence-1',
    name: 'sequence-1',
    gates: [],
    groups: [],
    fusion_rules: [],
    steps: stepIds.map(makeStep),
  } as Sequence
}

function result(stepId: string, runId: string, overrides: Partial<RawProcessResult> = {}): RawProcessResult {
  return {
    stepId,
    runId,
    exitCode: 0,
    signal: null,
    status: 'SUCCESS',
    duration: 1,
    stdout: 'ok',
    stderr: '',
    startTime: new Date(NOW),
    endTime: new Date(NOW),
    ...overrides,
  }
}

function gateDecision(id: string, subjectRef: string): GateDecision {
  return {
    id,
    subject_type: 'step',
    subject_ref: subjectRef,
    gate_type: 'completion_contract_pass',
    status: 'BLOCK',
    reason_codes: ['CONTRACT_INCOMPLETE'],
    evidence_refs: [],
    decided_by: 'threados',
    decided_at: NOW,
  }
}

function context(idempotencyKey: string): RuntimeCommandContext {
  return {
    actor: 'test',
    interface: 'system',
    idempotencyKey,
    policyConfirmed: true,
  }
}

function request(target: StartRunRequest['target']): StartRunRequest {
  return {
    sequence_id: 'sequence-1',
    target,
    strategy: 'sequential',
    max_concurrency: 1,
  }
}

async function makeService(
  stepIds: string[],
  overrides: Partial<RuntimeServiceDependencies> = {},
) {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-service-terminal-outcomes-'))
  roots.push(basePath)
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
  // Register only the two known fixture identities; overrides retain their
  // original load timing and cannot implicitly register unknown assignments.
  const registeredSteps = [makeStep('step-1'), makeStep('step-2')]
  await Promise.all(registeredSteps.map(step => writeFile(join(basePath, step.prompt_ref.path), `registered command for ${step.id}`)))
  await writeAgentState(basePath, { version: 1, agents: registeredSteps.map(step => ({
    id: step.assigned_agent_id, name: step.id,
    builderId: 'fixture-builder', builderName: 'Fixture Builder',
    registeredAt: NOW, version: 1, threadSurfaceIds: [],
    composition: buildAgentComposition({ model: step.model, promptRef: step.prompt_ref, skillRefs: [] }),
  })) })
  let id = 0
  const deps: RuntimeServiceDependencies = {
    now: () => NOW,
    newId: prefix => `${prefix}-${++id}`,
    loadSequence: async () => sequence(stepIds),
    loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
    validateSequence: () => undefined,
    validatePrompt: async () => true,
    compilePrompt: async () => 'prompt',
    prepareArtifacts: async () => undefined,
    resolveGateSurface: async () => ({ surfaceClass: 'shared', revealState: null }),
    allowModelExecution: () => ({ allowed: true }),
    dispatch: async (_model, options) => ({
      stepId: options.stepId,
      runId: options.runId,
      command: 'mock-agent',
      args: [],
      cwd: basePath,
    }),
    startProcess: async config => ({
      processId: config.processId!,
      pid: 4242,
      result: Promise.resolve(result(config.stepId, config.runId)),
      cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
    }),
    saveArtifacts: async () => 'artifact',
    readRuntimeEvents: async () => [],
    readApprovals: async () => [],
    evaluatePreGates: () => [],
    evaluateCompletionGates: () => [],
    persistGateDecisions: async () => undefined,
    enforceBatchPolicy: () => ({ allowed: true, confirmation_required: false }),
    enforceExecutablePolicy: () => ({ allowed: true, confirmation_required: false }),
    recordApproval: async () => undefined,
    appendTrace: async () => undefined,
    projections: {
      beginRun: async () => undefined,
      beginAttempt: async () => undefined,
      finalizeAttempt: async () => undefined,
      finalizeRun: async () => undefined,
    },
    ...overrides,
  }
  const service = await getThreadOSRuntimeService(basePath, {
    dependencies: deps,
    reconcile: overrides.reconcile,
  })
  return {
    basePath,
    service,
    repositories: {
      runs: new RunRepository(basePath),
      attempts: new AttemptRepository(basePath),
      commands: new CommandRepository(basePath),
    },
  }
}

function staleRun(): WorkflowRun {
  return {
    schema_version: 2,
    id: 'run-stale',
    revision: 0,
    sequence_id: 'sequence-1',
    sequence_snapshot_hash: 'sha256:sequence',
    target: { kind: 'step', step_id: 'step-1' },
    strategy: 'sequential',
    status: 'running',
    max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy',
    baseline_snapshot_id: null,
    attempt_ids: ['attempt-stale'],
    created_by: 'test',
    created_via: 'system',
    created_at: NOW,
    started_at: NOW,
    ended_at: null,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
  }
}

function staleAttempt(): StepAttempt {
  return {
    schema_version: 2,
    id: 'attempt-stale',
    revision: 0,
    workflow_run_id: 'run-stale',
    sequence_id: 'sequence-1',
    step_id: 'step-1',
    surface_id: 'thread-step-1',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status: 'running',
    agent_ref: null,
    model: 'shell',
    side_effect_class: 'execute',
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: 'process-stale',
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: 'partial-input.json',
    output_manifest_ref: 'partial-output.json',
    artifact_manifest_ref: 'partial-artifacts.json',
    change_set_id: null,
    gate_decision_refs: ['gate-1'],
    created_at: NOW,
    started_at: NOW,
    ended_at: null,
    last_heartbeat_at: null,
    exit_code: null,
    signal: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
  }
}

function staleProcess(): ProcessRecord {
  return {
    schema_version: 1,
    id: 'process-stale',
    revision: 0,
    workflow_run_id: 'run-stale',
    attempt_id: 'attempt-stale',
    provider: 'local-process',
    provider_handle: 'local:4242',
    pid: 4242,
    command: 'node',
    redacted_args: ['[REDACTED]'],
    environment_keys: ['PATH'],
    cwd: 'C:\\temp\\threados',
    status: 'running',
    launch_requested_at: NOW,
    started_at: NOW,
    ended_at: null,
    last_output_at: NOW,
    last_heartbeat_at: null,
    cancellation_requested_at: null,
    exit_code: null,
    signal: null,
  }
}

function acceptedReceipt(requestHash: string): RuntimeCommandReceipt {
  return {
    schema_version: 1,
    id: 'command-stale',
    idempotency_key: 'interrupt-key',
    command_type: 'start-run',
    request_hash: requestHash,
    status: 'accepted',
    result_ref: 'run-stale',
    error_code: null,
    error_message: null,
    created_at: NOW,
    completed_at: null,
  }
}

describe('ThreadOSRuntimeService terminal outcomes', () => {
  test('runAndWait persists awaiting_review run status and failed command receipt', async () => {
    const { service, repositories } = await makeService(['step-1'], {
      startProcess: async config => ({
        processId: config.processId!,
        pid: 4242,
        result: Promise.resolve(result(config.stepId, config.runId)),
        cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
      }),
      evaluateCompletionGates: ({ step }) => [gateDecision(`gate-${step.id}`, `step:${step.id}`)],
    })

    const outcome = await service.runAndWait(request({ kind: 'step', step_id: 'step-1' }), context('review-key'))
    const persistedRun = await repositories.runs.get(outcome.run.id)
    const receipt = await repositories.commands.findByIdempotencyKey('review-key')

    expect(outcome.run.status).toBe('awaiting_review')
    expect(persistedRun).toMatchObject({
      status: 'awaiting_review',
      error_code: 'RUN_REVIEW_REQUIRED',
      error_message: 'One or more attempts require review',
    })
    expect(receipt).toMatchObject({
      status: 'failed',
      result_ref: outcome.run.id,
      error_code: 'RUN_REVIEW_REQUIRED',
      error_message: 'One or more attempts require review',
    })
  })

  test('runAndWait persists partially_successful run status and failed command receipt', async () => {
    const { service, repositories } = await makeService(['step-1', 'step-2'], {
      startProcess: async config => ({
        processId: config.processId!,
        pid: 4242,
        result: Promise.resolve(
          config.stepId === 'step-1'
            ? result(config.stepId, config.runId)
            : result(config.stepId, config.runId, { status: 'ERROR', exitCode: 1, stderr: 'boom' }),
        ),
        cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
      }),
    })

    const outcome = await service.runAndWait(request({ kind: 'runnable' }), context('partial-key'))
    const persistedRun = await repositories.runs.get(outcome.run.id)
    const receipt = await repositories.commands.findByIdempotencyKey('partial-key')

    expect(outcome.attempts.map(attempt => attempt.status)).toEqual(['completed', 'failed'])
    expect(outcome.run.status).toBe('partially_successful')
    expect(persistedRun).toMatchObject({
      status: 'partially_successful',
      error_code: 'RUN_PARTIALLY_SUCCESSFUL',
      error_message: 'Run completed with mixed attempt outcomes',
    })
    expect(receipt).toMatchObject({
      status: 'failed',
      result_ref: outcome.run.id,
      error_code: 'RUN_PARTIALLY_SUCCESSFUL',
      error_message: 'Run completed with mixed attempt outcomes',
    })
  })

  test('shared service replays interrupted canonical truth and preserves failed receipt error code', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-service-terminal-outcomes-'))
    roots.push(basePath)
    const interruptedRequest = request({ kind: 'step', step_id: 'step-1' })
    const interruptedContext = context('interrupt-key')
    const requestHash = stableRuntimeHash({
      request: { ...interruptedRequest, allow_empty: false },
      actor: interruptedContext.actor,
      interface: interruptedContext.interface,
      policyConfirmed: interruptedContext.policyConfirmed,
    })
    await new RunRepository(basePath).create(staleRun())
    await new AttemptRepository(basePath).create(staleAttempt())
    await new ProcessRepository(basePath).create(staleProcess())
    await new CommandRepository(basePath).createOrReplay(acceptedReceipt(requestHash))

    const service = await getThreadOSRuntimeService(basePath, {
      reconcile: async path => await reconcileCanonicalRuntime(path, {
        now: () => NOW,
        probePid: async () => false,
      }),
    })

    const outcome = await service.runAndWait(
      interruptedRequest,
      interruptedContext,
    )
    const persistedRun = await new RunRepository(basePath).get('run-stale')
    const receipt = await new CommandRepository(basePath).get('command-stale')

    expect(outcome.replayed).toBe(true)
    expect(outcome.run.status).toBe('interrupted')
    expect(persistedRun).toMatchObject({
      status: 'interrupted',
      error_code: 'PROCESS_LOST',
    })
    expect(receipt).toMatchObject({
      status: 'failed',
      result_ref: 'run-stale',
      error_code: 'PROCESS_LOST',
    })
  })
})
