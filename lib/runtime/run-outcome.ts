import type { RuntimeErrorCode } from './error-codes'
import { RuntimeServiceError } from './errors'
import type { StepAttempt, WorkflowRunStatus } from './schema'

type DerivedRunErrorCode = Extract<
  RuntimeErrorCode,
  'RUN_ATTEMPT_FAILED' | 'RUN_PARTIALLY_SUCCESSFUL' | 'RUN_REVIEW_REQUIRED' | 'RUN_INTERRUPTED'
>

type NonSuccessfulTerminalOutcome =
  | {
      status: 'awaiting_review'
      errorCode: Extract<DerivedRunErrorCode, 'RUN_REVIEW_REQUIRED'>
      errorMessage: 'One or more attempts require review'
    }
  | {
      status: 'partially_successful'
      errorCode: Extract<DerivedRunErrorCode, 'RUN_PARTIALLY_SUCCESSFUL'>
      errorMessage: 'Run completed with mixed attempt outcomes'
    }
  | {
      status: 'failed'
      errorCode: Extract<DerivedRunErrorCode, 'RUN_ATTEMPT_FAILED'>
      errorMessage: 'One or more attempts failed or timed out'
    }
  | {
      status: 'interrupted'
      errorCode: Extract<DerivedRunErrorCode, 'RUN_INTERRUPTED'>
      errorMessage: 'Run was interrupted before any attempt completed'
    }

export type DerivedTerminalRunOutcome =
  | { status: Extract<WorkflowRunStatus, 'successful'>; errorCode: null; errorMessage: null }
  | NonSuccessfulTerminalOutcome

function invalidOutcomeInput(message: string): never {
  throw new RuntimeServiceError('VALIDATION_ERROR', message)
}

export function deriveTerminalRunOutcome(
  attempts: ReadonlyArray<Pick<StepAttempt, 'status'>>,
): DerivedTerminalRunOutcome {
  if (attempts.length === 0) {
    invalidOutcomeInput('Cannot derive a terminal run outcome without attempt results')
  }
  if (attempts.some(attempt => attempt.status === 'cancelled')) {
    invalidOutcomeInput('Cancelled attempts must be resolved by the run cancellation owner before deriving terminal status')
  }
  const nonterminal = attempts
    .map(attempt => attempt.status)
    .filter(status => status === 'pending' || status === 'provisioning' || status === 'running')
  if (nonterminal.length > 0) {
    invalidOutcomeInput(`Cannot derive a terminal run outcome from nonterminal attempt statuses: ${nonterminal.join(', ')}`)
  }

  const statuses = new Set(attempts.map(attempt => attempt.status))
  const hasCompleted = statuses.has('completed')
  const hasNeedsReview = statuses.has('needs_review')
  const hasHardFailure = statuses.has('failed') || statuses.has('timed_out')
  const hasInterrupted = statuses.has('interrupted')

  if (hasCompleted || hasNeedsReview) {
    if (hasHardFailure || hasInterrupted) {
      return {
        status: 'partially_successful',
        errorCode: 'RUN_PARTIALLY_SUCCESSFUL',
        errorMessage: 'Run completed with mixed attempt outcomes',
      }
    }
    if (hasNeedsReview) {
      return {
        status: 'awaiting_review',
        errorCode: 'RUN_REVIEW_REQUIRED',
        errorMessage: 'One or more attempts require review',
      }
    }
    return { status: 'successful', errorCode: null, errorMessage: null }
  }

  if (hasHardFailure) {
    return {
      status: 'failed',
      errorCode: 'RUN_ATTEMPT_FAILED',
      errorMessage: 'One or more attempts failed or timed out',
    }
  }

  if (hasInterrupted) {
    return {
      status: 'interrupted',
      errorCode: 'RUN_INTERRUPTED',
      errorMessage: 'Run was interrupted before any attempt completed',
    }
  }

  invalidOutcomeInput(`Cannot derive a terminal run outcome from unsupported attempt statuses: ${attempts.map(attempt => attempt.status).join(', ')}`)
}
