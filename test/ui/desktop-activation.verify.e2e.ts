import { expect, test } from '@playwright/test'
import {
  browserFetchJson,
  getVerificationBaseUrl,
  openAuthenticatedWorkbench,
  getVerificationCredentials,
  startBrowserEvidence,
} from './helpers/verification'

test.describe('desktop-activation', () => {
  test('completes the deterministic checkout return flow and activates local entitlement', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'desktop-activation')

    try {
      await evidence.withinBoundary('UI', 'authenticate the desktop verifier in the hosted app shell', async () => {
        await openAuthenticatedWorkbench(page)
      })

      const { email } = getVerificationCredentials()

      const checkoutSession = await evidence.withinBoundary('client -> API', 'start desktop auth and checkout through real API routes', async () => {
        const authSession = await browserFetchJson(page, '/api/desktop/auth/start', {
          method: 'POST',
        })
        expect(authSession.ok).toBe(true)
        expect(authSession.status).toBe(200)
        const authUrl = new URL(String((authSession.body as { authUrl?: string } | null)?.authUrl))
        expect(authUrl.searchParams.get('source')).toBe('desktop')
        expect(authUrl.searchParams.get('state')).toBeTruthy()

        const checkoutStart = await browserFetchJson(page, '/api/desktop/checkout/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        expect(checkoutStart.ok).toBe(true)
        expect(checkoutStart.status).toBe(200)
        expect(String((checkoutStart.body as { checkoutUrl?: string } | null)?.checkoutUrl)).toContain('/desktop/checkout/mock')
        return checkoutStart.body as { checkoutUrl: string }
      })

      await evidence.withinBoundary('response -> UI', 'render the mock checkout and activation ready states', async () => {
        const checkoutUrl = new URL(checkoutSession.checkoutUrl, getVerificationBaseUrl())
        checkoutUrl.protocol = new URL(getVerificationBaseUrl()).protocol
        checkoutUrl.host = new URL(getVerificationBaseUrl()).host
        await page.goto(checkoutUrl.toString())
        await expect(page.getByTestId('verification-checkout-plan')).toHaveText('desktop-public-beta')
        await expect(page.getByTestId('verification-checkout-email')).toHaveText(email)

        const resolveResponse = page.waitForResponse(response =>
          response.url().includes('/api/desktop/checkout/resolve')
          && response.request().method() === 'GET'
          && response.ok(),
        )

        await Promise.all([
          resolveResponse,
          page.getByTestId('verification-checkout-complete').click(),
        ])

        await expect(page.getByTestId('desktop-activate-ready')).toBeVisible()
        await expect(page.getByTestId('desktop-activate-open-desktop')).toHaveAttribute('href', /thredos:\/\/activate/)
      })

      await evidence.withinBoundary('data -> response', 'resolve the active local entitlement state', async () => {
        const entitlementResponse = await page.goto('/api/desktop/entitlement')
        expect(entitlementResponse?.ok()).toBe(true)
        expect(entitlementResponse?.status()).toBe(200)
        const entitlement = await entitlementResponse!.json() as { effectiveStatus?: string, state?: { customerEmail?: string } }
        expect(entitlement.effectiveStatus).toBe('active')
        expect(entitlement.state?.customerEmail).toBe(email)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
