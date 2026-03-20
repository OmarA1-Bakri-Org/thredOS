import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { ActivationSession } from '@/lib/local-first/types'
import { getBasePath } from '@/lib/config'
import { buildClerkDesktopSignInUrl, getDesktopLocalAppUrl, getDesktopReturnUrl } from '@/lib/commercial/config'
import { createActivationSession } from '@/lib/local-first/activation-sessions'
import { applyRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const rateLimited = applyRateLimit(request, {
    bucket: 'desktop-auth-start',
    limit: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const state = randomUUID()
  const origin = request.nextUrl.origin
  const returnUrl = getDesktopReturnUrl()
  const localAppUrl = getDesktopLocalAppUrl()
  const authUrl = buildClerkDesktopSignInUrl(origin, state) ?? `${origin}/login?source=desktop&state=${encodeURIComponent(state)}`

  const session: ActivationSession = {
    state,
    authUrl,
    checkoutUrl: null,
    returnUrl,
    localAppUrl,
  }

  await createActivationSession(getBasePath(), {
    ...session,
    status: 'created',
    plan: 'desktop-public-beta',
    customerEmail: null,
    checkoutSessionId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    activationToken: null,
  })

  return NextResponse.json(session)
}
