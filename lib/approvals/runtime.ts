import { randomUUID } from 'crypto'
import type { Approval } from '@/lib/contracts/schemas'
import { appendApproval } from '@/lib/approvals/repository'
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
}: RecordApprovedApprovalLifecycleInput): Promise<Approval> {
  const requestedAt = new Date().toISOString()
  const resolvedAt = new Date().toISOString()

  const pendingApproval: Approval = {
    id: approvalId,
    action_type: actionType,
    target_ref: targetRef,
    requested_by: requestedBy,
    status: 'pending',
    approved_by: null,
    approved_at: null,
    notes: null,
  }

  const approvedApproval: Approval = {
    ...pendingApproval,
    status: 'approved',
    approved_by: resolvedBy ?? requestedBy,
    approved_at: resolvedAt,
    notes,
  }

  await appendApproval(basePath, runId, pendingApproval)
  await appendTraceEvent(basePath, runId, {
    ts: requestedAt,
    run_id: runId,
    surface_id: targetRef,
    actor,
    event_type: 'approval-requested',
    payload_ref: payloadRef ?? approvalId,
    policy_ref: policyRef,
  })

  await appendApproval(basePath, runId, approvedApproval)
  await appendTraceEvent(basePath, runId, {
    ts: resolvedAt,
    run_id: runId,
    surface_id: targetRef,
    actor,
    event_type: 'approval-resolved',
    payload_ref: payloadRef ?? approvalId,
    policy_ref: policyRef,
  })

  return approvedApproval
}
