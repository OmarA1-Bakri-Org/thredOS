import { z } from 'zod'
import {
  ApprovalSchema,
  Sha256DigestSchema,
  type Approval,
} from '@/lib/contracts/schemas'

export type ApprovalBindingStatus = 'exact' | 'unbound'

export interface ApprovalBindingProjection {
  binding_status: ApprovalBindingStatus
  authoritative_for_execution: boolean
}

type ApprovalBindingFields = Pick<Approval, 'subject_digest' | 'payload_ref' | 'policy_ref'>

const RuntimeApprovalBindingSchema = z.object({
  actionType: ApprovalSchema.shape.action_type,
  subjectDigest: Sha256DigestSchema.nullable().optional(),
  payloadRef: z.string().min(1).nullable().optional(),
  policyRef: z.string().min(1).nullable().optional(),
  preconditionHash: Sha256DigestSchema.nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).superRefine((value, ctx) => {
  if (!isRuntimeAffectingApprovalAction(value.actionType)) return
  if (!value.subjectDigest || !value.payloadRef || !value.policyRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Runtime approvals require subject_digest, payload_ref, and policy_ref',
    })
  }
})

export function isRuntimeAffectingApprovalAction(
  actionType: Approval['action_type'],
): boolean {
  return actionType === 'run' || actionType === 'side_effect'
}

export function hasExactApprovalBinding(binding: ApprovalBindingFields): boolean {
  return Boolean(binding.subject_digest && binding.payload_ref && binding.policy_ref)
}

export function getApprovalBindingStatus(
  binding: ApprovalBindingFields,
): ApprovalBindingStatus {
  return hasExactApprovalBinding(binding) ? 'exact' : 'unbound'
}

export function hasValidRuntimeApprovalBinding(input: {
  actionType: Approval['action_type']
  subjectDigest?: string | null
  payloadRef?: string | null
  policyRef?: string | null
  preconditionHash?: string | null
  expiresAt?: string | null
}): boolean {
  return RuntimeApprovalBindingSchema.safeParse(input).success
}

export function isApprovalExpired(
  approval: Pick<Approval, 'expires_at'>,
  now = new Date(),
): boolean {
  return approval.expires_at != null && new Date(approval.expires_at).getTime() <= now.getTime()
}

export function assertRuntimeApprovalBinding(input: {
  actionType: Approval['action_type']
  subjectDigest?: string | null
  payloadRef?: string | null
  policyRef?: string | null
  preconditionHash?: string | null
  expiresAt?: string | null
}): void {
  RuntimeApprovalBindingSchema.parse(input)
}

export function classifyApprovalBinding(
  approval: Approval,
  now = new Date(),
): ApprovalBindingProjection {
  const binding_status = getApprovalBindingStatus(approval)
  const expired = isApprovalExpired(approval, now)
  const consumed = approval.consumed_at != null
  const authoritative_for_execution = binding_status === 'exact'
    && isRuntimeAffectingApprovalAction(approval.action_type)
    && approval.status === 'approved'
    && !expired
    && !consumed

  return {
    binding_status,
    authoritative_for_execution,
  }
}

export function projectApprovalForPublic<T extends Approval>(
  approval: T,
  now = new Date(),
): T & ApprovalBindingProjection {
  return {
    ...approval,
    ...classifyApprovalBinding(approval, now),
  }
}
