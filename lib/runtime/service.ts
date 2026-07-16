import { topologicalSort } from '../sequence/dag'
import type { Sequence, Step } from '../sequence/schema'
import { RuntimeCommandContextSchema, StartRunCommandSchema } from './command-schema'
import { AttemptExecutor, stableRuntimeHash } from './attempt-executor'
import { RuntimeServiceError } from './errors'
import { transitionRun } from './lifecycle'
import type {
  CompletedRunResult, RuntimeCommandContext, RuntimeServiceOptions, StartRunRequest,
} from './service-types'
import type { RuntimeCommandReceipt, StepAttempt, WorkflowRun, WorkflowRunTarget } from './schema'

function targetRef(target: WorkflowRunTarget): string {
  if (target.kind === 'step') return `step:${target.step_id}`
  if (target.kind === 'group') return `group:${target.group_id}`
  return 'mode:runnable'
}

function runnable(sequence: Sequence): Step[] {
  const done = new Set([
    ...sequence.steps.filter(step => step.status === 'DONE').map(step => step.id),
    ...sequence.gates.filter(gate => gate.status === 'APPROVED').map(gate => gate.id),
  ])
  const ready = new Map(sequence.steps
    .filter(step => step.status === 'READY' && step.depends_on.every(id => done.has(id)))
    .map(step => [step.id, step]))
  return topologicalSort(sequence).map(id => ready.get(id)).filter((step): step is Step => step !== undefined)
}

function resolveTarget(sequence: Sequence, target: WorkflowRunTarget): Step[] {
  if (target.kind === 'step') return sequence.steps.filter(step => step.id === target.step_id)
  const ready = runnable(sequence)
  return target.kind === 'group' ? ready.filter(step => step.group_id === target.group_id) : ready
}

function surfaceId(step: Step): string {
  return step.surface_ref || `thread-${step.id}`
}

const terminalRunStatuses = new Set<WorkflowRun['status']>([
  'successful', 'failed', 'cancelled', 'interrupted', 'awaiting_review', 'partially_successful',
])

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

export class ThreadOSRuntimeService {
  private readonly basePath: string
  private readonly scheduler: RuntimeServiceOptions['scheduler']
  private readonly repositories: RuntimeServiceOptions['repositories']
  private readonly deps: RuntimeServiceOptions['dependencies']
  private readonly inFlight = new Map<string, Promise<CompletedRunResult>>()

  constructor(options: RuntimeServiceOptions) {
    this.basePath = options.basePath
    this.scheduler = options.scheduler
    this.repositories = options.repositories
    this.deps = options.dependencies
  }

  async startRun(request: StartRunRequest, rawContext: RuntimeCommandContext): Promise<WorkflowRun> {
    const context = RuntimeCommandContextSchema.parse(rawContext)
    const command = StartRunCommandSchema.parse({ command_type: 'start-run', context, ...request })
    request = {
      sequence_id: command.sequence_id, target: command.target,
      strategy: command.strategy, max_concurrency: command.max_concurrency,
    }
    if (request.strategy !== 'sequential' || request.max_concurrency !== 1) {
      throw new RuntimeServiceError('PARALLEL_RUNTIME_UNAVAILABLE', 'Parallel runtime is unavailable before Milestone 3')
    }
    if (request.sequence_id.length === 0) throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', 'sequence_id is required')

    const runId = this.deps.newId('run')
    const commandId = this.deps.newId('command')
    const requestHash = stableRuntimeHash({ request, actor: context.actor, interface: context.interface, policyConfirmed: context.policyConfirmed })
    const receipt: RuntimeCommandReceipt = {
      schema_version: 1, id: commandId, idempotency_key: context.idempotencyKey,
      command_type: 'start-run', request_hash: requestHash, status: 'accepted', result_ref: runId,
      error_code: null, error_message: null, created_at: this.deps.now(), completed_at: null,
    }
    const accepted = await this.repositories.commands.createOrReplay(receipt)
    if (accepted.id !== commandId) return await this.waitForExistingRun(accepted)

    const completion = deferred<CompletedRunResult>()
    this.inFlight.set(runId, completion.promise)

    const now = this.deps.now()
    const run: WorkflowRun = {
      schema_version: 2, id: runId, revision: 0, sequence_id: request.sequence_id,
      sequence_snapshot_hash: 'pending', target: request.target, strategy: 'sequential', status: 'pending',
      max_concurrency: 1, policy_snapshot_hash: 'pending', baseline_snapshot_id: null, attempt_ids: [],
      created_by: context.actor, created_via: context.interface, created_at: now, started_at: null, ended_at: null,
      cancellation_requested_at: null, summary: null, error_code: null, error_message: null,
    }
    try {
      await this.repositories.runs.create(run)
    } catch (error) {
      completion.reject(error)
      this.inFlight.delete(runId)
      await this.repositories.commands.complete(commandId, {
        status: 'failed', errorCode: 'RUN_PERSIST_FAILED', errorMessage: error instanceof Error ? error.message : String(error),
      }, this.deps.now()).catch(() => undefined)
      throw error
    }
    const scheduled = this.scheduler.enqueue(runId, async () => await this.executeRun(run, request, context, commandId))
    void scheduled.then(completion.resolve, completion.reject).finally(() => {
      if (this.inFlight.get(runId) === completion.promise) this.inFlight.delete(runId)
    })
    return run
  }

  async runAndWait(request: StartRunRequest, context: RuntimeCommandContext): Promise<CompletedRunResult> {
    const started = await this.startRun(request, context)
    const inFlight = this.inFlight.get(started.id) ?? this.scheduler.get<CompletedRunResult>(started.id)
    if (inFlight) return await inFlight
    return await this.waitForDurableCompletion(started.id, context.idempotencyKey)
  }

