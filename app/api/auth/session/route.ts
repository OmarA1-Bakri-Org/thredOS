import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const session = getRequestSession(request)
  return NextResponse.json({
    authenticated: !!session,
    session,
  })
}
