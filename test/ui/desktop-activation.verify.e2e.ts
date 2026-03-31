import { expect, test } from '@playwright/test'
import {
  getVerificationBaseUrl,
  getVerificationCredentials,
  loginAsVerifier,
  startBrowserEvidence,
} from './helpers/verification'

test.describe('desktop-activation', () => {
  test('completes the deterministic checkout return flow and activates local entitlement', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'desktop-activation')

    try {
      await evidence.withinBoundary('UI', 'authenticate the desktop verifier in the hosted app shell', async () => {
        await loginAsVerifier(page)
      })

      const api = page.context().request
      const baseUrl = getVerificationBaseUrl()
      const { email } = getVerificationCredentials()

      const checkoutSession = await evidence.withinBoundary('client -> API', 'start desktop auth and checkout through real API routes', async () => {
        const authStart = await api.post(`${baseUrl}/api/desktop/auth/start`)
        expect(authStart.ok()).toBe(true)
        const authSession = await authStart.json()
        expect(String(authSession.authUrl)).toContain('/login?source=desktop')

        const checkoutStart = await api.post(`${baseUrl}/api/desktop/checkout/start`, {
          data: { email },
        })
        expect(checkoutStart.ok()).toBe(true)
        const session = await checkoutStart.json()
        expect(String(session.checkoutUrl)).toContain('/desktop/checkout/mock')
        return session
      })

      await evidence.withinBoundary('response -> UI', 'render the mock checkout and activation ready states', async () => {
        await page.goto(checkoutSession.checkoutUrl)
        await expect(page.getByTestId('verification-checkout-plan')).toHaveText('desktop-public-beta')
        await expect(page.getByTestId('verification-checkout-email')).toHaveText(email)

        const resolveResponse = page.waitForResponse(response =>
          response.url().includes('/api/desktop/checkout/resolve')
          && response.request().method() === 'GET'
          && response.ok(),
        )

        await page.getByTestId('verification-checkout-complete').click()
        await resolveResponse

        await expect(page.getByTestId('desktop-activate-ready')).toBeVisible()
        await expect(page.getByTestId('desktop-activate-open-desktop')).toHaveAttribute('href', /thredos:\/\/activate/)
      })

      await evidence.withinBoundary('data -> response', 'resolve the active local entitlement state', async () => {
        const entitlementResponse = await api.get(`${baseUrl}/api/desktop/entitlement`)
        expect(entitlementResponse.ok()).toBe(true)
        const entitlement = await entitlementResponse.json()
        expect(entitlement.effectiveStatus).toBe('active')
        expect(entitlement.state.customerEmail).toBe(email)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
