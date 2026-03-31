import { expect, test } from '@playwright/test'
import {
  expectNoFrameworkOverlay,
  startBrowserEvidence,
  submitVerifierCredentials,
} from './helpers/verification'

test.describe('entry-auth', () => {
  test('hosted entry surface routes the verifier through login into the workbench', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'entry-auth')

    try {
      await evidence.withinBoundary('UI', 'open the hosted entry surface', async () => {
        await page.goto('/')

        await expect(page.getByText('Desktop public beta')).toBeVisible()
        await expect(page.getByTestId('entry-primary-thredos')).toBeVisible()

        await page.getByTestId('entry-primary-thredos').click()
        await expect(page).toHaveURL(/\/login\?next=%2Fapp/)
      })

      const loginResponse = await evidence.withinBoundary('client -> API', 'submit verifier login', async () => {
        return await submitVerifierCredentials(page)
      })
      expect(loginResponse.ok()).toBe(true)

      await evidence.withinBoundary('response -> UI', 'render the workbench shell after login', async () => {
        await expect(page).toHaveURL(/\/app/)
        await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
        await expectNoFrameworkOverlay(page)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
