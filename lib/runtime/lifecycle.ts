import type { AttemptRepository } from './attempt-repository'
import { RuntimeServiceError } from './errors'
import type { ProcessRepository } from './process-repository'
import type { RunRepository } from './run-repository'
import type {
  ProcessRecord, ProcessStatus, StepAttempt, StepAttemptStatus, WorkflowRun, WorkflowRunStatus,
} from './schema'

const runTransitions: Record<WorkflowRunStatus, ReadonlySet<WorkflowRunStatus>> = {
  pending: new Set(['provisioning', 'failed', 'cancelled', 'interrupted']),
  provisioning: new Set(['running', 'failed', 'cancelled', 'interrupted']),
  running: new Set(['successful', 'awaiting_review', 'partially_successful', 'failed', 'cancelled', 'interrupted']),
  awaiting_review: new Set(), applying: new Set(), partially_successful: new Set(),
  successful: new Set(), failed: new Set(), cancelled: new Set(), interrupted: new Set(),
}
const attemptTransitions: Record<StepAttemptStatus, ReadonlySet<StepAttemptStatus>> = {
  pending: new Set(['provisioning', 'cancelled', 'interrupted']),
  provisioning: new Set(['running', 'failed', 'cancelled', 'timed_out', 'interrupted']),
  running: new Set(['completed', 'needs_review', 'failed', 'cancelled', 'timed_out', 'interrupted']),
  completed: new Set(), needs_review: new Set(), failed: new Set(), cancelled: new Set(), timed_out: new Set(), interrupted: new Set(),
}
const processTransitions: Record<ProcessStatus, ReadonlySet<ProcessStatus>> = {
  planned: new Set(['starting', 'lost']),
  starting: new Set(['running', 'exited', 'lost']),
  running: new Set(['terminating', 'exited', 'lost']),
  terminating: new Set(['exited', 'lost']), exited: new Set(), lost: new Set(),
}

function assertTransition<T extends string>(kind: string, current: T, next: T, allowed: Record<T, ReadonlySet<T>>): void {
  if (!allowed[current].has(next)) {
    throw new RuntimeServiceError('INVALID_RUNTIME_TRANSITION', `${kind} cannot transition from ${current} to ${next}`)
  }
}

export function assertRunTransition(current: WorkflowRunStatus, next: WorkflowRunStatus): void {
  assertTransition('run', current, next, runTransitions)
}
export function assertAttemptTransition(current: StepAttemptStatus, next: StepAttemptStatus): void {
  assertTransition('attempt', current, next, attemptTransitions)
}
export function assertProcessTransition(current: ProcessStatus, next: ProcessStatus): void {
  assertTransition('process', current, next, processTransitions)
}

type RunTransitionPatch = Partial<Pick<WorkflowRun,
  'sequence_snapshot_hash' | 'policy_snapshot_hash' | 'started_at' | 'ended_at' |
  'cancellation_requested_at' | 'summary' | 'error_code' | 'error_message'>>
type AttemptTransitionPatch = Partial<Pick<StepAttempt,
  'started_at' | 'ended_at' | 'last_heartbeat_at' | 'exit_code' | 'signal' | 'duration_ms' |
  'output_manifest_ref' | 'artifact_manifest_ref' | 'gate_decision_refs' | 'error_code' | 'error_message'>>
type ProcessTransitionPatch = Partial<Pick<ProcessRecord,
  'provider_handle' | 'pid' | 'started_at' | 'ended_at' | 'last_output_at' |
  'cancellation_requested_at' | 'exit_code' | 'signal'>>

export async function transitionRun(repo: RunRepository, current: WorkflowRun, status: WorkflowRunStatus, patch: RunTransitionPatch = {}): Promise<WorkflowRun> {
  assertRunTransition(current.status, status)
  return await repo.update(current.id, current.revision, value => ({ ...value, ...patch, status }))
}
export async function transitionAttempt(repo: AttemptRepository, current: StepAttempt, status: StepAttemptStatus, patch: AttemptTransitionPatch = {}): Promise<StepAttempt> {
  assertAttemptTransition(current.status, status)
  return await repo.update(current.id, current.revision, value => ({ ...value, ...patch, status }))
}
export async function transitionProcess(repo: ProcessRepository, current: ProcessRecord, status: ProcessStatus, patch: ProcessTransitionPatch = {}): Promise<ProcessRecord> {
  assertProcessTransition(current.status, status)
  return await repo.update(current.id, current.revision, value => ({ ...value, ...patch, status }))
}
