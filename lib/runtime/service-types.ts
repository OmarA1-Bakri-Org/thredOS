import type { Approval, GateDecision, TraceEvent } from '../contracts/schemas'
import type { PolicyConfig, PolicyResult, ExecutablePayload } from '../policy/schema'
import type { DispatchOptions } from '../runner/dispatch'
import type { RunnerConfig, RunResult } from '../runner/wrapper'
import type { RunningProcessHandle } from '../runner/process-handle'
import type { Sequence, Step } from '../sequence/schema'
import type { RuntimeDelegationEvent } from '../thread-surfaces/runtime-event-log'
import type { RevealState, SurfaceClass } from '../thread-surfaces/types'
import type { AttemptRepository } from './attempt-repository'
import type { CommandRepository } from './command-repository'
import type { ProcessRepository } from './process-repository'
import type { RunRepository } from './run-repository'
import type { RuntimeCommandContext } from './command-schema'
import type { StepAttempt, WorkflowRun } from './schema'
import type { ProcessRecord, StepAttemptStatus, WorkflowRunStatus } from './schema'
export interface StartRunRequest {
  sequence_id: string
  target: import('./schema').WorkflowRunTarget
  strategy: import('./schema').WorkflowRunStrategy
  max_concurrency: number
  /** Compatibility-only: legacy group/runnable requests historically succeed with no work. */
  allow_empty?: boolean
}
export { type RuntimeCommandContext }

export interface RuntimeRepositories {
  runs: RunRepository
  attempts: AttemptRepository
  processes: ProcessRepository
  commands: CommandRepository
}

export interface RuntimeProjectionPort {
  beginRun(input: { run: WorkflowRun; sequence: Sequence }): Promise<void>
  beginAttempt(input: { run: WorkflowRun; attempt: StepAttempt; step: Step }): Promise<void>
  finalizeAttempt(input: { run: WorkflowRun; attempt: StepAttempt; step: Step; runtimeEvents: RuntimeDelegationEvent[] }): Promise<void>
  finalizeRun(input: { run: WorkflowRun; attempts: StepAttempt[] }): Promise<void>
}

export interface RuntimeServiceDependencies {
  now(): string
  newId(prefix: 'run' | 'attempt' | 'process' | 'command'): string
  loadSequence(basePath: string): Promise<Sequence>
  loadPolicy(basePath: string): Promise<PolicyConfig>
  validateSequence(sequence: Sequence): void
  validatePrompt(basePath: string, stepId: string): Promise<boolean>
  compilePrompt(input: { basePath: string; sequence: Sequence; step: Step; runId: string }): Promise<string>
  prepareArtifacts?(input: { basePath: string; runId: string; surfaceId: string; step: Step; compiledPrompt: string; createdAt: string }): Promise<void>
  resolveGateSurface(input: { basePath: string; surfaceId: string; step: Step }): Promise<{ surfaceClass: SurfaceClass; revealState: RevealState }>
  allowModelExecution(input: { step: Step }): { allowed: boolean; errorCode?: string; reason?: string }
  dispatch(model: Step['model'], options: DispatchOptions): Promise<RunnerConfig>
  /** Canonical process launch boundary. Required for every service construction. */
  startProcess: (config: RunnerConfig) => Promise<RunningProcessHandle>
  /** @deprecated Test fixtures must bridge this explicitly with createTestCompatibilityStartProcess. */
  runStep?(config: RunnerConfig): Promise<RunResult>
  saveArtifacts(basePath: string, result: RunResult, input: { surfaceId: string; compiledPrompt: string; step: Step }): Promise<string>
  readRuntimeEvents(basePath: string, runId: string, stepId: string): Promise<RuntimeDelegationEvent[]>
  readApprovals(basePath: string, runId: string): Promise<Approval[]>
  /**
   * Compatibility-only optional hook. Production runtime wiring must provide
   * this when an exact approval can satisfy SAFE execution without an explicit
   * command-context confirmation.
   */
  consumeApproval?(input: {
    basePath: string
    runId: string
    approvalId: string
    targetRefs: string[]
    subjectDigest: string
    consumedAt: string
    consumedBy: string
  }): Promise<Approval>
  evaluatePreGates(input: { step: Step; sequence: Sequence; policy: PolicyConfig; approvalPresent: boolean; surfaceClass: SurfaceClass; revealState: RevealState }): GateDecision[]
  evaluateCompletionGates(input: { step: Step; result: RunResult; artifactManifestPresent: boolean }): GateDecision[]
  persistGateDecisions(basePath: string, runId: string, surfaceId: string, decisions: GateDecision[], policyRef: string): Promise<void>
  enforceBatchPolicy(input: { policy: PolicyConfig; stepCount: number; confirmed: boolean; basePath: string }): PolicyResult
  enforceExecutablePolicy(input: { payload: ExecutablePayload; policy: PolicyConfig; confirmed: boolean; approvals: Approval[]; targetRefs: string[]; basePath: string }): PolicyResult
  recordApproval(input: { basePath: string; runId: string; context: RuntimeCommandContext; targetRef: string; payload: ExecutablePayload; policy: PolicyConfig; policySnapshotHash: string }): Promise<void>
  appendTrace(basePath: string, runId: string, event: TraceEvent): Promise<void>
  reconcile?(
    basePath: string,
    context?: RuntimeReconciliationContext,
  ): Promise<RuntimeReconciliationReport | void>
  projections: RuntimeProjectionPort
}

export interface RunProjection {
  run: WorkflowRun
  attempts: StepAttempt[]
  source: 'v2' | 'legacy'
  schemaVersion: 2 | 1
}

export interface AttemptProjection {
  attempt: StepAttempt
  process: ProcessRecord | null
  source: 'v2' | 'legacy'
  schemaVersion: 2 | 1
}

export interface LatestAttemptQuery {
  sequenceId: string
  stepId: string
  statuses?: StepAttemptStatus[]
}

export interface RuntimeRunQuery {
  sequenceId?: string
  status?: WorkflowRunStatus
}

export interface RuntimeReconciliationReport {
  checked: number
  changes: Array<{ entityType: 'run' | 'attempt' | 'process' | 'legacy-step'; entityId: string; from: string; to: string; reason: string }>
  errors: string[]
}

export interface RuntimeReconciliationContext {
  /**
   * Identifies process records whose live handle is still owned by the current
   * service instance. Startup recovery omits this callback.
   */
  isProcessManaged?(processId: string, runId: string, attemptId: string): boolean
  isAttemptManaged?(attemptId: string, runId: string): boolean
  isRunManaged?(runId: string): boolean
}

export interface SequenceStatusProjection {
  name: string
  version: string
  thread_type?: string
  steps: Array<{
    id: string
    name: string
    type: Step['type']
    status: Step['status']
    model: string
    dependsOn: string[]
    processIndex?: number
    processId?: string
    groupId?: string
    fusionCandidates?: boolean
    fusionSynth?: boolean
  }>
  gates: Array<{
    id: string
    name: string
    status: Sequence['gates'][number]['status']
    dependsOn: string[]
    description?: string
    acceptance_conditions?: string[]
    required_review?: boolean
  }>
  summary: {
    total: number
    ready: number
    running: number
    done: number
    failed: number
    blocked: number
    needsReview: number
  }
}

export interface RuntimeServiceOptions {
  basePath: string
  scheduler: import('./scheduler').SequentialScheduler
  repositories: RuntimeRepositories
  dependencies: RuntimeServiceDependencies
}

export interface CompletedRunResult {
  run: WorkflowRun
  attempts: StepAttempt[]
  replayed: boolean
}
