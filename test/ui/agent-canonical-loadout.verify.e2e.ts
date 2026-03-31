import { expect, test, type Request } from '@playwright/test'
import {
  loginAsVerifier,
  openAccordionSection,
  selectFirstPhase,
  startBrowserEvidence,
} from './helpers/verification'

function parseJsonBody(request: Request): Record<string, unknown> {
  return JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
}

test.describe('agent-canonical-loadout', () => {
  test('registering from the detail card sends canonical loadout and assignment payloads', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'agent-canonical-loadout')
    const registeredAgents: Array<Record<string, unknown>> = []

    await page.route('**/api/agents', async route => {
      const request = route.request()

      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ agents: registeredAgents }),
        })
        return
      }

      if (request.method() === 'POST') {
        const body = parseJsonBody(request)
        const agentId = String(body.id ?? 'agent-under-test')
        const promptRef = (body.promptRef as Record<string, unknown> | undefined) ?? null
        const skillRefs = Array.isArray(body.skillRefs) ? body.skillRefs : []
        const skillBadges = skillRefs
          .map(ref => (ref && typeof ref === 'object' ? ref as { id?: unknown } : null))
          .filter((ref): ref is { id: string } => typeof ref?.id === 'string')
        const tools = Array.isArray(body.tools) ? body.tools : []
        const role = typeof body.role === 'string' ? body.role : 'reviewer'
        const model = typeof body.model === 'string' ? body.model : 'codex'
        const threadSurfaceIds = Array.isArray(body.threadSurfaceIds) ? body.threadSurfaceIds : []

        const registeredAgent = {
          id: agentId,
          name: body.name ?? 'Agent under test',
          description: body.description ?? 'Browser-verified canonical workflow',
          registeredAt: new Date('2026-03-31T00:00:00.000Z').toISOString(),
          builderId: body.builderId ?? 'playwright',
          builderName: body.builderName ?? 'Playwright',
          threadSurfaceIds,
          model,
          role,
          tools,
          promptRef,
          skillRefs,
          skills: skillBadges.map(ref => ({
            id: ref.id,
            label: ref.id,
            inherited: false,
          })),
          version: 1,
          supersedesAgentId: null,
          composition: {
            model,
            role,
            promptRef,
            skillRefs,
            tools,
            identityHash: 'playwright-agent-hash',
          },
        }

        registeredAgents.splice(0, registeredAgents.length, registeredAgent)

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            agent: registeredAgent,
            materialChange: false,
            reasons: [],
          }),
        })
        return
      }

      await route.continue()
    })

    await page.route('**/api/step', async route => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    try {
      await evidence.withinBoundary('UI', 'open the agent detail card from the selected surface node', async () => {
        await loginAsVerifier(page)
        await selectFirstPhase(page)

        const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
        await expect(surfaceNode).toBeVisible()
        await surfaceNode.click()

        await expect(page.getByTestId('agent-detail-card')).toBeVisible()
        await expect(page.getByTestId('agent-detail-register')).toBeVisible()
        await expect(page.getByText(/New canonical agent|No canonical change|Material change/)).toBeVisible()
      })

      const { registerRequest, assignRequest } = await evidence.withinBoundary('client -> API', 'register the canonical agent and rebind the step', async () => {
        const registerRequestPromise = page.waitForRequest(req => req.url().endsWith('/api/agents') && req.method() === 'POST')
        const assignRequestPromise = page.waitForRequest(req => {
          if (!req.url().endsWith('/api/step') || req.method() !== 'POST') return false
          const body = parseJsonBody(req)
          return body.action === 'edit' && typeof body.assignedAgentId === 'string'
        })

        await page.getByTestId('agent-detail-register').click()

        return {
          registerRequest: await registerRequestPromise,
          assignRequest: await assignRequestPromise,
        }
      })

      const registerBody = parseJsonBody(registerRequest)
      const assignBody = parseJsonBody(assignRequest)

      expect(registerBody.promptRef).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          version: expect.any(Number),
          path: expect.any(String),
        }),
      )
      expect(registerBody.skillRefs).toEqual(expect.any(Array))
      expect((registerBody.skillRefs as Array<unknown>).length).toBeGreaterThan(0)
      expect(registerBody.tools).toEqual(expect.any(Array))
      expect((registerBody.tools as Array<unknown>).length).toBeGreaterThan(0)

      expect(assignBody).toEqual(
        expect.objectContaining({
          action: 'edit',
          stepId: expect.any(String),
          assignedAgentId: expect.any(String),
        }),
      )

      await evidence.withinBoundary('response -> UI', 'show the register success state and linked skills tab', async () => {
        await expect(page.getByText('Registered agent and assigned it to this node.')).toBeVisible()

        await page.getByTestId('agent-detail-link-skills').click()
        await openAccordionSection(page, 'agent')
        await expect(page.getByTestId('agent-card-tab-skills')).toHaveAttribute('data-active', 'true')
      })
    } finally {
      await evidence.finalize()
    }
  })
})
