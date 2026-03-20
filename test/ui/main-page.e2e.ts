import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('thredOS Desktop launch surfaces', () => {
  test('entry surface visual baseline', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('thredOS')
    await expect(page.getByText('thredOS Desktop public beta')).toBeVisible()
    await expect(page.getByText('Local-first posture')).toBeVisible()

    await expect(page).toHaveScreenshot('entry-surface.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('desktop activation return visual baseline', async ({ page }) => {
    await page.goto('/desktop/activate?status=cancelled&state=demo')

    await expect(page.getByRole('heading', { name: 'Finish activating thredOS Desktop.' })).toBeVisible()
    await expect(page.getByText('Checkout was cancelled.')).toBeVisible()

    await expect(page).toHaveScreenshot('desktop-activate-cancelled.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('app workbench opens and captures hierarchy baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
    await expect(page.getByTestId('topbar-status-summary')).toBeVisible()
    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()

    await expect(page).toHaveScreenshot('app-workbench-hierarchy.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('run section visual baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()
    await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click()
    await expect(page.getByTestId('run-section')).toBeVisible()

    await expect(page).toHaveScreenshot('app-run-section.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('responsive drawer visual baseline at desktop minimum width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/app')

    const openDrawer = page.getByLabel('Open thread navigator')
    await expect(openDrawer).toBeVisible()
    await openDrawer.click()
    await expect(page.locator('[data-workbench-region="left-rail-drawer-panel"]')).toBeVisible()

    await expect(page).toHaveScreenshot('app-drawer-1200.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('a11y: entry and app surfaces have no critical or serious axe violations', async ({ page }) => {
    await page.goto('/')
    let results = await new AxeBuilder({ page }).analyze()
    let impactful = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    expect(impactful).toEqual([])

    await page.goto('/app')
    await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
    results = await new AxeBuilder({ page }).analyze()
    impactful = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    expect(impactful).toEqual([])
  })
})
