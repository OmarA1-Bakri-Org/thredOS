import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { issueActivationToken } from '@/lib/local-first/entitlements'
import { readActivationSession, updateActivationSession } from '@/lib/local-first/activation-sessions'
import { upsertBillingEntitlement } from '@/lib/commercial/billing-state'
import { resolveDesktopCheckoutSession } from '@/lib/commercial/stripe'
import { getDesktopReturnUrl } from '@/lib/commercial/config'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const rateLimited = applyRateLimit(request, {
    bucket: 'desktop-checkout-resolve',
    limit: 30,
    windowMs: 10 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const url = new URL(request.url)
  const stateId = url.searchParams.get('state')
  const sessionId = url.searchParams.get('session_id')

  if (!stateId || !sessionId) {
    return NextResponse.json({ error: 'state and session_id are required' }, { status: 400 })
  }

  const basePath = getBasePath()
  const pendingSession = await readActivationSession(basePath, stateId)
  if (!pendingSession) {
    return NextResponse.json({ error: 'Activation session not found' }, { status: 404 })
  }

  try {
    const resolution = await resolveDesktopCheckoutSession(sessionId, {
      stateId,
      customerEmail: pendingSession.customerEmail,
    })
    if (resolution.session.client_reference_id !== stateId) {
      return NextResponse.json({ error: 'Checkout session does not match activation state' }, { status: 409 })
    }
    if (resolution.entitlementStatus === 'pending' || resolution.entitlementStatus === 'expired') {
      return NextResponse.json({
        error: `Checkout is not in an activatable state (${resolution.entitlementStatus})`,
      }, { status: 409 })
    }

    const token = issueActivationToken(resolution.payload)
    await updateActivationSession(basePath, stateId, current => ({
      ...current,
      status: 'activated',
      customerEmail: resolution.payload.customerEmail,
      checkoutSessionId: resolution.session.id,
      stripeCustomerId: typeof resolution.session.customer === 'string' ? resolution.session.customer : current.stripeCustomerId,
      stripeSubscriptionId: resolution.subscription?.id ?? current.stripeSubscriptionId,
      activationToken: token,
    }))

    await upsertBillingEntitlement(basePath, {
      state: stateId,
      plan: 'desktop-public-beta',
      customerEmail: resolution.payload.customerEmail,
      checkoutSessionId: resolution.session.id,
      customerId: typeof resolution.session.customer === 'string' ? resolution.session.customer : null,
      subscriptionId: resolution.subscription?.id ?? null,
      subscriptionStatus: resolution.subscription?.status ?? null,
      entitlementStatus: resolution.entitlementStatus,
      activatedAt: resolution.payload.activatedAt,
      expiresAt: resolution.payload.expiresAt,
      graceUntil: resolution.payload.graceUntil,
      updatedAt: new Date().toISOString(),
      source: 'checkout-resolve',
    })

    const returnUrl = getDesktopReturnUrl()
    const deepLink = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&state=${encodeURIComponent(stateId)}`

    return NextResponse.json({
      success: true,
      token,
      deepLink,
      entitlementStatus: resolution.entitlementStatus,
      customerEmail: resolution.payload.customerEmail,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve checkout session'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
