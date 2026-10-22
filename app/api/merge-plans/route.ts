import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const Body = z.object({ change_set_id: z.string().min(1) }).strict()

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-preview-write', limit: 20, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    const body = Body.parse(await request.json())
    const context = resolveRuntimeContext(request, session)
    const service = await getApiRuntimeService(getBasePath())
    const result = await service.previewSelectedChangeSet(body.change_set_id, context)
    return runtimeJson({ schema_version: 1, ...result }, 201, context.idempotencyKey)
  } catch (error) { return handleRuntimeError(error) }
}
