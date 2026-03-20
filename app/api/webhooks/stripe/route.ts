import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getBasePath } from '@/lib/config'
import { constructStripeWebhookEvent } from '@/lib/commercial/stripe'
import {
  findBillingEntitlement,
  hasProcessedBillingEvent,
  markBillingEventProcessed,
  upsertBillingEntitlement,
} from '@/lib/commercial/billing-state'

function deriveEntitlementStatus(status: string | null | undefined): 'pending' | 'active' | 'grace' | 'expired' {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'grace'
    case 'incomplete':
    case 'incomplete_expired':
      return 'pending'
    case 'canceled':
    default:
      return 'expired'
  }
}

function subscriptionDates(subscription: Stripe.Subscription) {
  const terminalTimestamp = subscription.cancel_at ?? subscription.ended_at
  const expiresAt = terminalTimestamp
    ? new Date(terminalTimestamp * 1000).toISOString()
    : null
  const graceUntil = expiresAt
    ? new Date(Date.parse(expiresAt) + 14 * 24 * 60 * 60 * 1000).toISOString()
    : null
  return { expiresAt, graceUntil }
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const payload = await request.text()

  try {
    const event = constructStripeWebhookEvent(payload, signature)
    const basePath = getBasePath()
    if (await hasProcessedBillingEvent(basePath, event.id)) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const stateId = session.client_reference_id ?? session.metadata?.state ?? null
        if (!stateId) break

        const existing = await findBillingEntitlement(basePath, { state: stateId })
        await upsertBillingEntitlement(basePath, {
          state: stateId,
          plan: 'desktop-public-beta',
          customerEmail: session.customer_details?.email ?? session.customer_email ?? existing?.customerEmail ?? null,
          checkoutSessionId: session.id,
          customerId: typeof session.customer === 'string' ? session.customer : existing?.customerId ?? null,
          subscriptionId: typeof session.subscription === 'string' ? session.subscription : existing?.subscriptionId ?? null,
          subscriptionStatus: existing?.subscriptionStatus ?? null,
          entitlementStatus: existing?.entitlementStatus ?? 'pending',
          activatedAt: existing?.activatedAt ?? null,
          expiresAt: existing?.expiresAt ?? null,
          graceUntil: existing?.graceUntil ?? null,
          updatedAt: new Date().toISOString(),
          source: 'stripe-webhook',
        })
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const stateId = subscription.metadata?.state ?? null
        if (!stateId) break

        const { expiresAt, graceUntil } = subscriptionDates(subscription)
        await upsertBillingEntitlement(basePath, {
          state: stateId,
          plan: 'desktop-public-beta',
          customerEmail: null,
          checkoutSessionId: null,
          customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          entitlementStatus: deriveEntitlementStatus(subscription.status),
          activatedAt: new Date().toISOString(),
          expiresAt,
          graceUntil,
          updatedAt: new Date().toISOString(),
          source: 'stripe-webhook',
        })
        break
      }
      default:
        break
    }

    await markBillingEventProcessed(basePath, event.id)

    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook verification failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
