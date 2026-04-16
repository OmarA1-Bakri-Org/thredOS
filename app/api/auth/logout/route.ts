import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'
import { applyRateLimit } from '@/lib/rate-limit'

function buildLogoutResponse() {
  const response = NextResponse.json({ success: true, redirectTo: '/login' })
  clearSessionCookie(response)
  return response
}

export async function POST(request: Request) {
  const rateLimited = applyRateLimit(request, {
    bucket: 'auth-logout',
    limit: 30,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited
  return buildLogoutResponse()
}

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url))
  clearSessionCookie(response)
  return response
}
