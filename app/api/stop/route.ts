import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auditLog, requireRequestSession } from '@/lib/api-helpers'
import { assertRuntimeProcessControlsAllowed, getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { RuntimeServiceError } from '@/lib/runtime/errors'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({ stepId: z.string().min(1) })

export async function POST(request: Request) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'stop', limit: 30, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const context = resolveRuntimeContext(request, session)
    idempotencyKey = context.idempotencyKey
    assertRuntimeProcessControlsAllowed()
    const { stepId } = BodySchema.parse(await request.json())
    const service = await getApiRuntimeService(getBasePath())
    const attempt = await service.findLatestAttempt({ sequenceId: '$current', stepId })
    if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_RUNNING', `Step '${stepId}' has no attempt to stop`)
    await service.cancelAttempt(attempt.id, context)
    await auditLog('stop', stepId, { attemptId: attempt.id })
    return runtimeJson({ success: true, action: 'stop', stepId, attemptId: attempt.id }, 200, idempotencyKey)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}
