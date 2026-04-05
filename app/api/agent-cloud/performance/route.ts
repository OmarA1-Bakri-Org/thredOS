import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session
  return NextResponse.json({
    error: 'Canonical agent performance history is local-only in thredOS.',
    code: 'LOCAL_ONLY',
  }, { status: 410 })
}

export async function POST(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session
  const rateLimited = applyRateLimit(request, {
    bucket: 'agent-cloud-performance',
    limit: 30,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited
  return NextResponse.json({
    error: 'Canonical agent performance history is local-only in thredOS.',
    code: 'LOCAL_ONLY',
  }, { status: 410 })
}
