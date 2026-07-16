import { topologicalSort } from '../sequence/dag'
import type { Sequence, Step } from '../sequence/schema'
import {
  CancelAttemptCommandSchema, CancelRunCommandSchema, RetryAttemptCommandSchema,
  RuntimeCommandContextSchema, StartRunCommandSchema,
} from './command-schema'
import { AttemptExecutor, stableRuntimeHash } from './attempt-executor'
import { RuntimeErrorCodeSchema } from './error-codes'
import { RuntimeServiceError } from './errors'
import { transitionAttempt, transitionRun } from './lifecycle'
import { RuntimeRepositoryError } from './run-repository'
import { ProcessController } from './process-controller'
import type {
  AttemptProjection, CompletedRunResult, LatestAttemptQuery, RunProjection, RuntimeCommandContext,
  RuntimeReconciliationReport, RuntimeRunQuery, RuntimeServiceOptions, SequenceStatusProjection, StartRunRequest,
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
const CONTROL_WINDOW_POLLS = 250
const CONTROL_POLL_INTERVAL_MS = 20

function compareAttemptRecency(left: StepAttempt, right: StepAttempt): number {
  const byCreated = right.created_at.localeCompare(left.created_at)
  if (byCreated !== 0) return byCreated
  const byAttempt = right.attempt_number - left.attempt_number
  if (byAttempt !== 0) return byAttempt
  const byIndex = right.execution_index - left.execution_index
  return byIndex !== 0 ? byIndex : right.id.localeCompare(left.id)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

interface OwnedMutation<T> {
  requestHash: string
  promise: Promise<T>
}

export class ThreadOSRuntimeService {
  private readonly basePath: string
  private readonly scheduler: RuntimeServiceOptions['scheduler']
  private readonly repositories: RuntimeServiceOptions['repositories']
  private readonly deps: RuntimeServiceOptions['dependencies']
  private readonly processController: ProcessController
  private readonly inFlight = new Map<string, Promise<CompletedRunResult>>()
  private readonly inFlightAttempts = new Map<string, Promise<{ run: WorkflowRun; attempt: StepAttempt }>>()
  private readonly inFlightAttemptCancellations = new Map<string, Promise<StepAttempt>>()
  private readonly inFlightRunCancellations = new Map<string, Promise<WorkflowRun>>()
  private readonly attemptCancellationOwners = new Map<string, OwnedMutation<StepAttempt>>()
  private readonly runCancellationOwners = new Map<string, OwnedMutation<WorkflowRun>>()

  constructor(options: RuntimeServiceOptions) {
    this.basePath = options.basePath
    this.scheduler = options.scheduler
    this.repositories = options.repositories
    this.deps = options.dependencies
    if (typeof this.deps.startProcess !== 'function') {
      throw new Error('RuntimeServiceDependencies.startProcess is required')
    }
    this.processController = new ProcessController({
      processes: this.repositories.processes,
      now: this.deps.now,
      startProcess: this.deps.startProcess,
    })
  }

  async startRun(request: StartRunRequest, rawContext: RuntimeCommandContext): Promise<WorkflowRun> {
    return await this.startRunWithLineage(request, rawContext)
  }

  private async startRunWithLineage(
    request: StartRunRequest,
    rawContext: RuntimeCommandContext,
    retryOf?: StepAttempt,
    preferredRunId?: string,
  ): Promise<WorkflowRun> {
    if (request.sequence_id === '$current') {
      const sequence = await this.deps.loadSequence(this.basePath)
      request = { ...request, sequence_id: sequence.id ?? sequence.name }
    }
    const context = RuntimeCommandContextSchema.parse(rawContext)
    const command = StartRunCommandSchema.parse({ command_type: 'start-run', context, ...request })
    request = {
      sequence_id: command.sequence_id, target: command.target,
      strategy: command.strategy, max_concurrency: command.max_concurrency,
      allow_empty: command.allow_empty,
    }
    if (request.strategy !== 'sequential' || request.max_concurrency !== 1) {
      throw new RuntimeServiceError('PARALLEL_RUNTIME_UNAVAILABLE', 'Parallel runtime is unavailable before Milestone 3')
    }
    if (request.sequence_id.length === 0) throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', 'sequence_id is required')

    const runId = preferredRunId ?? this.deps.newId('run')
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
    const scheduled = this.scheduler.enqueue(runId, async () => await this.executeRun(run, request, context, commandId, retryOf))
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

  async listRuns(query: RuntimeRunQuery = {}): Promise<RunProjection[]> {
    const runs = await this.repositories.runs.list(query)
    return await Promise.all(runs.map(async run => ({
      run,
      attempts: await this.repositories.attempts.listForRun(run.id),
    })))
  }

  async inspectRun(runId: string): Promise<RunProjection> {
    const run = await this.repositories.runs.get(runId)
    if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
    return { run, attempts: await this.repositories.attempts.listForRun(run.id) }
  }

  async inspectAttempt(attemptId: string): Promise<AttemptProjection> {
    const attempt = await this.repositories.attempts.get(attemptId)
    if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    const process = attempt.process_id ? await this.repositories.processes.get(attempt.process_id) : null
    return { attempt, process }
  }

  async findLatestAttempt(query: LatestAttemptQuery): Promise<StepAttempt | null> {
    let sequenceId = query.sequenceId
    if (sequenceId === '$current') {
      const sequence = await this.deps.loadSequence(this.basePath)
      if (!sequence.steps.some(step => step.id === query.stepId)) {
        throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', `step ${query.stepId} was not found`)
      }
      sequenceId = sequence.id ?? sequence.name
    }
    const runs = await this.repositories.runs.list({ sequenceId })
    const attempts = (await Promise.all(runs.map(run => this.repositories.attempts.listForRun(run.id)))).flat()
      .filter(attempt => attempt.step_id === query.stepId)
      .filter(attempt => !query.statuses || query.statuses.includes(attempt.status))
    attempts.sort(compareAttemptRecency)
    return attempts[0] ?? null
  }

  async cancelAttempt(attemptId: string, rawContext: RuntimeCommandContext): Promise<StepAttempt> {
    const context = RuntimeCommandContextSchema.parse(rawContext)
    CancelAttemptCommandSchema.parse({ command_type: 'cancel-attempt', context, attempt_id: attemptId })
    const requestHash = this.mutationRequestHash('cancel-attempt', attemptId, context)
    const owner = this.attemptCancellationOwners.get(context.idempotencyKey)
    if (owner) {
      if (owner.requestHash !== requestHash) {
        throw new RuntimeServiceError(
          'IDEMPOTENCY_CONFLICT',
          'idempotency key was already used for a different request payload',
        )
      }
      return await owner.promise
    }
    const cancellation = this.cancelAttemptOwned(attemptId, context)
    this.attemptCancellationOwners.set(context.idempotencyKey, { requestHash, promise: cancellation })
    try {
      return await cancellation
    } finally {
      if (this.attemptCancellationOwners.get(context.idempotencyKey)?.promise === cancellation) {
        this.attemptCancellationOwners.delete(context.idempotencyKey)
      }
    }
  }

  private async cancelAttemptOwned(
    attemptId: string,
    context: RuntimeCommandContext,
  ): Promise<StepAttempt> {
    const claim = await this.claimMutation('cancel-attempt', attemptId, context)
    if (claim.replayed) return await this.replayAttemptMutation(claim.receipt)
    const cancellation = this.executeAttemptCancellation(attemptId, claim.receipt.id)
    this.inFlightAttemptCancellations.set(claim.receipt.id, cancellation)
    try {
      return await cancellation
    } finally {
      if (this.inFlightAttemptCancellations.get(claim.receipt.id) === cancellation) {
        this.inFlightAttemptCancellations.delete(claim.receipt.id)
      }
    }
  }

  private async executeAttemptCancellation(attemptId: string, commandId: string): Promise<StepAttempt> {
    const attempt = await this.repositories.attempts.get(attemptId)
    if (!attempt) return await this.failAttemptMutation(commandId, 'ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    if (attempt.status !== 'running') {
      return await this.failAttemptMutation(commandId, 'ATTEMPT_NOT_RUNNING', `attempt ${attemptId} is ${attempt.status}`)
    }
    if (!attempt.process_id) {
      return await this.failAttemptMutation(
        commandId,
        'PROCESS_CONTROL_FAILED',
        `attempt ${attemptId} has no canonical process`,
      )
    }
    let cancelled: StepAttempt
    try {
      cancelled = await this.cancelAttemptForRun(attempt.id)
    } catch (error) {
      const normalized = error instanceof RuntimeServiceError
        ? error
        : new RuntimeServiceError(
            'PROCESS_CONTROL_FAILED',
            error instanceof Error ? error.message : String(error),
            error,
          )
      const code = normalized.code === 'ATTEMPT_NOT_FOUND'
        || normalized.code === 'ATTEMPT_NOT_RUNNING'
        || normalized.code === 'PROCESS_CONTROL_FAILED'
        ? normalized.code
        : 'PROCESS_CONTROL_FAILED'
      return await this.failAttemptMutation(commandId, code, normalized.message)
    }
    if (cancelled.status !== 'cancelled') {
      return await this.failAttemptMutation(
        commandId,
        'PROCESS_CONTROL_FAILED',
        `process ${attempt.process_id} terminated without cancelled attempt evidence`,
      )
    }
    await this.repositories.commands.complete(commandId, {
      status: 'completed',
      resultRef: cancelled.id,
    }, this.deps.now())
    return cancelled
  }

  async cancelRun(runId: string, rawContext: RuntimeCommandContext): Promise<WorkflowRun> {
    const context = RuntimeCommandContextSchema.parse(rawContext)
    CancelRunCommandSchema.parse({ command_type: 'cancel-run', context, workflow_run_id: runId })
    const requestHash = this.mutationRequestHash('cancel-run', runId, context)
    const owner = this.runCancellationOwners.get(context.idempotencyKey)
    if (owner) {
      if (owner.requestHash !== requestHash) {
        throw new RuntimeServiceError(
          'IDEMPOTENCY_CONFLICT',
          'idempotency key was already used for a different request payload',
        )
      }
      return await owner.promise
    }
    const cancellation = this.cancelRunOwned(runId, context)
    this.runCancellationOwners.set(context.idempotencyKey, { requestHash, promise: cancellation })
    try {
      return await cancellation
    } finally {
      if (this.runCancellationOwners.get(context.idempotencyKey)?.promise === cancellation) {
        this.runCancellationOwners.delete(context.idempotencyKey)
      }
    }
  }

  private async cancelRunOwned(
    runId: string,
    context: RuntimeCommandContext,
  ): Promise<WorkflowRun> {
    const claim = await this.claimMutation('cancel-run', runId, context)
    if (claim.replayed) return await this.replayRunCancellation(claim.receipt)
    const cancellation = this.executeRunCancellation(runId, claim.receipt.id)
    this.inFlightRunCancellations.set(claim.receipt.id, cancellation)
    try {
      return await cancellation
    } finally {
      if (this.inFlightRunCancellations.get(claim.receipt.id) === cancellation) {
        this.inFlightRunCancellations.delete(claim.receipt.id)
      }
    }
  }

  private async executeRunCancellation(runId: string, commandId: string): Promise<WorkflowRun> {
    let run = await this.repositories.runs.get(runId)
    if (!run) {
      await this.repositories.commands.complete(commandId, { status: 'failed', errorCode: 'RUN_NOT_FOUND', errorMessage: `run ${runId} was not found` }, this.deps.now())
      throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
    }
    if (terminalRunStatuses.has(run.status)) {
      await this.repositories.commands.complete(commandId, {
        status: 'failed',
        errorCode: 'ATTEMPT_NOT_RUNNING',
        errorMessage: `run ${runId} is ${run.status}`,
      }, this.deps.now())
      throw new RuntimeServiceError('ATTEMPT_NOT_RUNNING', `run ${runId} is ${run.status}`)
    }
    run = await this.persistRunCancellationIntent(run.id)
    const attempts = await this.repositories.attempts.listForRun(run.id)
    const active = attempts.filter(attempt => ['pending', 'provisioning', 'running'].includes(attempt.status))
    if (active.length === 0) {
      if (attempts.length === 0 || attempts.every(attempt => attempt.status === 'cancelled')) {
        const cancelled = await this.completeRunCancellation(run.id)
        await this.repositories.commands.complete(commandId, {
          status: 'completed',
          resultRef: cancelled.id,
        }, this.deps.now())
        return cancelled
      }
      const execution = this.inFlight.get(run.id) ?? this.scheduler.get<CompletedRunResult>(run.id)
      if (execution) {
        const cancelled = await this.waitForCancelledRun(run.id)
        await this.repositories.commands.complete(commandId, {
          status: 'completed',
          resultRef: cancelled.id,
        }, this.deps.now())
        return cancelled
      }
      await this.repositories.commands.complete(commandId, {
        status: 'failed',
        errorCode: 'ATTEMPT_NOT_RUNNING',
        errorMessage: `run ${runId} has no active attempt`,
      }, this.deps.now())
      throw new RuntimeServiceError('ATTEMPT_NOT_RUNNING', `run ${runId} has no active attempt`)
    }
    for (const attempt of active) {
      try {
        await this.cancelAttemptForRun(attempt.id)
      } catch (error) {
        const normalized = error instanceof RuntimeServiceError
          ? error
          : new RuntimeServiceError(
              'PROCESS_CONTROL_FAILED',
              error instanceof Error ? error.message : String(error),
              error,
            )
        await this.repositories.commands.complete(commandId, {
          status: 'failed',
          errorCode: normalized.code,
          errorMessage: normalized.message,
        }, this.deps.now())
        throw normalized
      }
    }
    const latestAttempts = await this.repositories.attempts.listForRun(run.id)
    const allCancelled = latestAttempts.length > 0
      && latestAttempts.every(attempt => attempt.status === 'cancelled')
    const cancelled = allCancelled
      ? await this.completeRunCancellation(run.id)
      : await this.waitForCancelledRun(run.id)
    await this.repositories.commands.complete(commandId, {
      status: 'completed',
      resultRef: cancelled.id,
    }, this.deps.now())
    return cancelled
  }

  async retryAttempt(attemptId: string, rawContext: RuntimeCommandContext): Promise<StepAttempt> {
    const context = RuntimeCommandContextSchema.parse(rawContext)
    RetryAttemptCommandSchema.parse({ command_type: 'retry-attempt', context, attempt_id: attemptId })
    const unboundRetry = `retry:${encodeURIComponent(attemptId)}`
    const claim = await this.claimMutation('retry-attempt', attemptId, context, unboundRetry)
    let receipt = claim.receipt
    if (!claim.replayed) {
      const original = await this.repositories.attempts.get(attemptId)
      if (!original) return await this.failAttemptMutation(receipt.id, 'ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
      if (['pending', 'provisioning', 'running'].includes(original.status)) {
        return await this.failAttemptMutation(receipt.id, 'ATTEMPT_NOT_RUNNING', `attempt ${attemptId} is not terminal`)
      }
      const childRunId = this.deps.newId('run')
      const binding = this.retryBinding(original.id, childRunId)
      try {
        receipt = await this.repositories.commands.bindResult(receipt.id, binding, unboundRetry)
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') throw error
        receipt = await this.repositories.commands.get(receipt.id) ?? receipt
      }
    }
    return await this.replayRetryMutation(receipt, context)
  }

  async getStatus(): Promise<SequenceStatusProjection> {
    await this.reconcile()
    const sequence = await this.deps.loadSequence(this.basePath)
    const latest = new Map<string, StepAttempt>()
    const runs = await this.repositories.runs.list({ sequenceId: sequence.id ?? sequence.name })
    for (const run of runs) {
      for (const attempt of await this.repositories.attempts.listForRun(run.id)) {
        const current = latest.get(attempt.step_id)
        if (!current || compareAttemptRecency(attempt, current) < 0) {
          latest.set(attempt.step_id, attempt)
        }
      }
    }
    const statusFor = (step: Step): Step['status'] => {
      const status = latest.get(step.id)?.status
      if (!status) return step.status
      if (status === 'running' || status === 'provisioning' || status === 'pending') return 'RUNNING'
      if (status === 'completed') return 'DONE'
      if (status === 'needs_review') return 'NEEDS_REVIEW'
      return 'FAILED'
    }
    const steps = sequence.steps.map(step => ({
      id: step.id, name: step.name, type: step.type, status: statusFor(step), model: step.model,
      dependsOn: step.depends_on, processId: latest.get(step.id)?.process_id ?? undefined,
      groupId: step.group_id, fusionCandidates: step.fusion_candidates, fusionSynth: step.fusion_synth,
    }))
    const summary = { total: steps.length, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 }
    const keys = { READY: 'ready', RUNNING: 'running', DONE: 'done', FAILED: 'failed', BLOCKED: 'blocked', NEEDS_REVIEW: 'needsReview' } as const
    for (const step of steps) summary[keys[step.status]]++
    return {
      name: sequence.name, version: sequence.version, thread_type: sequence.thread_type, steps,
      gates: sequence.gates.map(gate => ({
        id: gate.id, name: gate.name, status: gate.status, dependsOn: gate.depends_on,
        description: gate.description, acceptance_conditions: gate.acceptance_conditions,
        required_review: gate.required_review,
      })),
      summary,
    }
  }

  async reconcile(): Promise<RuntimeReconciliationReport> {
    const report = await this.deps.reconcile?.(this.basePath)
    if (report) return report
    return { checked: (await this.repositories.processes.list()).length, changes: [], errors: [] }
  }

  private async claimMutation(
    commandType: 'cancel-run' | 'cancel-attempt' | 'retry-attempt',
    targetId: string,
    context: RuntimeCommandContext,
    initialResultRef: string | null = targetId,
  ): Promise<{ receipt: RuntimeCommandReceipt; replayed: boolean }> {
    const id = this.deps.newId('command')
    const receipt: RuntimeCommandReceipt = {
      schema_version: 1, id, idempotency_key: context.idempotencyKey, command_type: commandType,
      request_hash: this.mutationRequestHash(commandType, targetId, context),
      status: 'accepted', result_ref: initialResultRef, error_code: null, error_message: null,
      created_at: this.deps.now(), completed_at: null,
    }
    try {
      const accepted = await this.repositories.commands.createOrReplay(receipt)
      return { receipt: accepted, replayed: accepted.id !== id }
    } catch (error) {
      if (error instanceof RuntimeRepositoryError && error.code === 'IDEMPOTENCY_CONFLICT') {
        throw new RuntimeServiceError('IDEMPOTENCY_CONFLICT', error.message, error)
      }
      throw error
    }
  }

  private mutationRequestHash(
    commandType: 'cancel-run' | 'cancel-attempt' | 'retry-attempt',
    targetId: string,
    context: RuntimeCommandContext,
  ): string {
    return stableRuntimeHash({
      commandType,
      targetId,
      actor: context.actor,
      interface: context.interface,
      policyConfirmed: context.policyConfirmed,
    })
  }

  private receiptError(receipt: RuntimeCommandReceipt): RuntimeServiceError {
    const parsed = RuntimeErrorCodeSchema.safeParse(receipt.error_code)
    return new RuntimeServiceError(parsed.success ? parsed.data : 'INTERNAL_ERROR', receipt.error_message ?? 'Runtime command failed')
  }

  private async replayAttemptMutation(receipt: RuntimeCommandReceipt): Promise<StepAttempt> {
    const inFlight = this.inFlightAttemptCancellations.get(receipt.id)
    if (inFlight) return await inFlight
    const current = receipt.status === 'accepted'
      ? await this.repositories.commands.get(receipt.id) ?? receipt
      : receipt
    if (current.status === 'accepted') {
      const target = current.result_ref ? await this.repositories.attempts.get(current.result_ref) : null
      if (target?.status === 'cancelled') {
        await this.repositories.commands.complete(current.id, {
          status: 'completed',
          resultRef: target.id,
        }, this.deps.now()).catch(() => undefined)
        return target
      }
      if (target && target.status !== 'running') {
        throw new RuntimeServiceError('ATTEMPT_NOT_RUNNING', `attempt ${target.id} is ${target.status}`)
      }
      throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'Runtime command was accepted but has no recoverable terminal evidence')
    }
    if (current.status === 'failed') throw this.receiptError(current)
    const attempt = current.result_ref ? await this.repositories.attempts.get(current.result_ref) : null
    if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', 'Runtime command result attempt was not found')
    return attempt
  }

  private retryBinding(originalAttemptId: string, childRunId: string): string {
    return `retry:${encodeURIComponent(originalAttemptId)}:run:${encodeURIComponent(childRunId)}`
  }

  private parseRetryBinding(value: string | null): { originalAttemptId: string; childRunId: string } | null {
    const match = /^retry:([^:]+):run:([^:]+)$/.exec(value ?? '')
    return match ? { originalAttemptId: decodeURIComponent(match[1]!), childRunId: decodeURIComponent(match[2]!) } : null
  }

  private parseUnboundRetry(value: string | null): string | null {
    const match = /^retry:([^:]+)$/.exec(value ?? '')
    return match ? decodeURIComponent(match[1]!) : null
  }

  private retryStartRequest(original: StepAttempt): StartRunRequest {
    return {
      sequence_id: original.sequence_id,
      target: { kind: 'step', step_id: original.step_id },
      strategy: 'sequential',
      max_concurrency: 1,
    }
  }

  private async repairRetryChildRun(
    binding: { originalAttemptId: string; childRunId: string },
    original: StepAttempt,
    context: RuntimeCommandContext,
    outerCommandId: string,
  ): Promise<WorkflowRun> {
    const request = this.retryStartRequest(original)
    const idempotencyKey = `retry-start:${outerCommandId}`
    let run = await this.repositories.runs.get(binding.childRunId)
    const startReceipt = await this.repositories.commands.findByIdempotencyKey(idempotencyKey)

    if (!run && !startReceipt) {
      return await this.startRunWithLineage(
        request,
        { ...context, idempotencyKey },
        original,
        binding.childRunId,
      )
    }

    if (!startReceipt) {
      throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'Retry child run is missing its start receipt')
    }
    if (startReceipt.status === 'failed') throw this.receiptError(startReceipt)
    if (startReceipt.result_ref !== binding.childRunId) {
      throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'Retry child start receipt is bound to a different run')
    }
    if (!run && startReceipt.status !== 'accepted') {
      throw new RuntimeServiceError('RUN_NOT_FOUND', `completed retry child run ${binding.childRunId} was not found`)
    }

    if (!run) {
      const now = this.deps.now()
      const candidate: WorkflowRun = {
        schema_version: 2,
        id: binding.childRunId,
        revision: 0,
        sequence_id: request.sequence_id,
        sequence_snapshot_hash: 'pending',
        target: request.target,
        strategy: 'sequential',
        status: 'pending',
        max_concurrency: 1,
        policy_snapshot_hash: 'pending',
        baseline_snapshot_id: null,
        attempt_ids: [],
        created_by: context.actor,
        created_via: context.interface,
        created_at: now,
        started_at: null,
        ended_at: null,
        cancellation_requested_at: null,
        summary: null,
        error_code: null,
        error_message: null,
      }
      try {
        await this.repositories.runs.create(candidate)
        run = candidate
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_RECORD_EXISTS') throw error
        run = await this.repositories.runs.get(binding.childRunId)
      }
    }
    if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `retry child run ${binding.childRunId} was not found`)

    if (run.status === 'pending' && run.attempt_ids.length === 0 && !this.scheduler.get(run.id)) {
      const recoveredRun = run
      const scheduled = this.scheduler.enqueue(recoveredRun.id, async () =>
        await this.executeRun(recoveredRun, request, { ...context, idempotencyKey }, startReceipt!.id, original))
      void scheduled.catch(() => undefined)
    }
    return run
  }

  private async replayRetryMutation(receipt: RuntimeCommandReceipt, context: RuntimeCommandContext): Promise<StepAttempt> {
    let current = receipt
    for (let poll = 0; current.status === 'accepted' && !this.parseRetryBinding(current.result_ref) && !this.parseUnboundRetry(current.result_ref) && poll < 50; poll++) {
      await new Promise(resolve => setTimeout(resolve, 20))
      current = await this.repositories.commands.get(current.id) ?? current
    }
    if (current.status === 'failed') throw this.receiptError(current)
    if (current.status === 'completed') {
      const attempt = current.result_ref ? await this.repositories.attempts.get(current.result_ref) : null
      if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', 'Retry result attempt was not found')
      return attempt
    }
    let binding = this.parseRetryBinding(current.result_ref)
    const unboundOriginal = this.parseUnboundRetry(current.result_ref)
    if (!binding && unboundOriginal) {
      const childRunId = this.deps.newId('run')
      const candidate = this.retryBinding(unboundOriginal, childRunId)
      try {
        current = await this.repositories.commands.bindResult(current.id, candidate, current.result_ref)
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') throw error
        current = await this.repositories.commands.get(current.id) ?? current
      }
      binding = this.parseRetryBinding(current.result_ref)
    }
    if (!binding) throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', 'Retry receipt has no recoverable child-run binding')
    const original = await this.repositories.attempts.get(binding.originalAttemptId)
    if (!original) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `attempt ${binding.originalAttemptId} was not found`)
    await this.repairRetryChildRun(binding, original, context, current.id)
    const retried = await this.waitForAttemptCreation(binding.childRunId)
    await this.repositories.commands.complete(current.id, { status: 'completed', resultRef: retried.id }, this.deps.now()).catch(() => undefined)
    return retried
  }

  private async replayRunCancellation(receipt: RuntimeCommandReceipt): Promise<WorkflowRun> {
    const inFlight = this.inFlightRunCancellations.get(receipt.id)
    if (inFlight) return await inFlight
    const current = receipt.status === 'accepted'
      ? await this.repositories.commands.get(receipt.id) ?? receipt
      : receipt
    if (current.status === 'failed') throw this.receiptError(current)
    const run = current.result_ref ? await this.repositories.runs.get(current.result_ref) : null
    if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', 'Cancellation result run was not found')
    if (run.status === 'cancelled') {
      if (current.status === 'accepted') {
        await this.repositories.commands.complete(current.id, {
          status: 'completed',
          resultRef: run.id,
        }, this.deps.now()).catch(() => undefined)
      }
      return run
    }
    const attempts = await this.repositories.attempts.listForRun(run.id)
    const active = attempts.some(attempt => ['pending', 'provisioning', 'running'].includes(attempt.status))
    throw new RuntimeServiceError(
      active ? 'PROCESS_CONTROL_FAILED' : 'ATTEMPT_NOT_RUNNING',
      active ? 'Run cancellation has no recoverable terminal evidence' : `run ${run.id} has no active attempt`,
    )
  }

  private async failAttemptMutation(
    commandId: string,
    code: 'ATTEMPT_NOT_FOUND' | 'ATTEMPT_NOT_RUNNING' | 'PROCESS_CONTROL_FAILED',
    message: string,
  ): Promise<never> {
    await this.repositories.commands.complete(commandId, { status: 'failed', errorCode: code, errorMessage: message }, this.deps.now())
    throw new RuntimeServiceError(code, message)
  }

  private async persistRunCancellationIntent(runId: string): Promise<WorkflowRun> {
    for (let attempt = 0; attempt < CONTROL_WINDOW_POLLS; attempt++) {
      const run = await this.repositories.runs.get(runId)
      if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
      if (run.cancellation_requested_at) return run
      try {
        return await this.repositories.runs.update(run.id, run.revision, current => ({
          ...current,
          cancellation_requested_at: this.deps.now(),
        }))
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') {
          throw error
        }
      }
    }
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_FAILED',
      `run ${runId} cancellation intent could not be persisted`,
    )
  }

  private async completeRunCancellation(runId: string): Promise<WorkflowRun> {
    for (let attempt = 0; attempt < CONTROL_WINDOW_POLLS; attempt++) {
      const run = await this.repositories.runs.get(runId)
      if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
      if (run.status === 'cancelled') return run
      if (terminalRunStatuses.has(run.status)) {
        throw new RuntimeServiceError(
          'PROCESS_CONTROL_FAILED',
          `run ${runId} ended as ${run.status} instead of cancelled`,
        )
      }
      try {
        return await transitionRun(this.repositories.runs, run, 'cancelled', {
          cancellation_requested_at: run.cancellation_requested_at ?? this.deps.now(),
          ended_at: this.deps.now(),
          error_code: null,
          error_message: null,
        })
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') {
          throw error
        }
      }
    }
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_FAILED',
      `run ${runId} could not persist cancelled state`,
    )
  }

  private async cancelAttemptForRun(attemptId: string): Promise<StepAttempt> {
    for (let poll = 0; poll < CONTROL_WINDOW_POLLS; poll++) {
      const attempt = await this.repositories.attempts.get(attemptId)
      if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
      if (!['pending', 'provisioning', 'running'].includes(attempt.status)) return attempt
      if (attempt.status === 'pending' || attempt.status === 'provisioning') {
        try {
          return await transitionAttempt(this.repositories.attempts, attempt, 'cancelled', {
            ended_at: this.deps.now(),
            error_code: null,
            error_message: null,
          })
        } catch (error) {
          if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') {
            throw error
          }
          continue
        }
      }
      if (!attempt.process_id) {
        await new Promise(resolve => setTimeout(resolve, CONTROL_POLL_INTERVAL_MS))
        continue
      }
      const process = await this.repositories.processes.get(attempt.process_id)
      if (!process) {
        await new Promise(resolve => setTimeout(resolve, CONTROL_POLL_INTERVAL_MS))
        continue
      }
      if (process.status === 'exited' || process.status === 'lost') {
        return await this.waitForCancelledAttempt(attempt.id)
      }
      if (
        (process.status === 'planned' || process.status === 'starting')
        && !this.processController.hasLiveHandle(attempt.process_id)
      ) {
        await new Promise(resolve => setTimeout(resolve, CONTROL_POLL_INTERVAL_MS))
        continue
      }
      const control = await this.processController.cancel(attempt.process_id)
      if (!control.success) {
        const latest = await this.repositories.processes.get(attempt.process_id)
        if (
          latest
          && (latest.status === 'planned' || latest.status === 'starting')
          && !this.processController.hasLiveHandle(attempt.process_id)
        ) {
          await new Promise(resolve => setTimeout(resolve, CONTROL_POLL_INTERVAL_MS))
          continue
        }
        throw new RuntimeServiceError(control.code, control.message)
      }
      return await this.waitForCancelledAttempt(attempt.id)
    }
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_FAILED',
      `attempt ${attemptId} did not become cancellable within the control window`,
    )
  }

  private async waitForCancelledAttempt(attemptId: string): Promise<StepAttempt> {
    let attempt = await this.repositories.attempts.get(attemptId)
    if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    const execution = this.inFlightAttempts.get(attempt.id)
    if (execution) await execution
    attempt = await this.repositories.attempts.get(attemptId)
    if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} was not found`)
    if (!['pending', 'provisioning', 'running'].includes(attempt.status)) return attempt
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_FAILED',
      `attempt ${attemptId} has no recoverable terminal cancellation evidence`,
    )
  }

  private async waitForCancelledRun(runId: string): Promise<WorkflowRun> {
    const execution = this.inFlight.get(runId) ?? this.scheduler.get<CompletedRunResult>(runId)
    if (execution) await execution
    const run = await this.repositories.runs.get(runId)
    if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
    if (run.status === 'cancelled') return run
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_FAILED',
      terminalRunStatuses.has(run.status)
        ? `run ${runId} ended as ${run.status} instead of cancelled`
        : `run ${runId} has no recoverable terminal cancellation evidence`,
    )
  }

  private async waitForAttemptCreation(runId: string): Promise<StepAttempt> {
    for (let poll = 0; poll < 250; poll++) {
      const run = await this.repositories.runs.get(runId)
      if (!run) throw new RuntimeServiceError('RUN_NOT_FOUND', `run ${runId} was not found`)
      const attemptId = run.attempt_ids[0]
      if (attemptId) {
        const attempt = await this.repositories.attempts.get(attemptId)
        if (attempt) return attempt
      }
      if (terminalRunStatuses.has(run.status)) {
        throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `retry run ${runId} ended before an attempt was created`)
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new RuntimeServiceError('PROCESS_CONTROL_FAILED', `run ${runId} did not create an attempt within the recovery window`)
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
      if (run && terminalRunStatuses.has(run.status) && receipt) {
        if (receipt.status === 'accepted') {
          const outcome = run.status === 'successful'
            ? { status: 'completed' as const, resultRef: run.id }
            : {
                status: 'failed' as const,
                errorCode: run.error_code ?? 'RUNTIME_EXECUTION_FAILED',
                errorMessage: run.error_message ?? `Run ended with status ${run.status}`,
              }
          // The terminal run is canonical authority. Repair the derived command receipt when possible,
          // but never poll forever if receipt persistence remains unavailable.
          await this.repositories.commands.complete(receipt.id, outcome, this.deps.now()).catch(() => undefined)
        }
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
    retryOf?: StepAttempt,
  ): Promise<CompletedRunResult> {
    let run = await this.repositories.runs.get(initialRun.id) ?? initialRun
    const attempts: StepAttempt[] = []
    try {
      if (run.status === 'cancelled' || run.cancellation_requested_at) {
        if (run.status !== 'cancelled') run = await this.completeRunCancellation(run.id)
        await this.repositories.commands.complete(commandId, {
          status: 'failed',
          errorCode: 'RUNTIME_EXECUTION_FAILED',
          errorMessage: 'Run was cancelled before execution',
        }, this.deps.now()).catch(() => undefined)
        return { run, attempts, replayed: false }
      }
      if (terminalRunStatuses.has(run.status)) {
        return {
          run,
          attempts: await this.repositories.attempts.listForRun(run.id),
          replayed: false,
        }
      }
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
      if (steps.length === 0) {
        if (!request.allow_empty) {
          const message = request.target.kind === 'step'
            ? `step ${request.target.step_id} was not found`
            : 'runtime target resolved to no runnable steps'
          throw new RuntimeServiceError('RUNTIME_TARGET_NOT_FOUND', message)
        }
        run = await transitionRun(this.repositories.runs, run, 'running', { started_at: this.deps.now() })
        run = await transitionRun(this.repositories.runs, run, 'successful', {
          ended_at: this.deps.now(), summary: '0 attempt(s)', error_code: null, error_message: null,
        })
        await this.deps.projections.finalizeRun({ run, attempts }).catch(() => undefined)
        await this.repositories.commands.complete(commandId, { status: 'completed', resultRef: run.id }, this.deps.now())
        return { run, attempts, replayed: false }
      }
      const batchPolicy = this.deps.enforceBatchPolicy({ policy, stepCount: steps.length, confirmed: context.policyConfirmed, basePath: this.basePath })
      if (!batchPolicy.allowed || (batchPolicy.confirmation_required && !context.policyConfirmed)) {
        throw new RuntimeServiceError(
          batchPolicy.confirmation_required ? 'POLICY_CONFIRMATION_REQUIRED' : 'POLICY_DENIED',
          batchPolicy.reason ?? 'Batch policy denied',
        )
      }

      const executor = new AttemptExecutor(
        this.basePath,
        this.repositories,
        this.deps,
        this.processController,
      )
      let executionIndex = 0
      for (const step of steps) {
        run = await this.repositories.runs.get(run.id) ?? run
        if (run.status === 'cancelled' || run.cancellation_requested_at) {
          if (run.status !== 'cancelled') run = await this.completeRunCancellation(run.id)
          break
        }
        if (terminalRunStatuses.has(run.status)) break
        executionIndex++
        const attemptId = this.deps.newId('attempt')
        const attempt: StepAttempt = {
          schema_version: 2, id: attemptId, revision: 0, workflow_run_id: run.id,
          sequence_id: run.sequence_id, step_id: step.id, surface_id: surfaceId(step), execution_index: executionIndex,
          attempt_number: retryOf?.step_id === step.id ? retryOf.attempt_number + 1 : 1,
          retry_of_attempt_id: retryOf?.step_id === step.id ? retryOf.id : null,
          status: 'pending', agent_ref: step.assigned_agent_id ?? null,
          model: step.model, side_effect_class: step.side_effect_class ?? 'execute', baseline_snapshot_id: null,
          workspace_id: null, process_id: null, compiled_prompt_hash: 'pending', input_manifest_ref: null,
          output_manifest_ref: null, artifact_manifest_ref: null, change_set_id: null, gate_decision_refs: [],
          created_at: this.deps.now(), started_at: null, ended_at: null, last_heartbeat_at: null,
          exit_code: null, signal: null, duration_ms: null, error_code: null, error_message: null,
        }
        await this.repositories.attempts.create(attempt)
        run = await this.repositories.runs.update(run.id, run.revision, value => ({ ...value, attempt_ids: [...value.attempt_ids, attemptId] }))
        await this.deps.projections.beginAttempt({ run, attempt, step }).catch(() => undefined)
        const execution = executor.execute({
          run,
          attempt,
          sequence,
          step,
          policy,
          context,
          targetRef: targetRef(request.target),
        })
        this.inFlightAttempts.set(attempt.id, execution)
        let outcome
        try {
          outcome = await execution
        } finally {
          if (this.inFlightAttempts.get(attempt.id) === execution) {
            this.inFlightAttempts.delete(attempt.id)
          }
        }
        run = outcome.run
        attempts.push(outcome.attempt)
        if (outcome.attempt.status === 'cancelled') {
          run = await this.completeRunCancellation(run.id)
          break
        }
      }

      run = await this.repositories.runs.get(run.id) ?? run
      if (run.status === 'cancelled') {
        await this.deps.projections.finalizeRun({ run, attempts }).catch(() => undefined)
        await this.repositories.commands.complete(commandId, {
          status: 'failed',
          errorCode: 'RUNTIME_EXECUTION_FAILED',
          errorMessage: 'Run was cancelled',
        }, this.deps.now()).catch(() => undefined)
        return { run, attempts, replayed: false }
      }
      const cancelled = attempts.some(attempt => attempt.status === 'cancelled')
      const successful = !cancelled && attempts.every(attempt => attempt.status === 'completed')
      const terminal = cancelled ? 'cancelled' : successful ? 'successful' : 'failed'
      run = await transitionRun(this.repositories.runs, run, terminal, {
        ended_at: this.deps.now(), summary: `${attempts.length} attempt(s)`,
        error_code: successful || cancelled ? null : 'RUN_ATTEMPT_FAILED',
        error_message: successful || cancelled ? null : 'One or more attempts did not complete',
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
