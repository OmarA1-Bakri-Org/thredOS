import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Main Page', () => {
  test('smoke: landing page opens the thredOS app surface', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('thredOS')
    await expect(page.getByText('thredOS Desktop public beta')).toBeVisible()

    const entryButton = page.getByRole('button', { name: /Open thredOS|Activate Desktop|Open Desktop Surface|Sign In/i })
    await expect(entryButton).toBeVisible()
    await entryButton.click()

    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByPlaceholder('Search threads, nodes, prompts, skills')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run' }).first()).toBeVisible()
  })

  test('a11y: landing page has no critical or serious axe violations', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('thredOS Desktop public beta')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    const impactful = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )

    expect(impactful).toEqual([])
  })
})
