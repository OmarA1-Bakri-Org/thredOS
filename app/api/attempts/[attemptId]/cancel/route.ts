import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { assertRuntimeProcessControlsAllowed, getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const ParamsSchema = z.object({ attemptId: z.string().min(1) })

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'attempt-cancel', limit: 30, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const context = resolveRuntimeContext(request, session)
    idempotencyKey = context.idempotencyKey
    assertRuntimeProcessControlsAllowed()
    const { attemptId } = ParamsSchema.parse(await params)
    const service = await getApiRuntimeService(getBasePath())
    const cancelled = await service.cancelAttempt(attemptId, context)
    return runtimeJson(await service.inspectAttempt(cancelled.id), 200, idempotencyKey)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}
