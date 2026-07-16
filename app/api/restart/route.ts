import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auditLog, requireRequestSession } from '@/lib/api-helpers'
import { assertRuntimeProcessControlsAllowed, getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { RuntimeServiceError } from '@/lib/runtime/errors'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({ stepId: z.string().min(1) })
const TERMINAL = ['completed', 'needs_review', 'failed', 'cancelled', 'timed_out', 'interrupted'] as const

export async function POST(request: Request) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'restart', limit: 30, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const context = resolveRuntimeContext(request, session)
    idempotencyKey = context.idempotencyKey
    assertRuntimeProcessControlsAllowed()
    const { stepId } = BodySchema.parse(await request.json())
    const service = await getApiRuntimeService(getBasePath())
    const original = await service.findLatestAttempt({ sequenceId: '$current', stepId, statuses: [...TERMINAL] })
    if (!original) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `Step '${stepId}' has no terminal attempt to retry`)
    const retried = await service.retryAttempt(original.id, context)
    await auditLog('restart', stepId, { attemptId: retried.id, retryOfAttemptId: original.id })
    return runtimeJson({ success: true, action: 'restart', stepId, attemptId: retried.id, retryOfAttemptId: original.id }, 200, idempotencyKey)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}
