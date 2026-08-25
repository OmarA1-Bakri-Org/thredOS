import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const screenshotOptions = {
  fullPage: false,
  animations: 'disabled' as const,
  maxDiffPixelRatio: 0.015,
}

async function expectStableScreenshot(page: Page, name: string, fullPage = false) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
  await expect(page).toHaveScreenshot(name, {
    ...screenshotOptions,
    fullPage,
  })
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

    await expect(page).toHaveTitle('thredOS Desktop')
    await expect(page.getByText('Desktop public beta')).toBeVisible()
    await expect(page.getByText('Local-first posture')).toBeVisible()

    await expectStableScreenshot(page, 'entry-surface.png', true)
  })

  test('desktop activation return visual baseline', async ({ page }) => {
    await page.goto('/desktop/activate?status=cancelled&state=demo')

    await expect(page.getByRole('heading', { name: 'Finish activating thredOS Desktop.' })).toBeVisible()
    await expect(page.getByText('Checkout was cancelled.')).toBeVisible()

    await expectStableScreenshot(page, 'desktop-activate-cancelled.png', true)
  })

  test('app workbench opens and captures hierarchy baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible()
    await expect(page.getByTestId('topbar-status-summary')).toBeVisible()
    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()

    await expectStableScreenshot(page, 'app-workbench-hierarchy.png')
  })

  test('run section visual baseline', async ({ page }) => {
    await page.goto('/app')

    await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()
    await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click()
    await expect(page.getByTestId('run-section')).toBeVisible()

    await expectStableScreenshot(page, 'app-run-section.png')
  })

  test('responsive drawer visual baseline at desktop minimum width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/app')

    const openDrawer = page.getByLabel('Open thread navigator')
    await expect(openDrawer).toBeVisible()
    await openDrawer.click()
    await expect(page.locator('[data-workbench-region="left-rail-drawer-panel"]')).toBeVisible()

    await expectStableScreenshot(page, 'app-drawer-1200.png')
  })

  test('top bar confirmation dialogs have visual baselines', async ({ page }) => {
    await page.goto('/app')
    const primaryActions = page.locator('[data-workbench-cluster="primary-actions"]')

    await primaryActions.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await expectStableScreenshot(page, 'app-new-thread-dialog.png')
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()

    await primaryActions.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await expectStableScreenshot(page, 'app-run-confirm-dialog.png')
  })

  test('create node dialog and chat panel have visual baselines', async ({ page }) => {
    await page.goto('/app')
    const primaryActions = page.locator('[data-workbench-cluster="primary-actions"]')

    await primaryActions.getByRole('button', { name: 'Step', exact: true }).click()
    await expect(page.getByTestId('create-node-dialog')).toBeVisible()
    await expectStableScreenshot(page, 'app-create-step-dialog.png')

    await page.getByTestId('create-node-kind-gate').click()
    await expectStableScreenshot(page, 'app-create-gate-dialog.png')

    await page.getByTestId('create-node-dialog').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('create-node-dialog')).toBeHidden()

    await primaryActions.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expectStableScreenshot(page, 'app-chat-panel.png')
  })

  test('sequence interaction states have visual baselines', async ({ page }) => {
    await page.goto('/app')

    await openAccordionSection(page, 'sequence')
    await expect(page.getByTestId('sequence-section')).toBeVisible()
    await expectStableScreenshot(page, 'app-sequence-section.png')

    await page.getByTitle('Edit sequence name').click()
    await expect(page.getByLabel('Sequence name')).toBeVisible()
    await expectStableScreenshot(page, 'app-sequence-edit-name.png')
  })

  test('node and agent cards have visual baselines across interactive states', async ({ page }) => {
    await page.goto('/app')

    await selectFirstPhase(page)
    await openAccordionSection(page, 'node')
    await expect(page.getByTestId('node-section')).toBeVisible()
    await expect(page.getByTestId('agent-top-trump-card')).toBeVisible()

    await expectStableScreenshot(page, 'app-node-agent-overview.png')

    await page.getByTestId('node-panel-assets').click()
    await expect(page.getByText('Prompt drafts')).toBeVisible()
    await expectStableScreenshot(page, 'app-node-assets.png')

    await page.getByTestId('node-agent-card-tab-prompt').click()
    await expectStableScreenshot(page, 'app-agent-prompt-summary.png')

    await page.getByRole('button', { name: 'Open editor' }).first().click()
    await expectStableScreenshot(page, 'app-agent-prompt-editor.png')

    await page.getByTestId('node-agent-card-tab-skills').click()
    await expectStableScreenshot(page, 'app-agent-skills-summary.png')
  })

  test('surface cards deep-link into panel state', async ({ page }) => {
    await page.goto('/app')

    const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
    await expect(surfaceNode).toBeVisible()
    await surfaceNode.click()

    await expect(page.getByTestId('agent-detail-card')).toBeVisible()
    await expect(page.getByTestId('node-detail-card')).toBeVisible()
    await expect(page.getByTestId('agent-detail-register')).toBeVisible()

    await page.getByTestId('agent-detail-link-skills').click()
    await openAccordionSection(page, 'agent')
    await expect(page.getByTestId('agent-tab-workshop')).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('agent-card-tab-skills')).toHaveAttribute('data-active', 'true')

    await page.getByTestId('node-detail-link-assets').click()
    await openAccordionSection(page, 'node')
    await expect(page.getByTestId('node-panel-assets')).toHaveAttribute('data-active', 'true')
  })

  test('agent section tabs have visual baselines', async ({ page }) => {
    await page.goto('/app')

    await selectFirstPhase(page)
    await openAccordionSection(page, 'agent')
    await expect(page.getByTestId('agent-section')).toBeVisible()

    await page.getByTestId('agent-tab-roster').click()
    await expectStableScreenshot(page, 'app-agent-roster.png')

    await page.getByTestId('agent-tab-tools').click()
    await expectStableScreenshot(page, 'app-agent-tools-tab.png')
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