  private async waitForExistingRun(receipt: RuntimeCommandReceipt): Promise<WorkflowRun> {
    const runId = receipt.result_ref
    if (!runId) throw new RuntimeServiceError('RUN_NOT_FOUND', 'accepted start-run receipt has no result reference')
    while (true) {
      const run = await this.repositories.runs.get(runId)
      if (run) return run
      const currentReceipt = await this.repositories.commands.get(receipt.id)
      if (currentReceipt?.status === 'failed') {
        throw new RuntimeServiceError('RUN_NOT_FOUND', `accepted run ${runId} failed before persistence`)
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  private async waitForDurableCompletion(runId: string, idempotencyKey: string): Promise<CompletedRunResult> {
    while (true) {
      const inFlight = this.inFlight.get(runId) ?? this.scheduler.get<CompletedRunResult>(runId)
      if (inFlight) return await inFlight
      const [run, receipt] = await Promise.all([
        this.repositories.runs.get(runId),
        this.repositories.commands.findByIdempotencyKey(idempotencyKey),
      ])
      if (run && terminalRunStatuses.has(run.status) && receipt && receipt.status !== 'accepted') {
        return { run, attempts: await this.repositories.attempts.listForRun(run.id), replayed: true }
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  private async executeRun(
    initialRun: WorkflowRun,
    request: StartRunRequest,
    context: RuntimeCommandContext,
    commandId: string,
  ): Promise<CompletedRunResult> {
    let run = initialRun
    const attempts: StepAttempt[] = []
    try {
      const sequence = await this.deps.loadSequence(this.basePath)
      this.deps.validateSequence(sequence)
      if ((sequence.id ?? sequence.name) !== request.sequence_id) {
        throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', `sequence ${request.sequence_id} was not found`)
      }
      const policy = await this.deps.loadPolicy(this.basePath)
      run = await transitionRun(this.repositories.runs, run, 'provisioning', {
        sequence_snapshot_hash: stableRuntimeHash(sequence), policy_snapshot_hash: stableRuntimeHash(policy),
      })
      await this.deps.projections.beginRun({ run, sequence }).catch(() => undefined)
      const steps = resolveTarget(sequence, request.target)
      if (steps.length === 0) throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', 'runtime target resolved to no runnable steps')
      const batchPolicy = this.deps.enforceBatchPolicy({ policy, stepCount: steps.length, confirmed: context.policyConfirmed, basePath: this.basePath })
      if (!batchPolicy.allowed || (batchPolicy.confirmation_required && !context.policyConfirmed)) {
        throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', batchPolicy.reason ?? 'Batch policy denied')
      }

      const executor = new AttemptExecutor(this.basePath, this.repositories, this.deps)
      let executionIndex = 0
      for (const step of steps) {
        executionIndex++
        const attemptId = this.deps.newId('attempt')
        const attempt: StepAttempt = {
          schema_version: 2, id: attemptId, revision: 0, workflow_run_id: run.id,
          sequence_id: run.sequence_id, step_id: step.id, surface_id: surfaceId(step), execution_index: executionIndex,
          attempt_number: 1, retry_of_attempt_id: null, status: 'pending', agent_ref: step.assigned_agent_id ?? null,
          model: step.model, side_effect_class: step.side_effect_class ?? 'execute', baseline_snapshot_id: null,
          workspace_id: null, process_id: null, compiled_prompt_hash: 'pending', input_manifest_ref: null,
          output_manifest_ref: null, artifact_manifest_ref: null, change_set_id: null, gate_decision_refs: [],
          created_at: this.deps.now(), started_at: null, ended_at: null, last_heartbeat_at: null,
          exit_code: null, signal: null, duration_ms: null, error_code: null, error_message: null,
        }
        await this.repositories.attempts.create(attempt)
        run = await this.repositories.runs.update(run.id, run.revision, value => ({ ...value, attempt_ids: [...value.attempt_ids, attemptId] }))
        await this.deps.projections.beginAttempt({ run, attempt, step }).catch(() => undefined)
        const outcome = await executor.execute({ run, attempt, sequence, step, policy, context, targetRef: targetRef(request.target) })
        run = outcome.run
        attempts.push(outcome.attempt)
      }

      const successful = attempts.every(attempt => attempt.status === 'completed')
      const terminal = successful ? 'successful' : 'failed'
      run = await transitionRun(this.repositories.runs, run, terminal, {
        ended_at: this.deps.now(), summary: `${attempts.length} attempt(s)`,
        error_code: successful ? null : 'RUN_ATTEMPT_FAILED', error_message: successful ? null : 'One or more attempts did not complete',
      })
      await this.deps.projections.finalizeRun({ run, attempts }).catch(() => undefined)
      await this.repositories.commands.complete(commandId, successful
        ? { status: 'completed', resultRef: run.id }
        : { status: 'failed', errorCode: run.error_code ?? 'RUN_ATTEMPT_FAILED', errorMessage: run.error_message ?? 'Run failed' },
      this.deps.now())
      return { run, attempts, replayed: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (run.status === 'pending' || run.status === 'provisioning' || run.status === 'running') {
        run = await transitionRun(this.repositories.runs, run, 'failed', {
          ended_at: this.deps.now(), error_code: error instanceof RuntimeServiceError ? error.code : 'RUNTIME_EXECUTION_FAILED', error_message: message,
        })
      }
      await this.deps.projections.finalizeRun({ run, attempts }).catch(() => undefined)
      await this.repositories.commands.complete(commandId, {
        status: 'failed', errorCode: run.error_code ?? 'RUNTIME_EXECUTION_FAILED', errorMessage: message,
      }, this.deps.now()).catch(() => undefined)
      return { run, attempts, replayed: false }
    }
  }
}
