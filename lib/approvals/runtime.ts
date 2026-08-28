import { randomUUID } from 'crypto'
import { type Approval, type TraceEvent } from '@/lib/contracts/schemas'
import { assertRuntimeApprovalBinding } from '@/lib/approvals/binding'
import {
  appendApprovalLifecycle,
  appendConsumedApprovalLifecycle,
} from '@/lib/approvals/repository'
import { appendTraceEvent } from '@/lib/traces/writer'

interface RecordApprovedApprovalLifecycleInput {
  basePath: string
  runId: string
  actionType: Approval['action_type']
  targetRef: string
  requestedBy: string
  resolvedBy?: string | null
  actor: string
  notes?: string | null
  payloadRef?: string | null
  policyRef?: string | null
  approvalId?: string
  subjectDigest?: string | null
  preconditionHash?: string | null
  expiresAt?: string | null
}

interface RecordConsumedApprovalLifecycleInput extends RecordApprovedApprovalLifecycleInput {
  consumedBy: string
}

type ApprovalTraceAppender = typeof appendTraceEvent
const APPROVAL_TRACE_PERSIST_FAILED = 'APPROVAL_TRACE_PERSIST_FAILED' as const
const APPROVAL_TRACE_PERSIST_FAILED_MESSAGE = 'Approval committed, but approval trace projection persistence failed.'

export interface ApprovalCommitEvidence {
  commit_status: 'committed'
  trace_status: 'persisted' | 'failed'
  warning_code?: typeof APPROVAL_TRACE_PERSIST_FAILED
  warning?: string
}

export interface ApprovalLifecycleCommitResult extends ApprovalCommitEvidence {
  approval: Approval
}

let traceAppenderForTests: ApprovalTraceAppender | null = null

export function setApprovalTraceAppenderForTests(appender: ApprovalTraceAppender | null): void {
  traceAppenderForTests = appender
}

function getTraceAppender(): ApprovalTraceAppender {
  return traceAppenderForTests ?? appendTraceEvent
}

export async function appendApprovalTraceEvidence(input: {
  basePath: string
  runId: string
  events: TraceEvent[]
}): Promise<ApprovalCommitEvidence> {
  try {
    const traceAppender = getTraceAppender()
    for (const event of input.events) {
      await traceAppender(input.basePath, input.runId, event)
    }
    return {
      commit_status: 'committed',
      trace_status: 'persisted',
    }
  } catch (error) {
    console.error('[approvals] Trace persistence failed after approval commit', error)
    return {
      commit_status: 'committed',
      trace_status: 'failed',
      warning_code: APPROVAL_TRACE_PERSIST_FAILED,
      warning: APPROVAL_TRACE_PERSIST_FAILED_MESSAGE,
    }
  }
}

export async function recordApprovedApprovalLifecycle({
  basePath,
  runId,
  actionType,
  targetRef,
  requestedBy,
  resolvedBy,
  actor,
  notes = null,
  payloadRef = null,
  policyRef = null,
  approvalId = `apr-${randomUUID()}`,
  subjectDigest = null,
  preconditionHash = null,
  expiresAt = null,
}: RecordApprovedApprovalLifecycleInput): Promise<ApprovalLifecycleCommitResult> {
  const requestedAt = new Date().toISOString()
  const resolvedAt = new Date().toISOString()

  assertRuntimeApprovalBinding({
    actionType,
    subjectDigest,
    payloadRef,
    policyRef,
    preconditionHash,
    expiresAt,
  })

  const pendingApproval: Approval = {
    id: approvalId,
    action_type: actionType,
    target_ref: targetRef,
    requested_by: requestedBy,
    status: 'pending',
    approved_by: null,
    approved_at: null,
    notes: null,
    subject_digest: subjectDigest,
    payload_ref: payloadRef,
    policy_ref: policyRef,
    precondition_hash: preconditionHash,
    expires_at: expiresAt,
    consumed_at: null,
    consumed_by: null,
  }

  const approvedApproval: Approval = {
    ...pendingApproval,
    status: 'approved',
    approved_by: resolvedBy ?? requestedBy,
    approved_at: resolvedAt,
    notes,
  }

  const approval = await appendApprovalLifecycle(basePath, runId, pendingApproval, approvedApproval)
  const evidence = await appendApprovalTraceEvidence({
    basePath,
    runId,
    events: [
      {
        ts: requestedAt,
        run_id: runId,
        surface_id: targetRef,
        actor,
        event_type: 'approval-requested',
        payload_ref: pendingApproval.payload_ref ?? null,
        policy_ref: pendingApproval.policy_ref ?? null,
      },
      {
        ts: resolvedAt,
        run_id: runId,
        surface_id: targetRef,
        actor,
        event_type: 'approval-resolved',
        payload_ref: approvedApproval.payload_ref ?? null,
        policy_ref: approvedApproval.policy_ref ?? null,
      },
    ],
  })

  return {
    approval,
    ...evidence,
  }
}

export async function recordConsumedApprovalLifecycle({
  basePath,
  runId,
  actionType,
  targetRef,
  requestedBy,
  resolvedBy,
  consumedBy,
  actor,
  notes = null,
  payloadRef = null,
  policyRef = null,
  approvalId = `apr-${randomUUID()}`,
  subjectDigest = null,
  preconditionHash = null,
  expiresAt = null,
}: RecordConsumedApprovalLifecycleInput): Promise<ApprovalLifecycleCommitResult> {
  const requestedAt = new Date().toISOString()
  const resolvedAt = new Date().toISOString()
  const consumedAt = new Date().toISOString()

  assertRuntimeApprovalBinding({
    actionType,
    subjectDigest,
    payloadRef,
    policyRef,
    preconditionHash,
    expiresAt,
  })

  const pendingApproval: Approval = {
    id: approvalId,
    action_type: actionType,
    target_ref: targetRef,
    requested_by: requestedBy,
    status: 'pending',
    approved_by: null,
    approved_at: null,
    notes: null,
    subject_digest: subjectDigest,
    payload_ref: payloadRef,
    policy_ref: policyRef,
    precondition_hash: preconditionHash,
    expires_at: expiresAt,
    consumed_at: null,
    consumed_by: null,
  }

  const approvedApproval: Approval = {
    ...pendingApproval,
    status: 'approved',
    approved_by: resolvedBy ?? requestedBy,
    approved_at: resolvedAt,
    notes,
  }

  const consumedApproval: Approval = {
    ...approvedApproval,
    consumed_at: consumedAt,
    consumed_by: consumedBy,
  }

  const approval = await appendConsumedApprovalLifecycle(
    basePath,
    runId,
    pendingApproval,
    approvedApproval,
    consumedApproval,
  )
  const evidence = await appendApprovalTraceEvidence({
    basePath,
    runId,
    events: [
      {
        ts: requestedAt,
        run_id: runId,
        surface_id: targetRef,
        actor,
        event_type: 'approval-requested',
        payload_ref: pendingApproval.payload_ref ?? null,
        policy_ref: pendingApproval.policy_ref ?? null,
      },
      {
        ts: resolvedAt,
        run_id: runId,
        surface_id: targetRef,
        actor,
        event_type: 'approval-resolved',
        payload_ref: approvedApproval.payload_ref ?? null,
        policy_ref: approvedApproval.policy_ref ?? null,
      },
    ],
  })

  return {
    approval,
    ...evidence,
  }
}
