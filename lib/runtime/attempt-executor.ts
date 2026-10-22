import { RuntimeServiceError } from './errors'
import { agentRegistrationEvidence, resolveStepAgent, readRegisteredPrompt } from '../agents/execution'
import { createHash } from 'crypto'
import { ApprovalConsumptionError } from '../approvals/repository'
import { approvalMatchesExecutableSubject, executableSubjectDigest } from '../policy/executable'
import type { ExecutablePayload, PolicyConfig } from '../policy/schema'
import type { Sequence, Step } from '../sequence/schema'
import { getRuntimeEventLogPath } from '../runner/artifacts'
import type { RawProcessResult } from '../runner/process-handle'
import { ProcessControlError } from '../runner/process-handle'
import type { RunnerConfig, RunResult } from '../runner/wrapper'
import { transitionAttempt, transitionRun } from './lifecycle'
import type { ProcessController } from './process-controller'
import { RuntimeErrorCode } from './error-codes'
import { RuntimeRepositoryError } from './run-repository'
import type { RuntimeCommandContext, RuntimeRepositories, RuntimeServiceDependencies } from './service-types'
import type { StepAttempt, WorkflowRun } from './schema'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const EVENT_EMITTER = 'thread event'

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function payloadFrom(config: RunnerConfig, basePath: string): ExecutablePayload {
  return config.executablePayload ?? { command: config.command, args: config.args ?? [], cwd: config.cwd ?? basePath }
}

function compatibilityResult(result: RawProcessResult): RunResult {
  const { signal: _signal, status, ...compatible } = result
  return {
    ...compatible,
    status: status === 'CANCELLED' ? 'ERROR' : status,
  }
}

export interface ExecuteAttemptInput {
  run: WorkflowRun
  attempt: StepAttempt
  sequence: Sequence
  step: Step
  policy: PolicyConfig
  context: RuntimeCommandContext
  targetRef: string
}

export interface ExecuteAttemptResult {
  run: WorkflowRun
  attempt: StepAttempt
}

export class AttemptExecutor {
  constructor(
    private readonly basePath: string,
    private readonly repositories: RuntimeRepositories,
    private readonly deps: RuntimeServiceDependencies,
    private readonly processController: ProcessController,
  ) {}

