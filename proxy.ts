import { NextRequest, NextResponse } from 'next/server'
import { getSessionSecret, isHostedMode } from '@/lib/hosted'

const SESSION_COOKIES = ['thredos_session', 'threados_session']
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/healthz',
  '/api/readiness',
])

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = SESSION_COOKIES
    .map(cookieName => request.cookies.get(cookieName)?.value)
    .find(value => typeof value === 'string' && value.length > 0)
  const secret = getSessionSecret()
  if (!token || !secret) return false

  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const expectedSignature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    if (encodeBase64Url(new Uint8Array(expectedSignature)) !== signature) {
      return false
    }

    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { exp?: number }
    if (typeof session.exp !== 'number') return false
    return session.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function unauthorizedApiResponse() {
  return NextResponse.json({
    error: 'Authentication required',
    code: 'UNAUTHORIZED',
  }, { status: 401 })
}

export async function proxy(request: NextRequest) {
  if (!isHostedMode()) {
    return NextResponse.next()
  }

  const { pathname, search } = request.nextUrl

  if (pathname === '/login') {
    if (await hasValidSession(request)) {
      return NextResponse.redirect(new URL('/app', request.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(pathname)) {
      return NextResponse.next()
    }
    if (await hasValidSession(request)) {
      return NextResponse.next()
    }
    return unauthorizedApiResponse()
  }

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    if (await hasValidSession(request)) {
      return NextResponse.next()
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/app/:path*', '/api/:path*', '/login'],
}
