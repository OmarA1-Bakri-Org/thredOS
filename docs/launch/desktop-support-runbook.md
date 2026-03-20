# thredOS Desktop Support Runbook

## Activation failure

1. Confirm `THREDOS_ACTIVATION_SECRET` matches between activation issuer and desktop app.
2. Check `/api/desktop/checkout/resolve` for a `409` or provider error.
3. If Stripe checkout succeeded but activation failed, re-open the browser return URL and resolve the checkout session again.

## Payment succeeded but app did not unlock

1. Confirm the browser reached `/desktop/activate`.
2. Confirm the deep link opened `thredos://activate?...`.
3. Inspect `.threados/state/desktop-entitlement.json` in the user workspace.
4. Re-run entitlement refresh from the desktop client or `POST /api/desktop/entitlement`.

## Entitlement stuck in pending, grace, or expired

1. Inspect `.threados/state/desktop-billing.json`.
2. Reprocess the Stripe subscription webhook if the subscription state changed after checkout.
3. Check the stored expiry and grace timestamps against the current clock.
4. If the subscription is active again, issue a fresh activation token and re-run activation completion.

## Webhook replay or recovery

1. Confirm the webhook signature secret matches `THREDOS_STRIPE_WEBHOOK_SECRET`.
2. Replay the missed Stripe event from the Stripe dashboard.
3. Verify the event id is not already recorded in `.threados/state/desktop-billing.json`.
4. Re-check billing entitlement state after replay.
