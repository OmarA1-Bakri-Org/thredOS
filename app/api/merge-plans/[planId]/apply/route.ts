import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson, assertRuntimeProcessControlsAllowed } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'
import { MergeApplyRequestSchema } from '@/lib/merge/transactions'

const RequestSchema = MergeApplyRequestSchema.extend({ confirm: z.literal(true) }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-operator-write', limit: 20, windowMs: 300_000 })
    if (limited) return limited
    assertRuntimeProcessControlsAllowed()
    const body = RequestSchema.parse(await request.json())
    const context = resolveRuntimeContext(request, session, body.confirm)
    const { planId } = await params
    const service = await getApiRuntimeService(getBasePath())
    const result = await service.applyMergePlan(planId, { approval_id: body.approval_id, plan_digest: body.plan_digest }, context)
    return runtimeJson({ schema_version: 1, result }, result.filesystem_apply.status === 'applied' ? 200 : 409, context.idempotencyKey)
  } catch (error) { return handleRuntimeError(error) }
}
