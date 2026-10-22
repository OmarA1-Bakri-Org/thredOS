import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import {
  getApiRuntimeService,
  handleRuntimeError,
  resolveRuntimeContext,
  runtimeJson,
} from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const ParamsSchema = z.object({ workspaceId: z.string().min(1) })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'workspace-retain',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const context = resolveRuntimeContext(request, session)
    idempotencyKey = context.idempotencyKey
    const { workspaceId } = ParamsSchema.parse(await params)
    const service = await getApiRuntimeService(getBasePath())
    const inspection = await service.retainWorkspace(workspaceId, context)
    return runtimeJson(inspection, 200, idempotencyKey)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}
