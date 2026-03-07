import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Main Page', () => {
  test('smoke: renders key toolbar controls', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('ThreadOS')
    await expect(page.getByText('ThreadOS').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run Runnable' })).toBeVisible()
    await expect(page.getByPlaceholder('Search steps...')).toBeVisible()
  })

  test('a11y: has no critical or serious axe violations', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Run Runnable' })).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    const impactful = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )

    expect(impactful).toEqual([])
  })
})
