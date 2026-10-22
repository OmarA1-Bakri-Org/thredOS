import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const Query = z.object({ run_id: z.string().min(1) }).strict()

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'change-sets-read', limit: 120, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    const query = Query.parse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    const service = await getApiRuntimeService(getBasePath())
    return runtimeJson({ schema_version: 1, change_sets: await service.listChangeSets(query.run_id) }, 200)
  } catch (error) { return handleRuntimeError(error) }
}
