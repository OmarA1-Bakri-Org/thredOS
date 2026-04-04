import { expect, test } from '@playwright/test'
import {
  startBrowserEvidence,
  submitVerifierCredentials,
  waitForWorkbenchShell,
} from './helpers/verification'

test.describe('entry-auth', () => {
  test('hosted entry surface routes the verifier through login into the workbench', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'entry-auth')

    try {
      await page.context().clearCookies()
      await evidence.withinBoundary('UI', 'open the hosted entry surface', async () => {
        await page.goto('/')

        await expect(page.getByText('Desktop public beta')).toBeVisible()
        await expect(page.getByTestId('entry-primary-thredos')).toBeVisible()

        await page.getByTestId('entry-primary-thredos').click()
        await expect.poll(() => {
          const url = new URL(page.url())
          return `${url.pathname}:${url.searchParams.get('next') ?? ''}`
        }).toBe('/login:/app')
      })

      const loginResponse = await evidence.withinBoundary('client -> API', 'submit verifier login', async () => {
        return await submitVerifierCredentials(page)
      })
      expect(loginResponse.ok()).toBe(true)

      await evidence.withinBoundary('response -> UI', 'render the workbench shell after login', async () => {
        await waitForWorkbenchShell(page)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
