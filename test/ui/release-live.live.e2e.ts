import { expect, test } from '@playwright/test'
import {
  getVerificationBaseUrl,
  getVerificationCredentials,
  loginAsVerifier,
  startBrowserEvidence,
} from './helpers/verification'

test.describe.configure({ mode: 'serial' })

test.describe('release-live', () => {
  test('verifier account can authenticate against the hosted release', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'release-live-auth')

    try {
      await evidence.withinBoundary('client -> API', 'authenticate the hosted verifier account', async () => {
        await loginAsVerifier(page)
      })
      await evidence.withinBoundary('response -> UI', 'render the hosted workbench shell', async () => {
        await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })

  test('desktop checkout start returns a live checkout URL and the landing page opens', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'release-live-checkout')

    try {
      await evidence.withinBoundary('UI', 'enter the hosted workbench as the verifier user', async () => {
        await loginAsVerifier(page)
      })

      const api = page.context().request
      const baseUrl = getVerificationBaseUrl()
      const { email } = getVerificationCredentials()

      const session = await evidence.withinBoundary('client -> API', 'create a live desktop checkout session', async () => {
        const response = await api.post(`${baseUrl}/api/desktop/checkout/start`, {
          data: { email },
        })
        expect(response.ok()).toBe(true)
        return await response.json()
      })

      await evidence.withinBoundary('response -> UI', 'open the live Stripe checkout landing page', async () => {
        expect(typeof session.checkoutUrl).toBe('string')
        await page.goto(session.checkoutUrl, { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/stripe\.com|buy\.stripe\.com|checkout\.stripe\.com/)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
