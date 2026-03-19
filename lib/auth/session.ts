import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail, getAdminPasswordHash, getSessionSecret, isHostedMode } from '@/lib/hosted'

export const THREDOS_SESSION_COOKIE = 'thredos_session'
export const THREADOS_SESSION_COOKIE = THREDOS_SESSION_COOKIE
const LEGACY_THREADOS_SESSION_COOKIE = 'threados_session'
const SESSION_TTL_SECONDS = 60 * 60 * 12

export interface AuthSession {
  email: string
  exp: number
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8')
}

function requireSessionSecret(): string {
  const secret = getSessionSecret()
  if (!secret) {
    throw new Error('THREDOS_SESSION_SECRET or THREADOS_SESSION_SECRET is required in hosted mode')
  }
  return secret
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSessionToken(email: string): string {
  const secret = requireSessionSecret()
  const payload = base64UrlEncode(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  } satisfies AuthSession))
  const signature = signPayload(payload, secret)
  return `${payload}.${signature}`
}

export function verifySessionToken(token: string | null | undefined): AuthSession | null {
  if (!token) return null
  const secret = getSessionSecret()
  if (!secret) return null

  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = signPayload(payload, secret)
  const actualBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (actualBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(actualBuf, expectedBuf)) return null

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as AuthSession
    if (!session.email || !session.exp) return null
    if (session.exp <= Math.floor(Date.now() / 1000)) return null
    return session
  } catch {
    return null
  }
}

export async function getServerSession(): Promise<AuthSession | null> {
  if (!isHostedMode()) {
    return { email: 'local@thredos', exp: Number.MAX_SAFE_INTEGER }
  }
  const store = await cookies()
  return verifySessionToken(
    store.get(THREDOS_SESSION_COOKIE)?.value ?? store.get(LEGACY_THREADOS_SESSION_COOKIE)?.value,
  )
}

export function getRequestSession(request: NextRequest): AuthSession | null {
  if (!isHostedMode()) {
    return { email: 'local@thredos', exp: Number.MAX_SAFE_INTEGER }
  }
  return verifySessionToken(
    request.cookies.get(THREDOS_SESSION_COOKIE)?.value ?? request.cookies.get(LEGACY_THREADOS_SESSION_COOKIE)?.value,
  )
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(THREDOS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHostedMode(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(THREDOS_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHostedMode(),
    path: '/',
    maxAge: 0,
  })
  response.cookies.set(LEGACY_THREADOS_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHostedMode(),
    path: '/',
    maxAge: 0,
  })
}

function parseStoredPasswordHash(stored: string): { salt: Buffer; hash: Buffer } | null {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return null
  try {
    return {
      salt: Buffer.from(parts[1], 'base64url'),
      hash: Buffer.from(parts[2], 'base64url'),
    }
  } catch {
    return null
  }
}

export function hashPasswordForEnv(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  if (!isHostedMode()) return true
  const expectedEmail = getAdminEmail()
  const storedHash = getAdminPasswordHash()
  if (!expectedEmail || !storedHash) return false
  if (email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return false

  const parsed = parseStoredPasswordHash(storedHash)
  if (!parsed) return false
  const computed = scryptSync(password, parsed.salt, parsed.hash.length)
  return timingSafeEqual(computed, parsed.hash)
}
