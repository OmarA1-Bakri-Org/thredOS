import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const screenshotOptions = {
  fullPage: true,
  animations: 'disabled' as const,
  maxDiffPixelRatio: 0.015,
}

async function expectNoCriticalOrSeriousAxe(page: Page, include?: string) {
  let builder = new AxeBuilder({ page })
  if (include) {
    builder = builder.include(include)
  }
  const results = await builder.analyze()
  const impactful = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(impactful).toEqual([])
}

async function openAccordionSection(page: Page, key: string) {
  const openSection = page.getByTestId(`accordion-open-${key}`)
  if (!(await openSection.isVisible().catch(() => false))) {
    await page.getByTestId(`accordion-tab-${key}`).click()
  }
  await expect(openSection).toBeVisible()
}

async function selectFirstPhase(page: Page) {
  await openAccordionSection(page, 'phase')
  const phaseOptions = page.locator('[data-testid^="phase-option-"]')
  await expect(phaseOptions.first()).toBeVisible()
  await phaseOptions.first().click()
}

test.describe('thredOS Desktop launch surfaces', () => {
  test('entry surface visual baseline', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('thredOS')
    await expect(page.getByText('thredOS Desktop public beta')).toBeVisible()
    await expect(page.getByText('Local-first posture')).toBeVisible()

    await expect(page).toHaveScreenshot('entry-surface.png', screenshotOptions)
  })

  test('desktop activation return visual baseline', async ({ page }) => {
    await page.goto('/desktop/activate?status=cancelled&state=demo')

    await expect(page.getByRole('heading', { name: 'Finish activating thredOS Desktop.' })).toBeVisible()
    await expect(page.getByText('Checkout was cancelled.')).toBeVisible()

    await expect(page).toHaveScreenshot('desktop-activate-cancelled.png', screenshotOptions)
  })

  test('app workbench opens and captures hierarchy baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
    await expect(page.getByTestId('topbar-status-summary')).toBeVisible()
    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()

    await expect(page).toHaveScreenshot('app-workbench-hierarchy.png', screenshotOptions)
  })

  test('run section visual baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()
    await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click()
    await expect(page.getByTestId('run-section')).toBeVisible()

    await expect(page).toHaveScreenshot('app-run-section.png', screenshotOptions)
  })

  test('responsive drawer visual baseline at desktop minimum width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/app')

    const openDrawer = page.getByLabel('Open thread navigator')
    await expect(openDrawer).toBeVisible()
    await openDrawer.click()
    await expect(page.locator('[data-workbench-region="left-rail-drawer-panel"]')).toBeVisible()

    await expect(page).toHaveScreenshot('app-drawer-1200.png', screenshotOptions)
  })

  test('top bar confirmation dialogs have visual baselines', async ({ page }) => {
    await page.goto('/app')
    const primaryActions = page.locator('[data-workbench-cluster="primary-actions"]')

    await primaryActions.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await expect(page).toHaveScreenshot('app-new-thread-dialog.png', screenshotOptions)
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()

    await primaryActions.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await expect(page).toHaveScreenshot('app-run-confirm-dialog.png', screenshotOptions)
  })

  test('create node dialog and chat panel have visual baselines', async ({ page }) => {
    await page.goto('/app')
    const primaryActions = page.locator('[data-workbench-cluster="primary-actions"]')

    await primaryActions.getByRole('button', { name: 'Step', exact: true }).click()
    await expect(page.getByTestId('create-node-dialog')).toBeVisible()
    await expect(page).toHaveScreenshot('app-create-step-dialog.png', screenshotOptions)

    await page.getByTestId('create-node-kind-gate').click()
    await expect(page).toHaveScreenshot('app-create-gate-dialog.png', screenshotOptions)

    await page.getByTestId('create-node-dialog').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('create-node-dialog')).toBeHidden()

    await primaryActions.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expect(page).toHaveScreenshot('app-chat-panel.png', screenshotOptions)
  })

  test('sequence interaction states have visual baselines', async ({ page }) => {
    await page.goto('/app')

    await openAccordionSection(page, 'sequence')
    await expect(page.getByTestId('sequence-section')).toBeVisible()
    await expect(page).toHaveScreenshot('app-sequence-section.png', screenshotOptions)

    await page.getByTitle('Edit sequence name').click()
    await expect(page.getByLabel('Sequence name')).toBeVisible()
    await expect(page).toHaveScreenshot('app-sequence-edit-name.png', screenshotOptions)
  })

  test('node and agent cards have visual baselines across interactive states', async ({ page }) => {
    await page.goto('/app')

    await selectFirstPhase(page)
    await openAccordionSection(page, 'node')
    await expect(page.getByTestId('node-section')).toBeVisible()
    await expect(page.getByTestId('agent-top-trump-card')).toBeVisible()

    await expect(page).toHaveScreenshot('app-node-agent-overview.png', screenshotOptions)

    await page.getByTestId('node-panel-prompt').click()
    await expect(page.getByText('Prompt drafts')).toBeVisible()
    await expect(page).toHaveScreenshot('app-node-prompt-assets.png', screenshotOptions)

    await page.getByTestId('node-panel-skills').click()
    await page.getByTestId('agent-card-tab-tools').click()
    await expect(page).toHaveScreenshot('app-node-skills-agent-tools.png', screenshotOptions)
  })

  test('agent section tabs have visual baselines', async ({ page }) => {
    await page.goto('/app')

    await selectFirstPhase(page)
    await openAccordionSection(page, 'agent')
    await expect(page.getByTestId('agent-section')).toBeVisible()

    await page.getByTestId('agent-tab-roster').click()
    await expect(page).toHaveScreenshot('app-agent-roster.png', screenshotOptions)

    await page.getByTestId('agent-tab-tools').click()
    await expect(page).toHaveScreenshot('app-agent-tools-tab.png', screenshotOptions)
  })

  test('a11y: entry, app, and interactive overlays have no critical or serious axe violations', async ({ page }) => {
    await page.goto('/')
    await expectNoCriticalOrSeriousAxe(page)

    await page.goto('/app')
    const primaryActions = page.locator('[data-workbench-cluster="primary-actions"]')
    await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
    await expectNoCriticalOrSeriousAxe(page)

    await primaryActions.getByRole('button', { name: 'Step', exact: true }).click()
    await expect(page.getByTestId('create-node-dialog')).toBeVisible()
    await expectNoCriticalOrSeriousAxe(page)
    await page.getByTestId('create-node-dialog').getByRole('button', { name: 'Close' }).click()

    await primaryActions.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expectNoCriticalOrSeriousAxe(page)
  })
})
