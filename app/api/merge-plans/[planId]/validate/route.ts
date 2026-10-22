import { z } from 'zod'
import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { assertRuntimeProcessControlsAllowed, getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-validation-write', limit: 20, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    assertRuntimeProcessControlsAllowed()
    const body = (await request.text()).trim()
    const confirmation = body ? z.object({ confirm: z.boolean().optional() }).strict().parse(JSON.parse(body)).confirm === true : false
    const { planId } = await params
    const context = resolveRuntimeContext(request, session, confirmation)
    const service = await getApiRuntimeService(getBasePath())
    const plan = await service.validateMergePlan(planId, context)
    return runtimeJson({ schema_version: 1, plan }, 200, context.idempotencyKey)
  } catch (error) { return handleRuntimeError(error) }
}
