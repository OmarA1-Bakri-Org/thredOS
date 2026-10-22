import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'workspaces-doctor',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const service = await getApiRuntimeService(getBasePath())
    return runtimeJson(await service.doctorWorkspaces(), 200)
  } catch (error) {
    return handleRuntimeError(error)
  }
}
