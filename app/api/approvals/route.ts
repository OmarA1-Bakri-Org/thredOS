import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import {
  hasExactApprovalBinding,
  hasValidRuntimeApprovalBinding,
  isApprovalExpired,
  projectApprovalForPublic,
} from '@/lib/approvals/binding'
import { appendApprovalTraceEvidence } from '@/lib/approvals/runtime'
import {
  ApprovalResolutionError,
  appendApproval,
  readApprovals,
  resolvePendingApproval,
} from '@/lib/approvals/repository'
import { getBasePath } from '@/lib/config'
import { handleError, jsonError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'
import { assertSafePathSegment } from '@/lib/security/safe-path'

function isSafeRunId(runId: string): boolean {
  try {
    assertSafePathSegment(runId, 'runId')
    return true
  } catch {
    return false
  }
}

function foldApprovals(entries: Approval[]): Approval[] {
  const indexById = new Map<string, number>()
  const folded: Approval[] = []

  for (const entry of entries) {
    const existingIndex = indexById.get(entry.id)
    if (existingIndex == null) {
      indexById.set(entry.id, folded.length)
      folded.push(entry)
      continue
    }
    folded[existingIndex] = {
      ...folded[existingIndex],
      ...entry,
    }
  }

  return folded
}

const FileSafeRunIdSchema = z.string().min(1).refine(isSafeRunId, {
  message: 'runId must be a file-safe identifier',
})

const RequestApprovalMutationSchema = z.object({
  action: z.literal('request'),
  runId: FileSafeRunIdSchema,
  action_type: ApprovalSchema.shape.action_type.default('run'),
  target_ref: z.string().min(1),
  requested_by: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  subject_digest: ApprovalSchema.shape.subject_digest.optional(),
  payload_ref: ApprovalSchema.shape.payload_ref.optional(),
  policy_ref: ApprovalSchema.shape.policy_ref.optional(),
  precondition_hash: ApprovalSchema.shape.precondition_hash.optional(),
  expires_at: ApprovalSchema.shape.expires_at.optional(),
})

const ResolveApprovalMutationSchema = z.object({
  action: z.literal('resolve'),
  runId: FileSafeRunIdSchema,
  approval_id: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
  notes: z.string().nullable().optional(),
  action_type: ApprovalSchema.shape.action_type.optional(),
  target_ref: z.string().min(1).optional(),
  requested_by: z.string().min(1).optional(),
  approved_by: z.string().nullable().optional(),
  subject_digest: ApprovalSchema.shape.subject_digest.optional(),
  payload_ref: ApprovalSchema.shape.payload_ref.optional(),
  policy_ref: ApprovalSchema.shape.policy_ref.optional(),
  precondition_hash: ApprovalSchema.shape.precondition_hash.optional(),
  expires_at: ApprovalSchema.shape.expires_at.optional(),
})

const ApprovalMutationSchema = z.discriminatedUnion('action', [
  RequestApprovalMutationSchema,
  ResolveApprovalMutationSchema,
])

function projectApproval(approval: Approval): Approval & {
  binding_status: 'exact' | 'unbound'
  authoritative_for_execution: boolean
} {
  return projectApprovalForPublic(approval)
}

function assertResolveMatchesPending(
  body: z.infer<typeof ResolveApprovalMutationSchema>,
  approval: Approval,
): void {
  const comparisons: Array<[keyof z.infer<typeof ResolveApprovalMutationSchema>, string | null | undefined]> = [
    ['action_type', approval.action_type],
    ['target_ref', approval.target_ref],
    ['requested_by', approval.requested_by],
    ['subject_digest', approval.subject_digest ?? null],
    ['payload_ref', approval.payload_ref ?? null],
    ['policy_ref', approval.policy_ref ?? null],
    ['precondition_hash', approval.precondition_hash ?? null],
    ['expires_at', approval.expires_at ?? null],
  ]

  for (const [field, expected] of comparisons) {
    if (body[field] !== undefined && body[field] !== expected) {
      throw new Error(`Approval resolve mismatch for ${field}`)
    }
  }
}

function approvalResolutionErrorResponse(error: ApprovalResolutionError): NextResponse {
  switch (error.code) {
    case 'APPROVAL_ALREADY_EXISTS':
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    case 'APPROVAL_NOT_FOUND':
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    case 'APPROVAL_ALREADY_RESOLVED':
    case 'APPROVAL_EXPIRED':
    case 'APPROVAL_BINDING_MISMATCH':
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
  }
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')
    if (!runId) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }
    if (!isSafeRunId(runId)) {
      return NextResponse.json({ error: 'runId must be a file-safe identifier', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const approvals = foldApprovals(await readApprovals(getBasePath(), runId)).map(projectApproval)
    return NextResponse.json({ approvals })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'approvals-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const rawBody = await request.json()
    if (rawBody?.runId == null) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }
    const body = ApprovalMutationSchema.parse(rawBody)

    const bp = getBasePath()

    if (body.action === 'request') {
      const exactBinding = {
        subject_digest: body.subject_digest ?? null,
        payload_ref: body.payload_ref ?? null,
        policy_ref: body.policy_ref ?? null,
      }
      if (!hasExactApprovalBinding(exactBinding) || !hasValidRuntimeApprovalBinding({
        actionType: body.action_type,
        subjectDigest: exactBinding.subject_digest,
        payloadRef: exactBinding.payload_ref,
        policyRef: exactBinding.policy_ref,
        preconditionHash: body.precondition_hash ?? null,
        expiresAt: body.expires_at ?? null,
      })) {
        if (body.action_type === 'run' || body.action_type === 'side_effect') {
          return jsonError(
            'Runtime approvals require exact subject_digest, payload_ref, and policy_ref',
            'APPROVAL_BINDING_REQUIRED',
            400,
          )
        }
      }

      const approval: Approval = {
        id: `apr-${randomUUID()}`,
        action_type: body.action_type,
        target_ref: body.target_ref,
        requested_by: body.requested_by ?? 'threados',
        status: 'pending' as const,
        approved_by: null,
        approved_at: null,
        notes: body.notes ?? null,
        subject_digest: body.subject_digest ?? null,
        payload_ref: body.payload_ref ?? null,
        policy_ref: body.policy_ref ?? null,
        precondition_hash: body.precondition_hash ?? null,
        expires_at: body.expires_at ?? null,
        consumed_at: null,
        consumed_by: null,
      }
      await appendApproval(bp, body.runId, approval)
      const evidence = await appendApprovalTraceEvidence({
        basePath: bp,
        runId: body.runId,
        events: [{
          ts: new Date().toISOString(),
          run_id: body.runId,
          surface_id: body.target_ref,
          actor: 'api:approvals',
          event_type: 'approval-requested',
          payload_ref: approval.payload_ref ?? null,
          policy_ref: approval.policy_ref ?? null,
        }],
      })
      return NextResponse.json({ approval: projectApproval(approval), ...evidence })
    }

    if (body.action === 'resolve') {
      const resolvedAt = new Date().toISOString()
      try {
        const approval = await resolvePendingApproval(
          bp,
          body.runId,
          body.approval_id,
          (currentApproval) => {
            if (isApprovalExpired(currentApproval)) {
              throw new ApprovalResolutionError('APPROVAL_EXPIRED', 'Approval expired')
            }
            try {
              assertResolveMatchesPending(body, currentApproval)
            } catch (error) {
              throw new ApprovalResolutionError(
                'APPROVAL_BINDING_MISMATCH',
                error instanceof Error ? error.message : 'Approval resolve binding mismatch',
              )
            }

            return {
              ...currentApproval,
              status: body.status,
              approved_by: session.email,
              approved_at: resolvedAt,
              notes: body.notes ?? null,
            }
          },
        )

        const evidence = await appendApprovalTraceEvidence({
          basePath: bp,
          runId: body.runId,
          events: [{
            ts: resolvedAt,
            run_id: body.runId,
            surface_id: approval.target_ref,
            actor: 'api:approvals',
            event_type: 'approval-resolved',
            payload_ref: approval.payload_ref ?? null,
            policy_ref: approval.policy_ref ?? null,
          }],
        })
        return NextResponse.json({ approval: projectApproval(approval), ...evidence })
      } catch (error) {
        if (error instanceof ApprovalResolutionError) {
          return approvalResolutionErrorResponse(error)
        }
        throw error
      }
    }

    return jsonError('Invalid approval action', 'INVALID_ACTION', 400)
  } catch (err) {
    return handleError(err)
  }
}
