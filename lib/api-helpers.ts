import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getBasePath } from './config'
import { PolicyEngine } from './policy/engine'
import * as audit from './audit/logger'
import {
  THREDOS_SESSION_COOKIE,
  verifySessionToken,
  type AuthSession,
} from './auth/session'
import { isHostedMode } from './hosted'
import { ThredOSError } from './errors'

export interface PolicyCheckResult {
  allowed: boolean
  reason: string | null
  confirmationRequired: boolean
}

export function jsonError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
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

export function requireRequestSession(request?: Request): AuthSession | NextResponse {
  if (!isHostedMode()) {
    return { email: 'local@thredos', exp: Number.MAX_SAFE_INTEGER }
  }
  const cookieHeader = request?.headers.get('cookie') ?? null
  const token = readCookieValue(cookieHeader, THREDOS_SESSION_COOKIE)
    ?? readCookieValue(cookieHeader, 'threados_session')
  const session = verifySessionToken(token)
  if (!session) return jsonError('Authentication required', 'UNAUTHORIZED', 401)
  return session
}

export async function auditLog(action: string, target: string, payload?: Record<string, unknown>, result = 'ok') {
  try {
    await audit.log(getBasePath(), {
      timestamp: new Date().toISOString(),
      actor: 'api',
      action,
      target,
      payload,
      result,
    })
  } catch {
    // audit log failure is non-fatal
  }
}

export async function checkPolicy(
  type: 'run_command' | 'fanout' | 'concurrent',
  options?: {
    command?: string
    cwd?: string
    fanoutCount?: number
    concurrentCount?: number
    confirmed?: boolean
  }
): Promise<PolicyCheckResult> {
  const engine = await PolicyEngine.load(getBasePath())
  const result = engine.validate({
    type,
    command: options?.command,
    cwd: options?.cwd,
    fanout_count: options?.fanoutCount,
    concurrent_count: options?.concurrentCount,
  })
  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason || 'Policy denied',
      confirmationRequired: false,
    }
  }
  if (result.confirmation_required && !options?.confirmed) {
    return {
      allowed: false,
      reason: 'Execution requires explicit confirmation in SAFE mode',
      confirmationRequired: true,
    }
  }
  return {
    allowed: true,
    reason: null,
    confirmationRequired: false,
  }
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(err.issues.map(i => i.message).join(', '), 'VALIDATION_ERROR', 400)
  }
  if (err instanceof ThredOSError) {
    if (err.code === 'SEQUENCE_CONFLICT' || err.code === 'THREAD_SURFACE_STATE_CONFLICT') {
      return jsonError(err.message, err.code, 409)
    }
    if (err.code.endsWith('_NOT_FOUND')) {
      return jsonError(err.message, err.code, 404)
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('not found') || message.includes('ENOENT')) {
    return jsonError(message, 'NOT_FOUND', 404)
  }
  // Always log the full error server-side for debugging
  console.error('[api-helpers] Internal error:', err instanceof Error ? err.stack || err.message : String(err))
  // Avoid leaking internal error details to client in production
  const safeMessage = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : message
  return jsonError(safeMessage, 'INTERNAL_ERROR', 500)
}
