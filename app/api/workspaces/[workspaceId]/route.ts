import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const ParamsSchema = z.object({ workspaceId: z.string().min(1) })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'workspace-read',
      limit: 120,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const { workspaceId } = ParamsSchema.parse(await params)
    const service = await getApiRuntimeService(getBasePath())
    return runtimeJson(await service.inspectWorkspace(workspaceId), 200)
  } catch (error) {
    return handleRuntimeError(error)
  }
}
