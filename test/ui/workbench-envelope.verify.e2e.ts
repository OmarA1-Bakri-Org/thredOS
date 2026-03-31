import { expect, test } from '@playwright/test'
import {
  expectNoFrameworkOverlay,
  loginAsVerifier,
  openAccordionSection,
  selectFirstPhase,
  startBrowserEvidence,
} from './helpers/verification'

test.describe('workbench-shell', () => {
  test('loads the workbench shell and core runtime data', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'workbench-shell')

    try {
      await evidence.withinBoundary('client -> API', 'load status, sequence, and surface runtime data', async () => {
        const statusResponse = page.waitForResponse(response => response.url().endsWith('/api/status') && response.ok())
        const sequenceResponse = page.waitForResponse(response => response.url().endsWith('/api/sequence') && response.ok())
        const surfaceResponse = page.waitForResponse(response => response.url().endsWith('/api/thread-surfaces') && response.ok())

        await loginAsVerifier(page)
        await Promise.all([statusResponse, sequenceResponse, surfaceResponse])
      })

      await evidence.withinBoundary('response -> UI', 'render the main workbench shell', async () => {
        await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible()
        await expect(page.getByTestId('topbar-status-summary')).toBeVisible()
        await expect(page.getByRole('button', { name: /Step orchestrator, status READY/i })).toBeVisible()
        await expectNoFrameworkOverlay(page)
      })
    } finally {
      await evidence.finalize()
    }
  })
})

test.describe('sequence-authoring', () => {
  test('renames the sequence and restores the original name through the real API', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'sequence-authoring')

    try {
      await evidence.withinBoundary('UI', 'open the sequence panel', async () => {
        await loginAsVerifier(page)
        await openAccordionSection(page, 'sequence')
        await expect(page.getByTestId('sequence-section')).toBeVisible()
        await expect(page.getByText('Verification Sequence')).toBeVisible()
      })

      await evidence.withinBoundary('client -> API', 'rename the sequence through the real API', async () => {
        const renameOnce = page.waitForResponse(response =>
          response.url().endsWith('/api/sequence')
          && response.request().method() === 'POST'
          && response.ok(),
        )
        await page.getByTitle('Edit sequence name').click()
        await page.getByLabel('Sequence name').fill('Verification Sequence Draft')
        await page.getByTitle('Save name').click()
        await renameOnce
      })

      await evidence.withinBoundary('response -> UI', 'render the renamed sequence title', async () => {
        await expect(page.getByText('Verification Sequence Draft')).toBeVisible()
      })

      await evidence.withinBoundary('client -> API', 'restore the original sequence title', async () => {
        const renameBack = page.waitForResponse(response =>
          response.url().endsWith('/api/sequence')
          && response.request().method() === 'POST'
          && response.ok(),
        )
        await page.getByTitle('Edit sequence name').click()
        await page.getByLabel('Sequence name').fill('Verification Sequence')
        await page.getByTitle('Save name').click()
        await renameBack
      })

      await evidence.withinBoundary('response -> UI', 'show the restored sequence title and node creation dialog', async () => {
        await expect(page.getByText('Verification Sequence')).toBeVisible()
        await page.getByRole('button', { name: 'Step', exact: true }).click()
        await expect(page.getByTestId('create-node-dialog')).toBeVisible()
        await page.getByTestId('create-node-kind-gate').click()
        await page.getByTestId('create-node-dialog').getByRole('button', { name: 'Close' }).click()
        await expect(page.getByTestId('create-node-dialog')).toBeHidden()
      })
    } finally {
      await evidence.finalize()
    }
  })
})

test.describe('phase-node-gate', () => {
  test('selects a phase and opens the node, gate, and surface detail panels', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'phase-node-gate')

    try {
      await evidence.withinBoundary('UI', 'open the phase, node, and gate panels', async () => {
        await loginAsVerifier(page)
        await selectFirstPhase(page)

        await openAccordionSection(page, 'node')
        await expect(page.getByTestId('node-section')).toBeVisible()

        await openAccordionSection(page, 'gate')
        await expect(page.getByTestId('gate-section')).toBeVisible()
      })

      await evidence.withinBoundary('response -> UI', 'render node and agent detail cards for the selected surface node', async () => {
        const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
        await surfaceNode.click()
        await expect(page.getByTestId('node-detail-card')).toBeVisible()
        await expect(page.getByTestId('agent-detail-card')).toBeVisible()
        await expectNoFrameworkOverlay(page)
      })
    } finally {
      await evidence.finalize()
    }
  })
})

test.describe('assets-prompts-skills-tools', () => {
  test('opens prompt, asset, skill, and tool surfaces from the selected node', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'assets-prompts-skills-tools')

    try {
      await evidence.withinBoundary('UI', 'open asset and agent panels for the selected node', async () => {
        await loginAsVerifier(page)
        await selectFirstPhase(page)
        await openAccordionSection(page, 'node')

        await page.getByTestId('node-panel-assets').click()
        await expect(page.getByText('Prompt drafts')).toBeVisible()

        await openAccordionSection(page, 'agent')
        await expect(page.getByTestId('agent-section')).toBeVisible()
      })

      await evidence.withinBoundary('response -> UI', 'render prompt and skill surfaces from the agent card', async () => {
        await page.getByTestId('agent-card-tab-prompt').click()
        await expect(page.getByText('Selected prompt')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Open editor' }).first()).toBeVisible()

        await page.getByTestId('agent-card-tab-skills').click()
        await expect(page.getByText('Selected skills')).toBeVisible()
        await expect(page.getByRole('button', { name: /Files/i })).toBeVisible()
        await expect(page.getByRole('button', { name: /Browser/i })).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })
})

test.describe('run-chat-runtime', () => {
  test('opens the run section, confirm dialog, and chat panel without framework errors', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'run-chat-runtime')

    try {
      await evidence.withinBoundary('UI', 'open the run section and chat panel', async () => {
        await loginAsVerifier(page)

        await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click()
        await expect(page.getByTestId('run-section')).toBeVisible()

        await page.getByRole('button', { name: 'Run', exact: true }).click()
        await expect(page.getByTestId('confirm-dialog')).toBeVisible()
        await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click()

        await page.getByRole('button', { name: 'Chat', exact: true }).click()
        await expect(page.getByTestId('chat-panel')).toBeVisible()
      })

      await evidence.withinBoundary('response -> UI', 'keep the runtime surfaces interactive without framework overlays', async () => {
        await expectNoFrameworkOverlay(page)
      })
    } finally {
      await evidence.finalize()
    }
  })
})
