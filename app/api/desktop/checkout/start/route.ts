import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { ActivationSession } from '@/lib/local-first/types'
import { getBasePath } from '@/lib/config'
import { buildClerkDesktopSignInUrl, getDesktopLocalAppUrl, getDesktopReturnUrl } from '@/lib/commercial/config'
import { createDesktopCheckoutSession } from '@/lib/commercial/stripe'
import { createActivationSession, updateActivationSession } from '@/lib/local-first/activation-sessions'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  email: z.string().email().optional(),
  plan: z.literal('desktop-public-beta').optional(),
})

export async function POST(request: NextRequest) {
  const rateLimited = applyRateLimit(request, {
    bucket: 'desktop-checkout-start',
    limit: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(issue => issue.message).join(', ') }, { status: 400 })
  }

  const { email, plan = 'desktop-public-beta' } = parsed.data
  const state = randomUUID()
  const origin = request.nextUrl.origin
  const returnUrl = getDesktopReturnUrl()
  const localAppUrl = getDesktopLocalAppUrl()
  const authUrl = buildClerkDesktopSignInUrl(origin, state) ?? `${origin}/login?source=desktop&state=${encodeURIComponent(state)}`

  await createActivationSession(getBasePath(), {
    state,
    authUrl,
    checkoutUrl: null,
    returnUrl,
    localAppUrl,
    status: 'created',
    plan,
    customerEmail: email ?? null,
    checkoutSessionId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    activationToken: null,
  })

  try {
    const checkout = await createDesktopCheckoutSession({
      origin,
      state,
      customerEmail: email ?? null,
      plan,
    })
    const current = await updateActivationSession(getBasePath(), state, session => ({
      ...session,
      status: 'checkout_started',
      checkoutUrl: checkout.url ?? session.checkoutUrl,
      checkoutSessionId: checkout.id,
      stripeCustomerId: typeof checkout.customer === 'string' ? checkout.customer : session.stripeCustomerId,
    }))

    const session: ActivationSession = {
      state,
      authUrl,
      checkoutUrl: current?.checkoutUrl ?? checkout.url ?? null,
      returnUrl,
      localAppUrl,
    }
    return NextResponse.json(session)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start desktop checkout'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
