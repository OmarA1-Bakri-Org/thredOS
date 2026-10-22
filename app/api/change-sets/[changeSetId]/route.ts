import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const Params = z.object({ changeSetId: z.string().min(1) })

export async function GET(request: Request, { params }: { params: Promise<{ changeSetId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'change-set-inspect', limit: 120, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    const { changeSetId } = Params.parse(await params)
    if (new URL(request.url).searchParams.size > 0) {
      return runtimeJson({ error: 'Unsupported query parameters', code: 'VALIDATION_ERROR' }, 400)
    }
    const service = await getApiRuntimeService(getBasePath())
    return runtimeJson(await service.inspectChangeSetById(changeSetId), 200)
  } catch (error) { return handleRuntimeError(error) }
}
