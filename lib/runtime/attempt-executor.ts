import { createHash } from 'crypto'
import type { ExecutablePayload, PolicyConfig } from '../policy/schema'
import type { Sequence, Step } from '../sequence/schema'
import { getRuntimeEventLogPath } from '../runner/artifacts'
import type { RunnerConfig } from '../runner/wrapper'
import { ProcessTimeoutError } from '../errors'
import { transitionAttempt, transitionProcess, transitionRun } from './lifecycle'
import type { RuntimeCommandContext, RuntimeRepositories, RuntimeServiceDependencies } from './service-types'
import type { ProcessRecord, StepAttempt, WorkflowRun } from './schema'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const EVENT_EMITTER = 'thread event'

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function payloadFrom(config: RunnerConfig, basePath: string): ExecutablePayload {
  return config.executablePayload ?? { command: config.command, args: config.args ?? [], cwd: config.cwd ?? basePath }
}

function redactedArgs(payload: ExecutablePayload): string[] {
  return payload.args.map(() => '[REDACTED]')
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
  ) {}

  async execute(input: ExecuteAttemptInput): Promise<ExecuteAttemptResult> {
    let { run, attempt } = input
    const { sequence, step, policy, context } = input
    const surfaceId = attempt.surface_id
    attempt = await transitionAttempt(this.repositories.attempts, attempt, 'provisioning')

    try {
      if (!await this.deps.validatePrompt(this.basePath, step.id)) {
        throw new Error(`Prompt file not found for step '${step.id}'`)
      }
      const compiledPrompt = await this.deps.compilePrompt({ basePath: this.basePath, sequence, step, runId: run.id })
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

      // dispatch may perform provider preflight and prompt-temp preparation, but runStep is the governed spawn boundary.
      const runnerConfig = await this.deps.dispatch(step.model, {
        stepId: step.id, runId: run.id, compiledPrompt, cwd: step.cwd || this.basePath,
        timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
        runtimeEventLogPath: getRuntimeEventLogPath(this.basePath, run.id, step.id),
        runtimeEventEmitterCommand: EVENT_EMITTER,
      })
      const payload = payloadFrom(runnerConfig, this.basePath)
      const executablePolicy = this.deps.enforceExecutablePolicy({
        payload, policy, confirmed: context.policyConfirmed, approvals,
        targetRefs: [`step:${step.id}`, input.targetRef], basePath: this.basePath,
      })
      if (!executablePolicy.allowed || (executablePolicy.confirmation_required && !context.policyConfirmed)) {
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: this.deps.now(), error_code: executablePolicy.confirmation_required ? 'POLICY_CONFIRMATION_REQUIRED' : 'POLICY_DENIED',
          error_message: executablePolicy.reason ?? 'Executable policy denied',
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }
      if (context.policyConfirmed && policy.mode === 'SAFE') {
        await this.deps.recordApproval({
          basePath: this.basePath, runId: run.id, context, targetRef: `step:${step.id}`,
          payload, policy, policySnapshotHash: run.policy_snapshot_hash,
        })
      }

      const processId = this.deps.newId('process')
      let processRecord: ProcessRecord = {
        schema_version: 1, id: processId, revision: 0, workflow_run_id: run.id, attempt_id: attempt.id,
        provider: 'local-process', provider_handle: null, pid: null, command: payload.command,
        redacted_args: redactedArgs(payload), cwd: payload.cwd, status: 'planned', launch_requested_at: this.deps.now(),
        started_at: null, ended_at: null, last_output_at: null, cancellation_requested_at: null, exit_code: null, signal: null,
      }
      await this.repositories.processes.create(processRecord)
      attempt = await this.repositories.attempts.update(attempt.id, attempt.revision, value => ({ ...value, process_id: processId }))
      processRecord = await transitionProcess(this.repositories.processes, processRecord, 'starting')
      if (run.status === 'provisioning') run = await transitionRun(this.repositories.runs, run, 'running', { started_at: this.deps.now() })
      attempt = await transitionAttempt(this.repositories.attempts, attempt, 'running', { started_at: this.deps.now() })
      await this.deps.appendTrace(this.basePath, run.id, {
        ts: this.deps.now(), run_id: run.id, surface_id: surfaceId, actor: context.actor,
        event_type: 'step-started', payload_ref: attempt.id, policy_ref: run.policy_snapshot_hash,
      })

      let result
      try {
        result = await this.deps.runStep(runnerConfig)
      } catch (error) {
        processRecord = await transitionProcess(this.repositories.processes, processRecord, 'lost', { ended_at: this.deps.now() })
        const timedOut = error instanceof ProcessTimeoutError
        attempt = await transitionAttempt(this.repositories.attempts, attempt, timedOut ? 'timed_out' : 'failed', {
          ended_at: this.deps.now(), error_code: timedOut ? error.code : 'PROCESS_LOST',
          error_message: error instanceof Error ? error.message : String(error),
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      if (result.exitCode == null) {
        processRecord = await transitionProcess(this.repositories.processes, processRecord, 'lost', {
          ended_at: result.endTime.toISOString(), last_output_at: result.endTime.toISOString(),
        })
        await this.deps.appendTrace(this.basePath, run.id, {
          ts: result.endTime.toISOString(), run_id: run.id, surface_id: surfaceId, actor: context.actor,
          event_type: 'step-failed', payload_ref: processRecord.id, policy_ref: run.policy_snapshot_hash,
        })
        attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
          ended_at: result.endTime.toISOString(), duration_ms: result.duration,
          error_code: 'PROCESS_LOST', error_message: result.stderr || 'Process returned no exit evidence',
        })
        await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
        return { run, attempt }
      }

      processRecord = await transitionProcess(this.repositories.processes, processRecord, 'exited', {
        started_at: result.startTime.toISOString(), ended_at: result.endTime.toISOString(),
        last_output_at: result.endTime.toISOString(), exit_code: result.exitCode,
      })
      await this.deps.saveArtifacts(this.basePath, result, { surfaceId, compiledPrompt, step })
      const artifactRef = `.threados/runs/${run.id}/surfaces/${surfaceId}/artifact.manifest.json`
      const completionGates = this.deps.evaluateCompletionGates({ step, result, artifactManifestPresent: true })
      await this.deps.persistGateDecisions(this.basePath, run.id, surfaceId, completionGates, run.policy_snapshot_hash)
      const completionPassed = completionGates.every(decision => decision.status === 'PASS')
      const runtimeEvents = await this.deps.readRuntimeEvents(this.basePath, run.id, step.id)
      const status = result.status === 'SUCCESS' ? (completionPassed ? 'completed' : 'needs_review') : 'failed'
      await this.deps.appendTrace(this.basePath, run.id, {
        ts: result.endTime.toISOString(), run_id: run.id, surface_id: surfaceId, actor: context.actor,
        event_type: status === 'completed' ? 'step-completed' : 'step-failed', payload_ref: artifactRef,
        policy_ref: run.policy_snapshot_hash,
      })
      attempt = await transitionAttempt(this.repositories.attempts, attempt, status, {
        ended_at: result.endTime.toISOString(), exit_code: result.exitCode, duration_ms: result.duration,
        artifact_manifest_ref: artifactRef,
        gate_decision_refs: [...new Set([...attempt.gate_decision_refs, ...completionGates.map(gate => gate.id)])],
        error_code: status === 'failed' ? 'PROCESS_EXIT_FAILED' : null,
        error_message: status === 'failed' ? result.stderr || `process exited ${result.exitCode}` : null,
      })
      await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents }).catch(() => undefined)
      return { run, attempt }
    } catch (error) {
      attempt = await transitionAttempt(this.repositories.attempts, attempt, 'failed', {
        ended_at: this.deps.now(), error_code: 'ATTEMPT_PREPARATION_FAILED',
        error_message: error instanceof Error ? error.message : String(error),
      })
      await this.deps.projections.finalizeAttempt({ run, attempt, step, runtimeEvents: [] }).catch(() => undefined)
      return { run, attempt }
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
