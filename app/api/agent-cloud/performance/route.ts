import { NextResponse } from 'next/server'
import { requireRequestSession } from '@/lib/api-helpers'

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
  return NextResponse.json({
    error: 'Canonical agent performance history is local-only in thredOS.',
    code: 'LOCAL_ONLY',
  }, { status: 410 })
}
