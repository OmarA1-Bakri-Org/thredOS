import { expect, test } from '@playwright/test'
import { join, resolve } from 'node:path'
import type { AgentRegistration } from '../../lib/agents/types'
import type { RunProjection } from '../../lib/runtime/service-types'
import type { Sequence } from '../../lib/sequence/schema'
import { assertVerificationCliFixture } from '../../scripts/verify/cli-fixture'
import {
  expectNoFrameworkOverlay,
  openAuthenticatedWorkbench,
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

        await openAuthenticatedWorkbench(page)
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
        await openAuthenticatedWorkbench(page)
        await openAccordionSection(page, 'sequence')
        await expect(page.getByTestId('sequence-section')).toBeVisible()
        await expect(page.getByTestId('sequence-section').getByText('Verification Sequence').first()).toBeVisible()
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
        await expect(page.getByTestId('sequence-section').getByText('Verification Sequence Draft').first()).toBeVisible()
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
        await expect(page.getByTestId('sequence-section').getByText('Verification Sequence').first()).toBeVisible()
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
        await openAuthenticatedWorkbench(page)
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
        await openAuthenticatedWorkbench(page)
        await selectFirstPhase(page)
        await openAccordionSection(page, 'node')

        await page.getByTestId('node-panel-assets').click()
        await expect(page.getByText('Prompt drafts')).toBeVisible()

        await openAccordionSection(page, 'agent')
        await expect(page.getByTestId('agent-section')).toBeVisible()
      })

      await evidence.withinBoundary('response -> UI', 'render prompt and skill surfaces from the agent card', async () => {
        const agentSection = page.getByTestId('agent-section')
        await agentSection.getByTestId('agent-card-tab-prompt').click()
        await expect(agentSection.getByText('Selected prompt')).toBeVisible()
        await expect(agentSection.getByRole('button', { name: 'Open editor' }).first()).toBeVisible()

        await agentSection.getByTestId('agent-card-tab-skills').click()
        await expect(agentSection.getByText('Selected skills')).toBeVisible()
        await expect(agentSection.getByTestId('selected-skills')).toBeVisible()
        await expect(agentSection.getByTestId('tooling-section')).toBeVisible()
        await expect(agentSection.getByTestId('tool-option-files')).toBeVisible()
        await expect(agentSection.getByTestId('tool-option-browser')).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })
})

