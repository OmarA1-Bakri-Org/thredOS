import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

function buildLogoutResponse() {
  const response = NextResponse.json({ success: true, redirectTo: '/login' })
  clearSessionCookie(response)
  return response
}

export async function POST() {
  return buildLogoutResponse()
}

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url))
  clearSessionCookie(response)
  return response
}
