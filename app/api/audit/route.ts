import { NextResponse } from 'next/server'
import { read } from '@/lib/audit/logger'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const entries = await read(getBasePath(), { limit, offset })
    return NextResponse.json({ entries, limit, offset })
  } catch (err) {
    return handleError(err)
  }
}
