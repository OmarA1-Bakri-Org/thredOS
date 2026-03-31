# Stripe Live Setup

This document captures the live Stripe configuration for the thredOS Desktop public beta.

## Live Stripe Objects

- Account: `Echoes` (`acct_1R3NUAHhizUkNPnB`)
- Product: `thredOS Desktop Public Beta` (`prod_UBLa5FqZeurykO`)

Launch pricing:

- Founding monthly price: `price_1TENlKHhizUkNPnB0rr4jzsm`
- Founding billing: `USD 19 / month`
- Founding payment link: `https://buy.stripe.com/4gMaEX1Ttfz885y9Q1gIo01`

Standard pricing:

- Standard monthly price: `price_1TENlLHhizUkNPnBi9rCe1sN`
- Standard billing: `USD 39 / month`
- Standard payment link: `https://buy.stripe.com/00wbJ1gOn3Qq71ue6hgIo02`

Legacy price retained in Stripe but no longer used for launch:

- Legacy monthly price: `price_1TCytmHhizUkNPnBezFWanS9`
- Legacy billing: `GBP 29 / month`

The app uses direct Checkout Session creation in code, so the `price_id` is required and the payment links are optional fallback/marketing infrastructure.

## Required App Environment

Set these values in the deployed activation host and any local environment used for billing tests:

- `THREDOS_STRIPE_SECRET_KEY`
- `THREDOS_STRIPE_PUBLISHABLE_KEY`
- `THREDOS_STRIPE_PRICE_ID=price_1TENlKHhizUkNPnB0rr4jzsm`
- `THREDOS_STRIPE_CHECKOUT_MODE=subscription`
- `THREDOS_STRIPE_WEBHOOK_SECRET`

The repo billing code reads these from:

- [lib/commercial/config.ts](/C:/Users/albak/xdev/THREAD-OS/lib/commercial/config.ts)
- [lib/commercial/stripe.ts](/C:/Users/albak/xdev/THREAD-OS/lib/commercial/stripe.ts)

## Webhook Endpoint

Create a Stripe webhook endpoint that points to:

- `https://app.thredos.com/api/webhooks/stripe`

If the activation host is temporarily elsewhere, use that host instead, but keep the path the same:

- `/api/webhooks/stripe`

After creating the endpoint, copy the signing secret into:

- `THREDOS_STRIPE_WEBHOOK_SECRET`

## Required Webhook Events

Enable these webhook events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Those are the events the app currently handles in:

- [app/api/webhooks/stripe/route.ts](/C:/Users/albak/xdev/THREAD-OS/app/api/webhooks/stripe/route.ts)

## Checkout Return Flow

The desktop billing flow is:

1. Desktop app starts checkout with `/api/desktop/checkout/start`
2. App creates a Checkout Session using the live `price_id`
3. Stripe redirects to the hosted browser return route
4. Hosted browser return route resolves the session with `/api/desktop/checkout/resolve`
5. Hosted route sends the browser back into the desktop app with `thredos://activate?...`
6. Desktop app stores the activation state locally

Related code:

- [app/api/desktop/checkout/start/route.ts](/C:/Users/albak/xdev/THREAD-OS/app/api/desktop/checkout/start/route.ts)
- [app/api/desktop/checkout/resolve/route.ts](/C:/Users/albak/xdev/THREAD-OS/app/api/desktop/checkout/resolve/route.ts)
- [components/desktop/DesktopActivateClient.tsx](/C:/Users/albak/xdev/THREAD-OS/components/desktop/DesktopActivateClient.tsx)
- [desktop/main.cjs](/C:/Users/albak/xdev/THREAD-OS/desktop/main.cjs)

## Remaining Manual Dashboard Actions

These steps still require Dashboard access and cannot be completed through the current connector:

1. Reveal the live or test Stripe secret key and set `THREDOS_STRIPE_SECRET_KEY`
2. Reveal the live or test Stripe publishable key and set `THREDOS_STRIPE_PUBLISHABLE_KEY`
3. Create the webhook endpoint at the activation host
4. Copy the webhook signing secret into `THREDOS_STRIPE_WEBHOOK_SECRET`
5. Run one real end-to-end checkout from desktop to browser and back

## Validation Checklist

When the secrets and webhook are in place, verify:

1. `POST /api/desktop/checkout/start` returns a Stripe Checkout URL
2. Browser checkout loads the `thredOS Desktop Public Beta` plan
3. Successful payment lands on the hosted browser return route
4. `/api/desktop/checkout/resolve` returns an activation-ready session
5. Browser deep-links back into `thredos://activate?...`
6. Desktop app shows active entitlement locally
7. Stripe webhook updates billing state on renewals/cancellations
