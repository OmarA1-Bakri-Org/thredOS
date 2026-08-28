import type { SurfaceWorkspace } from './schema'

export type WorkspaceOutcome =
  | 'successful'
  | 'failed'
  | 'needs_review'
  | 'interrupted'
  | 'cancelled_before_write'
  | 'applied'

export type WorkspaceRetentionDecision = {
  action: 'retain' | 'cleanup'
  reason:
    | 'explicit_retain'
    | 'awaiting_apply'
    | 'failure_evidence'
    | 'review_evidence'
    | 'interruption_evidence'
    | 'useful_cancelled_output'
    | 'cancelled_pristine'
    | 'success_applied'
    | 'success_policy'
}

export interface WorkspaceRetentionContext {
  outcome: WorkspaceOutcome
  hasUsefulOutput?: boolean
}

export function decideWorkspaceRetention(
  policy: SurfaceWorkspace['retention_policy'],
  context: WorkspaceRetentionContext,
): WorkspaceRetentionDecision {
  if (policy === 'retain_always') return { action: 'retain', reason: 'explicit_retain' }

  if (context.outcome === 'failed') return { action: 'retain', reason: 'failure_evidence' }
  if (context.outcome === 'needs_review') return { action: 'retain', reason: 'review_evidence' }
  if (context.outcome === 'interrupted') return { action: 'retain', reason: 'interruption_evidence' }

  if (context.outcome === 'cancelled_before_write') {
    return context.hasUsefulOutput === false
      ? { action: 'cleanup', reason: 'cancelled_pristine' }
      : { action: 'retain', reason: 'useful_cancelled_output' }
  }

  if (context.outcome === 'successful') {
    return { action: 'retain', reason: 'awaiting_apply' }
  }

  return policy === 'retain_on_failure' || policy === 'cleanup_on_success' || policy === 'retain_until_applied'
    ? { action: 'cleanup', reason: 'success_applied' }
    : { action: 'retain', reason: 'explicit_retain' }
}