  async execute(input: ExecuteAttemptInput): Promise<ExecuteAttemptResult> {
    let { run, attempt } = input
    const { sequence, step, policy, context } = input
    const surfaceId = attempt.surface_id
    const cancelledBeforeProvisioning = await this.observeRunCancellation(run.id, attempt.id)
    if (cancelledBeforeProvisioning) return cancelledBeforeProvisioning
    attempt = await transitionAttempt(this.repositories.attempts, attempt, 'provisioning')

    try {
      if (!attempt.agent_registration) {
        throw new RuntimeServiceError('AGENT_REGISTRATION_REQUIRED', 'Attempt has no frozen registered identity')
      }
      await resolveStepAgent(this.basePath, step, attempt.agent_registration)
      const rawPrompt = await readRegisteredPrompt(this.basePath, attempt.agent_registration)
      const compiledPrompt = await this.deps.compilePrompt({ basePath: this.basePath, sequence, step, runId: run.id,
        agentRegistration: attempt.agent_registration, rawPrompt })
      const compiledHash = hash(compiledPrompt)
      attempt = await this.repositories.attempts.update(attempt.id, attempt.revision, value => ({
        ...value,
        compiled_prompt_hash: compiledHash,
      }))
      if (!this.deps.prepareArtifacts) throw new Error('Runtime artifact preparation is unavailable')
      await this.deps.prepareArtifacts({
        basePath: this.basePath, runId: run.id, surfaceId, step, compiledPrompt, createdAt: this.deps.now(),
      })
      attempt = await this.repositories.attempts.update(attempt.id, attempt.revision, value => ({
        ...value,
        input_manifest_ref: `.threados/runs/${run.id}/surfaces/${surfaceId}/input.manifest.json`,
      }))

      const approvals = await this.deps.readApprovals(this.basePath, run.id)
      const approvalPresent = context.policyConfirmed || approvals.some(approval =>
        approval.status === 'approved' && (approval.target_ref === `step:${step.id}` || approval.target_ref === input.targetRef))
      const gateSurface = await this.deps.resolveGateSurface({ basePath: this.basePath, surfaceId, step })
      const preGates = this.deps.evaluatePreGates({ step, sequence, policy, approvalPresent, ...gateSurface })
      await this.deps.persistGateDecisions(this.basePath, run.id, surfaceId, preGates, run.policy_snapshot_hash)
      if (preGates.length > 0) {
        attempt = await this.repositories.attempts.update(attempt.id, attempt.revision, value => ({
          ...value, gate_decision_refs: [...new Set([...value.gate_decision_refs, ...preGates.map(gate => gate.id)])],
        }))
      }
      for (const decision of preGates) {
        await this.deps.appendTrace(this.basePath, run.id, {
          attempt_id: attempt.id,
          agent_registration: attempt.agent_registration ? agentRegistrationEvidence(attempt.agent_registration) : undefined,
          ts: decision.decided_at, run_id: run.id, surface_id: surfaceId, actor: context.actor,
          event_type: decision.status === 'PASS' ? 'gate-evaluated' : 'gate-blocked', payload_ref: decision.id,
          policy_ref: run.policy_snapshot_hash,
        })
      }
      if (preGates.some(decision => decision.status !== 'PASS')) {
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: this.deps.now(), error_code: 'PRE_RUN_GATE_BLOCKED',
          error_message: preGates.flatMap(decision => decision.reason_codes).join(', '),
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      const modelExecution = this.deps.allowModelExecution({ step })
      if (!modelExecution.allowed) {
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: this.deps.now(), error_code: modelExecution.errorCode ?? 'MODEL_EXECUTION_DISABLED',
          error_message: modelExecution.reason ?? `Execution is disabled for model ${step.model}`,
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      // Dispatch may perform provider preflight and prompt-temp preparation; ProcessController is the spawn boundary.
      const runnerConfig = await this.deps.dispatch(step.model, {
        stepId: step.id, runId: run.id, compiledPrompt, cwd: step.cwd || this.basePath,
        timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
        runtimeEventLogPath: getRuntimeEventLogPath(this.basePath, run.id, step.id),
        runtimeEventEmitterCommand: EVENT_EMITTER,
      })
      const payload = payloadFrom(runnerConfig, this.basePath)
      const targetRefs = [`step:${step.id}`, input.targetRef]
      const subjectDigest = executableSubjectDigest(payload, this.basePath, policy)
      const exactApproval = approvals.find(approval =>
        approvalMatchesExecutableSubject(approval, targetRefs, subjectDigest))
      const executablePolicy = this.deps.enforceExecutablePolicy({
        payload, policy, confirmed: context.policyConfirmed, approvals,
        targetRefs, basePath: this.basePath,
      })
      if (!executablePolicy.allowed || (executablePolicy.confirmation_required && !context.policyConfirmed)) {
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: this.deps.now(), error_code: executablePolicy.confirmation_required ? 'POLICY_CONFIRMATION_REQUIRED' : 'POLICY_DENIED',
          error_message: executablePolicy.reason ?? 'Executable policy denied',
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }
      if (!context.policyConfirmed && policy.mode === 'SAFE' && exactApproval) {
        if (!this.deps.consumeApproval) {
          attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
            ended_at: this.deps.now(),
            error_code: RuntimeErrorCode.APPROVAL_CONSUMPTION_FAILED,
            error_message: 'Exact approval consumption is unavailable',
          })
          await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
          return { run, attempt }
        }
        try {
          await this.deps.consumeApproval({
            basePath: this.basePath,
            runId: run.id,
            approvalId: exactApproval.id,
            targetRefs,
            subjectDigest,
            consumedAt: this.deps.now(),
            consumedBy: `runtime:${context.interface}`,
          })
        } catch (error) {
          attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
            ended_at: this.deps.now(),
            error_code: RuntimeErrorCode.APPROVAL_CONSUMPTION_FAILED,
            error_message: error instanceof Error ? error.message : String(error),
          })
          await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
          return { run, attempt }
        }
      }
      if (context.policyConfirmed && policy.mode === 'SAFE' && !exactApproval) {
        try {
          await this.deps.recordApproval({
            basePath: this.basePath, runId: run.id, context, targetRef: `step:${step.id}`,
            payload, policy, policySnapshotHash: run.policy_snapshot_hash,
          })
        } catch (error) {
          attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
            ended_at: this.deps.now(),
            error_code: RuntimeErrorCode.APPROVAL_CONSUMPTION_FAILED,
            error_message: error instanceof Error ? error.message : String(error),
          })
          await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
          return { run, attempt }
        }
      }

      const cancelledBeforeProcess = await this.observeRunCancellation(run.id, attempt.id)
      if (cancelledBeforeProcess) return cancelledBeforeProcess
      run = await this.repositories.runs.get(run.id) ?? run
      attempt = await this.repositories.attempts.get(attempt.id) ?? attempt
      const processId = this.deps.newId('process')
      attempt = await this.repositories.attempts.update(attempt.id, attempt.revision, value => ({ ...value, process_id: processId }))
      const cancelledAfterProcessBinding = await this.observeRunCancellation(run.id, attempt.id)
      if (cancelledAfterProcessBinding) return cancelledAfterProcessBinding
      run = await this.repositories.runs.get(run.id) ?? run
      attempt = await this.repositories.attempts.get(attempt.id) ?? attempt
      if (run.status === 'provisioning') run = await transitionRun(this.repositories.runs, run, 'running', { started_at: this.deps.now() })
      attempt = await transitionAttempt(this.repositories.attempts, attempt, 'running', { started_at: this.deps.now() })
      const cancelledBeforeSpawn = await this.observeRunCancellation(run.id, attempt.id)
      if (cancelledBeforeSpawn) return cancelledBeforeSpawn
      run = await this.repositories.runs.get(run.id) ?? run
      attempt = await this.repositories.attempts.get(attempt.id) ?? attempt
      await this.deps.appendTrace(this.basePath, run.id, {
          attempt_id: attempt.id,
          agent_registration: attempt.agent_registration ? agentRegistrationEvidence(attempt.agent_registration) : undefined,
        ts: this.deps.now(), run_id: run.id, surface_id: surfaceId, actor: context.actor,
        event_type: 'step-started', payload_ref: attempt.id, policy_ref: run.policy_snapshot_hash,
      })
      run = await this.repositories.runs.get(run.id) ?? run
      attempt = await this.repositories.attempts.get(attempt.id) ?? attempt
      const cancelledAtLaunch = await this.observeRunCancellation(run.id, attempt.id)
      if (cancelledAtLaunch) return cancelledAtLaunch

      // Recheck membership and versioned assets after provider/approval waits, immediately before launch.
      await resolveStepAgent(this.basePath, step, attempt.agent_registration!)
      let controlled
      try {
        controlled = await this.processController.start({
          processId,
          workflowRunId: run.id,
          attemptId: attempt.id,
          runnerConfig,
        })
      } catch (error) {
        if (this.processController.hasLiveHandle(processId)) {
          return await this.waitForControlledTerminal(run.id, attempt.id, processId, step)
        }
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: this.deps.now(), error_code: 'PROCESS_LOST',
          error_message: error instanceof Error ? error.message : String(error),
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      const completion = await controlled.completion
      const result = completion.result
      if (!result && completion.error instanceof ProcessControlError) {
        return await this.waitForControlledTerminal(run.id, attempt.id, processId, step)
      }
      if (!result || completion.process.status !== 'exited') {
        const endedAt = completion.process.ended_at ?? this.deps.now()
        await this.deps.appendTrace(this.basePath, run.id, {
          attempt_id: attempt.id,
          agent_registration: attempt.agent_registration ? agentRegistrationEvidence(attempt.agent_registration) : undefined,
          ts: endedAt, run_id: run.id, surface_id: surfaceId, actor: context.actor,
          event_type: 'step-failed', payload_ref: processId, policy_ref: run.policy_snapshot_hash,
        })
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: endedAt,
          error_code: 'PROCESS_LOST',
          error_message: completion.error?.message ?? 'Process returned no verified terminal result',
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      let artifactRef: string | null = null
      let completionGates: ReturnType<RuntimeServiceDependencies['evaluateCompletionGates']> = []
      const compatible = compatibilityResult(result)
      await this.deps.saveArtifacts(this.basePath, compatible, { surfaceId, compiledPrompt, step })
      artifactRef = `.threados/runs/${run.id}/surfaces/${surfaceId}/artifact.manifest.json`
      if (result.exitCode !== null) {
        completionGates = this.deps.evaluateCompletionGates({
          step,
          result: compatible,
          artifactManifestPresent: true,
        })
        await this.deps.persistGateDecisions(this.basePath, run.id, surfaceId, completionGates, run.policy_snapshot_hash)
        for (const decision of completionGates) {
          await this.deps.appendTrace(this.basePath, run.id, {
          attempt_id: attempt.id,
          agent_registration: attempt.agent_registration ? agentRegistrationEvidence(attempt.agent_registration) : undefined,
            ts: decision.decided_at, run_id: run.id, surface_id: surfaceId, actor: context.actor,
            event_type: decision.status === 'PASS' ? 'gate-evaluated' : 'gate-blocked', payload_ref: decision.id,
            policy_ref: run.policy_snapshot_hash,
          })
        }
      }
      const completionPassed = completionGates.every(decision => decision.status === 'PASS')
      const runtimeEvents = await this.deps.readRuntimeEvents(this.basePath, run.id, step.id)
      const status = result.exitCode === 42
        ? 'needs_review'
        : result.status === 'TIMEOUT'
        ? 'timed_out'
        : result.status === 'CANCELLED'
          ? 'cancelled'
          : result.status === 'SUCCESS' && result.exitCode === 0
            ? (completionPassed ? 'completed' : 'needs_review')
            : 'failed'
      await this.deps.appendTrace(this.basePath, run.id, {
          attempt_id: attempt.id,
          agent_registration: attempt.agent_registration ? agentRegistrationEvidence(attempt.agent_registration) : undefined,
        ts: result.endTime.toISOString(), run_id: run.id, surface_id: surfaceId, actor: context.actor,
        event_type: status === 'completed' ? 'step-completed' : 'step-failed',
        payload_ref: artifactRef ?? processId,
        policy_ref: run.policy_snapshot_hash,
      })
      attempt = await transitionAttempt(this.repositories.attempts, attempt, status, {
        ended_at: result.endTime.toISOString(), exit_code: result.exitCode, duration_ms: result.duration,
        signal: result.signal,
        artifact_manifest_ref: artifactRef,
        gate_decision_refs: [...new Set([...attempt.gate_decision_refs, ...completionGates.map(gate => gate.id)])],
        error_code: status === 'failed' ? 'PROCESS_EXIT_FAILED' : null,
        error_message: status === 'failed'
          ? result.stderr || `process ${result.status.toLowerCase()} with exit ${result.exitCode ?? 'unknown'}`
          : null,
      })
      await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents }).catch(() => undefined)
      return { run, attempt }
    } catch (error) {
      const cancellation = await this.observeRunCancellation(run.id, attempt.id)
      if (cancellation) return cancellation
      run = await this.repositories.runs.get(run.id) ?? run
      attempt = await this.repositories.attempts.get(attempt.id) ?? attempt
      attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
        ended_at: this.deps.now(),
        error_code: error instanceof ApprovalConsumptionError
          ? RuntimeErrorCode.APPROVAL_CONSUMPTION_FAILED
          : error instanceof RuntimeServiceError ? error.code : 'ATTEMPT_PREPARATION_FAILED',
        error_message: error instanceof Error ? error.message : String(error),
      })
      await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
      return { run, attempt }
    }
  }

  private async observeRunCancellation(
    runId: string,
    attemptId: string,
  ): Promise<ExecuteAttemptResult | null> {
    for (let retry = 0; retry < 250; retry++) {
      const [run, attempt] = await Promise.all([
        this.repositories.runs.get(runId),
        this.repositories.attempts.get(attemptId),
      ])
      if (!run || !attempt) return null
      const cancellationRequested = run.status === 'cancelled'
        || run.cancellation_requested_at !== null
      if (!cancellationRequested) return null
      if (!['pending', 'provisioning', 'running'].includes(attempt.status)) {
        return { run, attempt }
      }
      try {
        const cancelled = await transitionAttempt(
          this.repositories.attempts,
          attempt,
          'cancelled',
          {
            ended_at: this.deps.now(),
            error_code: null,
            error_message: null,
          },
        )
        return { run, attempt: cancelled }
      } catch (error) {
        if (!(error instanceof RuntimeRepositoryError) || error.code !== 'RUNTIME_REVISION_CONFLICT') {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 2))
      }
    }
    throw new Error(`attempt ${attemptId} could not observe persisted run cancellation`)
  }

  private async waitForControlledTerminal(
    runId: string,
    attemptId: string,
    processId: string,
    step: Step,
  ): Promise<ExecuteAttemptResult> {
    while (true) {
      const process = await this.repositories.processes.get(processId)
      if (process?.status === 'exited' || process?.status === 'lost') {
        const [run, attempt] = await Promise.all([
          this.repositories.runs.get(runId),
          this.repositories.attempts.get(attemptId),
        ])
        if (!run || !attempt) {
          throw new Error(`terminal process ${processId} lost its run or attempt`)
        }
        if (!['pending', 'provisioning', 'running'].includes(attempt.status)) {
          return { run, attempt }
        }
        const cancellationRequested = process.cancellation_requested_at !== null
          || run.cancellation_requested_at !== null
        const cancelled = process.status === 'exited' && cancellationRequested
        const terminalAttempt = await transitionAttempt(
          this.repositories.attempts,
          attempt,
          cancelled ? 'cancelled' : 'failed',
          {
            ended_at: process.ended_at ?? this.deps.now(),
            exit_code: process.exit_code,
            signal: process.signal,
            error_code: cancelled ? null : 'PROCESS_LOST',
            error_message: cancelled
              ? null
              : 'Process control failed and no verified execution result was recovered',
          },
        )
        await this.deps.projections.finalizeAttempt({
          run,
          attempt: terminalAttempt,
          step,
          runtimeEvents: [],
        }).catch(() => undefined)
        return { run, attempt: terminalAttempt }
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}

export function stableRuntimeHash(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize)
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]))
    }
    return input
  }
  return hash(JSON.stringify(canonicalize(value)))
}
