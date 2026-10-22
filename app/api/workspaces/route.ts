import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const ListSchema = z.object({
  run_id: z.string().min(1).optional(),
})

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'workspaces-read',
      limit: 120,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const url = new URL(request.url)
    const allowed = new Set(['run_id'])
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) {
        return runtimeJson({
          error: `Unsupported query parameter: ${key}`,
          code: 'VALIDATION_ERROR',
        }, 400)
      }
    }
    const query = ListSchema.parse(Object.fromEntries(url.searchParams.entries()))
    const service = await getApiRuntimeService(getBasePath())
    const workspaces = await service.listWorkspaces({ runId: query.run_id })
    return runtimeJson({ schema_version: 1, workspaces }, 200)
  } catch (error) {
    return handleRuntimeError(error)
  }
}
