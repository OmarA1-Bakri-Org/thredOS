import Stripe from 'stripe'
import { getClerkSignUpUrl } from './config'
import {
  buildDesktopBrowserReturnUrl,
  getDesktopLocalAppUrl,
  getDesktopReturnUrl,
  getStripeCheckoutMode,
  getStripePriceId,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from './config'
import type { ActivationTokenPayload, EntitlementStatus } from '@/lib/local-first/types'

let cachedStripeClient: Stripe | null | undefined

function getStripeClient(): Stripe | null {
  if (cachedStripeClient !== undefined) return cachedStripeClient
  const secretKey = getStripeSecretKey()
  cachedStripeClient = secretKey ? new Stripe(secretKey) : null
  return cachedStripeClient
}

function unixToIso(value: number | null | undefined): string | null {
  if (!value || Number.isNaN(value)) return null
  return new Date(value * 1000).toISOString()
}

function buildGraceUntil(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const parsed = Date.parse(expiresAt)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed + 14 * 24 * 60 * 60 * 1000).toISOString()
}

function mapSubscriptionStatusToEntitlement(status: string | null | undefined): Extract<EntitlementStatus, 'pending' | 'active' | 'grace' | 'expired'> {
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

export interface StripeCheckoutResolution {
  session: Stripe.Checkout.Session
  subscription: Stripe.Subscription | null
  payload: ActivationTokenPayload
  entitlementStatus: Extract<EntitlementStatus, 'pending' | 'active' | 'grace' | 'expired'>
}

export async function createDesktopCheckoutSession(input: {
  origin: string
  state: string
  customerEmail?: string | null
  plan: 'desktop-public-beta'
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient()
  const priceId = getStripePriceId()
  if (!stripe || !priceId) {
    throw new Error('Stripe checkout is not configured')
  }

  const successUrl = buildDesktopBrowserReturnUrl(input.origin, input.state, {
    local_app: getDesktopLocalAppUrl(),
    return_to: getDesktopReturnUrl(),
    session_id: '{CHECKOUT_SESSION_ID}',
  })
  const cancelUrl = buildDesktopBrowserReturnUrl(input.origin, input.state, {
    local_app: getDesktopLocalAppUrl(),
    return_to: getDesktopReturnUrl(),
    status: 'cancelled',
  })

  const signUpUrl = getClerkSignUpUrl()
  return stripe.checkout.sessions.create({
    mode: getStripeCheckoutMode(),
    customer_email: input.customerEmail ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.state,
    metadata: {
      state: input.state,
      plan: input.plan,
      localAppUrl: getDesktopLocalAppUrl(),
      returnUrl: getDesktopReturnUrl(),
      ...(signUpUrl ? { clerkSignUpUrl: signUpUrl } : {}),
    },
    subscription_data: {
      metadata: {
        state: input.state,
        plan: input.plan,
      },
    },
  })
}

export async function resolveDesktopCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutResolution> {
  const stripe = getStripeClient()
  if (!stripe) {
    throw new Error('Stripe checkout is not configured')
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  })

  const subscription = typeof session.subscription === 'object' && session.subscription
    ? session.subscription as Stripe.Subscription
    : typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : null

  const entitlementStatus = mapSubscriptionStatusToEntitlement(subscription?.status ?? null)
  const activatedAt = new Date().toISOString()
  const expiresAt = unixToIso(subscription?.cancel_at ?? subscription?.ended_at ?? null)
  const graceUntil = buildGraceUntil(expiresAt)

  const payload: ActivationTokenPayload = {
    customerEmail: session.customer_details?.email ?? session.customer_email ?? 'unknown@thredos.local',
    plan: 'desktop-public-beta',
    status: entitlementStatus === 'pending' || entitlementStatus === 'expired' ? 'grace' : entitlementStatus,
    activatedAt,
    lastValidatedAt: activatedAt,
    expiresAt,
    graceUntil,
  }

  return {
    session,
    subscription,
    payload,
    entitlementStatus,
  }
}

export function constructStripeWebhookEvent(payload: string, signature: string): Stripe.Event {
  const stripe = getStripeClient()
  const webhookSecret = getStripeWebhookSecret()
  if (!stripe || !webhookSecret) {
    throw new Error('Stripe webhook verification is not configured')
  }
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
}
