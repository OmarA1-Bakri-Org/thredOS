import { NextResponse } from 'next/server'
import { isHostedMode } from '@/lib/hosted'

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

function getRateLimitStore(): Map<string, RateLimitEntry> {
  globalThis.__THREDOS_RATE_LIMITS__ ??= new Map()
  return globalThis.__THREDOS_RATE_LIMITS__
}

function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }

  const directIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip')
  if (directIp?.trim()) return directIp.trim()

  const userAgent = request.headers.get('user-agent')?.trim()
  return userAgent ? `ua:${userAgent}` : 'anonymous'
}

export function applyRateLimit(request: Request, options: RateLimitOptions): NextResponse | null {
  if (!isHostedMode()) return null

  const now = Date.now()
  const store = getRateLimitStore()
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
