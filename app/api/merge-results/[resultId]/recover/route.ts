import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson, assertRuntimeProcessControlsAllowed } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'


const RequestSchema = z.object({ confirm: z.literal(true) }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ resultId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-operator-write', limit: 20, windowMs: 300_000 })
    if (limited) return limited
    assertRuntimeProcessControlsAllowed()
    const body = RequestSchema.parse(await request.json())
    const context = resolveRuntimeContext(request, session, body.confirm)
    const { resultId } = await params
    const service = await getApiRuntimeService(getBasePath())
    const result = await service.recoverMergeResult(resultId, context)
    return runtimeJson({ schema_version: 1, result }, 200, context.idempotencyKey)
  } catch (error) { return handleRuntimeError(error) }
}