test.describe('run-chat-runtime', () => {
  test('records SAFE runtime approvals and trace events, then keeps chat interactive without framework errors', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'run-chat-runtime')
    const stepId = 'orch-orchestrator'
    let originalAssignment: string | null = null
    let originalStatus: string | undefined
    let assignmentChanged = false
    let registeredAgent: AgentRegistration
    let runId: string

    try {
      // Run all confirms SAFE execution. Verify the fixed local CLI before any mutation.
      assertVerificationCliFixture()
      const webServer = testInfo.config.webServer
      if (!webServer || webServer.reuseExistingServer !== false || !webServer.env
        || !webServer.command.includes('scripts/verify/web-server.mjs')) {
        throw new Error('The runtime verification requires its own server with an explicit fixture environment')
      }
      assertVerificationCliFixture({ ...process.env, ...webServer.env })
      expect(webServer.env.THREDOS_VERIFY_CLI_FIXTURE_DIR).toBe(process.env.THREDOS_VERIFY_CLI_FIXTURE_DIR)
      const workspace = process.env.THREDOS_BASE_PATH ?? process.env.THREADOS_BASE_PATH
      const artifacts = testInfo.config.metadata.artifactsDir
      if (!workspace || typeof artifacts !== 'string' || resolve(workspace) !== resolve(join(artifacts, 'workspace'))) {
        throw new Error('The runtime verification requires a fresh workspace copied into its own artifacts directory')
      }
      const readiness = await page.request.get('/api/readiness')
      expect(readiness.status()).toBe(200)
      expect(await readiness.json()).toMatchObject({ ready: true, basePath: workspace })
      await openAuthenticatedWorkbench(page)
      await evidence.withinBoundary('client -> API', 'register and assign the known orchestrator through the real APIs', async () => {
        const sequenceResponse = await page.request.get('/api/sequence')
        expect(sequenceResponse.status()).toBe(200)
        const sequence = await sequenceResponse.json() as Sequence
        const step = sequence.steps.find(candidate => candidate.id === stepId)
        expect(step).toMatchObject({
          id: stepId,
          model: 'claude-code',
          role: 'orchestrator',
          prompt_ref: { id: stepId, version: 1, path: `.threados/prompts/${stepId}.md` },
        })
        originalAssignment = step!.assigned_agent_id ?? step!.agent_ref ?? null
        originalStatus = step!.status
        const registrationResponse = await page.request.post('/api/agents', {
          data: {
            id: 'verify-runtime-orchestrator', name: 'Verification runtime orchestrator',
            builderId: 'verification-fixture', builderName: 'Verification fixture',
            model: step!.model, role: step!.role, promptRef: step!.prompt_ref,
            tools: [], skills: [], skillRefs: [],
          },
        })
        expect(registrationResponse.status()).toBe(201)
        const registration = await registrationResponse.json() as { agent: AgentRegistration }
        registeredAgent = registration.agent
        expect(registeredAgent.id).toBe('verify-runtime-orchestrator')
        expect(registeredAgent.version).toBeGreaterThan(0)
        expect(registeredAgent.composition?.identityHash).toMatch(/^[a-f0-9]{64}$/)
        const assignmentResponse = await page.request.post('/api/step', {
          data: { action: 'edit', stepId, assignedAgentId: registeredAgent.id },
        })
        expect(assignmentResponse.status()).toBe(200)
        assignmentChanged = true
      })

      await evidence.withinBoundary('UI', 'open the run section and confirm a runnable dispatch', async () => {
        await openAuthenticatedWorkbench(page)

        await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click()
        await expect(page.getByTestId('run-section')).toBeVisible()

        await page.getByRole('button', { name: 'Run all', exact: true }).click()
        await expect(page.getByTestId('confirm-dialog')).toBeVisible()
      })

      await evidence.withinBoundary('client -> API', 'dispatch the runnable frontier through the canonical async runtime route', async () => {
        const runResponse = page.waitForResponse(response =>
          response.url().endsWith('/api/runs')
          && response.request().method() === 'POST'
          && response.ok(),
        )
        await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Run all' }).click()
        const response = await runResponse
        expect(response.status()).toBe(202)
        const projection = await response.json() as RunProjection
        expect(projection.source).toBe('v2')
        expect(projection.run?.id).toBeTruthy()
        runId = projection.run.id
        expect([
          'pending',
          'provisioning',
          'running',
          'awaiting_review',
          'applying',
          'successful',
          'partially_successful',
          'failed',
          'cancelled',
          'interrupted',
        ]).toContain(projection.run?.status)
      })

      await evidence.withinBoundary('API -> data', 'verify the persisted run and attempt use the registered identity', async () => {
        await expect.poll(async () => {
          const response = await page.request.get(`/api/runs/${runId}`)
          expect(response.status()).toBe(200)
          const projection = await response.json() as RunProjection
          return projection.attempts.find(attempt => attempt.step_id === stepId)?.agent_registration
        }).toMatchObject({
          registration_id: registeredAgent.id,
          registration_version: registeredAgent.version,
          composition_hash: registeredAgent.composition!.identityHash,
        })
        const response = await page.request.get(`/api/runs/${runId}`)
        expect(response.status()).toBe(200)
        const projection = await response.json() as RunProjection
        expect(projection.run.agent_registrations?.[stepId]).toMatchObject({
          registration_id: registeredAgent.id,
          registration_version: registeredAgent.version,
          composition_hash: registeredAgent.composition!.identityHash,
        })
      })

      await evidence.withinBoundary('response -> UI', 'surface the recorded control-plane state and keep chat interactive', async () => {
        await expect(page.getByTestId('run-control-plane')).toBeVisible()
        await expect(page.getByTestId('run-approval-count')).not.toHaveText('0')
        await expect(page.getByTestId('run-trace-count')).not.toHaveText('0')
        await page.getByRole('button', { name: 'Chat', exact: true }).click()
        await expect(page.getByTestId('chat-panel')).toBeVisible()
        await expectNoFrameworkOverlay(page)
      })
    } finally {
      try {
        if (assignmentChanged) {
          const response = await page.request.post('/api/step', {
            data: { action: 'edit', stepId, assignedAgentId: originalAssignment, status: originalStatus },
          })
          expect(response.status()).toBe(200)
        }
      } finally {
        await evidence.finalize()
      }
    }
  })
})
