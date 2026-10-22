import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-preview-read', limit: 120, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    const { planId } = await params
    const service = await getApiRuntimeService(getBasePath())
    const plan = await service.inspectMergePlan(planId)
    return plan ? runtimeJson({ schema_version: 1, plan }, 200)
      : runtimeJson({ error: 'Merge plan was not found', code: 'MERGE_PLAN_NOT_FOUND' }, 404)
  } catch (error) { return handleRuntimeError(error) }
}
