import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applySessionCookie, createSessionToken, verifyAdminCredentials } from '@/lib/auth/session'
import { jsonError } from '@/lib/api-helpers'
import { isHostedMode } from '@/lib/hosted'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
})

function sanitizeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith('/')) return '/app'
  if (value.startsWith('//')) return '/app'
  return value
}

export async function POST(request: NextRequest) {
  if (!isHostedMode()) {
    return NextResponse.json({ success: true, redirectTo: '/app' })
  }

  const rateLimited = applyRateLimit(request, {
    bucket: 'auth-login',
    limit: 5,
    windowMs: 10 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const parsed = BodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map(issue => issue.message).join(', '), 'VALIDATION_ERROR', 400)
  }

  const { email, password, next } = parsed.data
  if (!verifyAdminCredentials(email, password)) {
    return jsonError('Invalid email or password', 'INVALID_CREDENTIALS', 401)
  }

  const response = NextResponse.json({
    success: true,
    redirectTo: sanitizeNextPath(next),
  })
  applySessionCookie(response, createSessionToken(email))
  return response
}
