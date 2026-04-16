import { NextResponse } from 'next/server'
import { isHostedMode } from '@/lib/hosted'
import { THREDOS_SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session'

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitOptions {
  bucket: string
  limit: number
  windowMs: number
}

declare global {
  var __THREDOS_RATE_LIMITS__: Map<string, RateLimitEntry> | undefined
}

const LEGACY_THREADOS_SESSION_COOKIE = 'threados_session'

function getRateLimitStore(): Map<string, RateLimitEntry> {
  globalThis.__THREDOS_RATE_LIMITS__ ??= new Map()
  return globalThis.__THREDOS_RATE_LIMITS__
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const segments = cookieHeader.split(';')
  for (const segment of segments) {
    const [rawName, ...rawValue] = segment.trim().split('=')
    if (rawName === name) {
      return rawValue.join('=') || null
    }
  }
  return null
}

function getClientAddress(request: Request): string {
  const cookieHeader = request.headers.get('cookie')
  const sessionToken = readCookieValue(cookieHeader, THREDOS_SESSION_COOKIE)
    ?? readCookieValue(cookieHeader, LEGACY_THREADOS_SESSION_COOKIE)
  const session = verifySessionToken(sessionToken)
  if (session?.email) {
    return `session:${session.email.trim().toLowerCase()}`
  }

  const directIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip')
  if (directIp?.trim()) return `ip:${directIp.trim()}`

  const userAgent = request.headers.get('user-agent')?.trim()
  return userAgent ? `ua:${userAgent}` : 'anonymous'
}

function pruneExpiredEntries(store: Map<string, RateLimitEntry>, now: number) {
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
}

export function applyRateLimit(request: Request, options: RateLimitOptions): NextResponse | null {
  if (!isHostedMode()) return null

  const now = Date.now()
  const store = getRateLimitStore()
  pruneExpiredEntries(store, now)
  const key = `${options.bucket}:${getClientAddress(request)}`
  const current = store.get(key)

  if (!current || current.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    })
    return null
  }

  if (current.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
        },
      },
    )
  }

  current.count += 1
  store.set(key, current)
  return null
}
