import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { applyRateLimit } from './rate-limit'
import { THREDOS_SESSION_COOKIE, createSessionToken } from './auth/session'

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/test', { headers })
}

describe('applyRateLimit', () => {
  const originalEnv = {
    THREDOS_HOSTED_MODE: process.env.THREDOS_HOSTED_MODE,
    THREDOS_SESSION_SECRET: process.env.THREDOS_SESSION_SECRET,
  }

  beforeEach(() => {
    process.env.THREDOS_HOSTED_MODE = 'true'
    process.env.THREDOS_SESSION_SECRET = 'rate-limit-test-secret'
    globalThis.__THREDOS_RATE_LIMITS__ = new Map()
  })

  afterEach(() => {
    if (originalEnv.THREDOS_HOSTED_MODE === undefined) {
      delete process.env.THREDOS_HOSTED_MODE
    } else {
      process.env.THREDOS_HOSTED_MODE = originalEnv.THREDOS_HOSTED_MODE
    }

    if (originalEnv.THREDOS_SESSION_SECRET === undefined) {
      delete process.env.THREDOS_SESSION_SECRET
    } else {
      process.env.THREDOS_SESSION_SECRET = originalEnv.THREDOS_SESSION_SECRET
    }

    globalThis.__THREDOS_RATE_LIMITS__ = undefined
  })

  test('keys authenticated requests by session instead of spoofable forwarded headers', () => {
    const token = createSessionToken('reviewer@thredos.local')
    const first = makeRequest({
      cookie: `${THREDOS_SESSION_COOKIE}=${token}`,
      'x-forwarded-for': '198.51.100.10',
    })
    const second = makeRequest({
      cookie: `${THREDOS_SESSION_COOKIE}=${token}`,
      'x-forwarded-for': '203.0.113.25',
    })

    expect(applyRateLimit(first, { bucket: 'agents-write', limit: 1, windowMs: 60_000 })).toBeNull()

    const limited = applyRateLimit(second, { bucket: 'agents-write', limit: 1, windowMs: 60_000 })
    expect(limited?.status).toBe(429)
  })

  test('prunes expired entries before adding new counters', () => {
    globalThis.__THREDOS_RATE_LIMITS__ = new Map([
      ['agents-write:ip:198.51.100.10', { count: 30, resetAt: Date.now() - 1_000 }],
    ])

    const request = makeRequest({ 'x-real-ip': '198.51.100.11' })
    expect(applyRateLimit(request, { bucket: 'agents-write', limit: 30, windowMs: 60_000 })).toBeNull()
    expect(globalThis.__THREDOS_RATE_LIMITS__?.size).toBe(1)
  })
})
