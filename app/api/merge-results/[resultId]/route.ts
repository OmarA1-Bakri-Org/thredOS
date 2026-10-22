import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(request: Request, { params }: { params: Promise<{ resultId: string }> }) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'merge-result-read', limit: 120, windowMs: 300_000 })
    if (limited) return limited
    const service = await getApiRuntimeService(getBasePath())
    const result = await service.inspectMergeResult((await params).resultId)
    return result ? runtimeJson({ schema_version: 1, result }, 200)
      : runtimeJson({ code: 'MERGE_RESULT_NOT_FOUND', error: 'Merge result was not found' }, 404)
  } catch (error) { return handleRuntimeError(error) }
}
