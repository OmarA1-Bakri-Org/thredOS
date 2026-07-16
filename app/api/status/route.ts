import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import type { SequenceStatusProjection } from '@/lib/runtime/service-types'
import { applyRateLimit } from '@/lib/rate-limit'

export type SequenceStatus = SequenceStatusProjection

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'status', limit: 120, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const service = await getApiRuntimeService(getBasePath())
    return NextResponse.json(await service.getStatus())
  } catch (error) {
    return handleRuntimeError(error)
  }
}
