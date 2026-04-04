import { expect, test, type Page, type Request } from '@playwright/test'
import {
  openAuthenticatedWorkbench,
  openAccordionSection,
  selectFirstPhase,
  startBrowserEvidence,
} from './helpers/verification'

const STEP_ID = 'orch-orchestrator'

type JsonRecord = Record<string, unknown>

interface MockAgent {
  id: string
  name: string
  description: string
  registeredAt: string
  builderId: string
  builderName: string
  threadSurfaceIds: string[]
  model: string
  role: string
  tools: string[]
  promptRef: {
    id: string
    version: number
    path: string
  } | null
  skillRefs: Array<{
    id: string
    version: number
    path: string
    capabilities: string[]
  }>
  skills: Array<{
    id: string
    label: string
    inherited: boolean
  }>
  version: number
  supersedesAgentId: string | null
  composition: {
    model: string
    role: string
    promptRef: {
      id: string
      version: number
      path: string
    } | null
    skillRefs: Array<{
      id: string
      version: number
      path: string
      capabilities: string[]
    }>
    tools: string[]
    identityHash: string
  }
}

type RegisterResponsePayload = {
  agent: MockAgent
  cloudRegistration?: null
  cloudSyncError?: string | null
  replacementOf?: string
  materialChange?: boolean
  reasons?: string[]
}

function parseJsonBody(request: Request): JsonRecord {
  return JSON.parse(request.postData() ?? '{}') as JsonRecord
}

function buildMockAgent(overrides: Partial<MockAgent> = {}): MockAgent {
  const id = overrides.id ?? 'agent-under-test'
  const role = overrides.role ?? 'reviewer'
  const model = overrides.model ?? 'claude-code'
  const promptRef = overrides.promptRef ?? {
    id: 'orch-orchestrator',
    version: 1,
    path: '.threados/prompts/orch-orchestrator.md',
  }
  const skillRefs = overrides.skillRefs ?? [
    { id: 'files', version: 1, path: '.threados/skills/files/SKILL.md', capabilities: ['edit'] },
    { id: 'browser', version: 1, path: '.threados/skills/browser/SKILL.md', capabilities: ['navigate'] },
  ]
  const tools = overrides.tools ?? ['files', 'browser']
  const identityHash = overrides.composition
    ? overrides.composition.identityHash
    : `mock-hash-${id}-${role}-${model}`

  return {
    id,
    name: overrides.name ?? 'Agent under test',
    description: overrides.description ?? 'Browser-verified canonical workflow',
    registeredAt: overrides.registeredAt ?? new Date('2026-03-31T00:00:00.000Z').toISOString(),
    builderId: overrides.builderId ?? 'playwright',
    builderName: overrides.builderName ?? 'Playwright',
    threadSurfaceIds: overrides.threadSurfaceIds ?? ['thread-orch-orchestrator'],
    model,
    role,
    tools,
    promptRef,
    skillRefs,
    skills: overrides.skills ?? skillRefs.map(skill => ({
      id: skill.id,
      label: skill.id,
      inherited: false,
    })),
    version: overrides.version ?? 1,
    supersedesAgentId: overrides.supersedesAgentId ?? null,
    composition: overrides.composition ?? {
      model,
      role,
      promptRef,
      skillRefs,
      tools,
      identityHash,
    },
  }
}

function syncStepWithAssignedAgent(sequenceState: JsonRecord, agent: MockAgent | null) {
  const steps = Array.isArray(sequenceState.steps) ? sequenceState.steps as JsonRecord[] : []
  const step = steps.find(item => item.id === STEP_ID)
  if (!step) return

  if (!agent) {
    delete step.assigned_agent_id
    return
  }

  step.assigned_agent_id = agent.id
  step.model = agent.model
  step.role = agent.role
  step.prompt_ref = agent.promptRef
  step.prompt_file = agent.promptRef?.path ?? step.prompt_file
  step.skill_refs = agent.skillRefs
}

async function installCanonicalRouteHarness(page: Page, options: {
  initialAgents?: MockAgent[]
  initialAssignedAgentId?: string | null
  registerHandler: (body: JsonRecord, currentAgents: MockAgent[]) => RegisterResponsePayload
}) {
  let sequenceState: JsonRecord | null = null
  let agents = [...(options.initialAgents ?? [])]

  await page.route('**/api/sequence', async route => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }

    if (!sequenceState) {
      const upstream = await route.fetch()
      sequenceState = await upstream.json() as JsonRecord
      const assignedAgent = options.initialAssignedAgentId
        ? agents.find(agent => agent.id === options.initialAssignedAgentId) ?? null
        : null
      syncStepWithAssignedAgent(sequenceState, assignedAgent)
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sequenceState),
    })
  })

  await page.route('**/api/agents', async route => {
    const request = route.request()

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents }),
      })
      return
    }

    if (request.method() === 'POST') {
      const body = parseJsonBody(request)
      const payload = options.registerHandler(body, agents)
      agents = [
        ...agents.filter(agent => agent.id !== payload.agent.id),
        payload.agent,
      ]

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(payload),
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

    const body = parseJsonBody(request)
    if (body.action === 'edit' && body.stepId === STEP_ID && sequenceState) {
      const assignedAgentId = typeof body.assignedAgentId === 'string' ? body.assignedAgentId : null
      const assignedAgent = assignedAgentId
        ? agents.find(agent => agent.id === assignedAgentId) ?? null
        : null
      syncStepWithAssignedAgent(sequenceState, assignedAgent)
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  return {
    getAgents: () => agents,
    getSequence: () => sequenceState,
  }
}

async function openSelectedNodeDetailCard(page: Page) {
  await openAuthenticatedWorkbench(page)
  await selectFirstPhase(page)

  const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
  await expect(surfaceNode).toBeVisible()
  await surfaceNode.click()

  const agentDetailCard = page.getByTestId('agent-detail-card')
  await expect(agentDetailCard).toBeVisible()
  await expect(agentDetailCard.getByTestId('agent-detail-register')).toBeVisible()
  return { surfaceNode, agentDetailCard }
}

test.describe('agent-canonical-loadout', () => {
  test('registering from the detail card sends canonical loadout and assignment payloads', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'agent-canonical-loadout')

    await installCanonicalRouteHarness(page, {
      initialAgents: [],
      initialAssignedAgentId: null,
      registerHandler: (body) => {
        const agentId = String(body.id ?? 'agent-under-test')
        const promptRef = (body.promptRef as MockAgent['promptRef']) ?? null
        const skillRefs = Array.isArray(body.skillRefs) ? body.skillRefs as MockAgent['skillRefs'] : []
        const tools = Array.isArray(body.tools) ? body.tools as string[] : []
        const role = typeof body.role === 'string' ? body.role : 'reviewer'
        const model = typeof body.model === 'string' ? body.model : 'claude-code'

        return {
          agent: buildMockAgent({
            id: agentId,
            name: String(body.name ?? 'Agent under test'),
            description: String(body.description ?? 'Browser-verified canonical workflow'),
            model,
            role,
            promptRef,
            skillRefs,
            tools,
            threadSurfaceIds: Array.isArray(body.threadSurfaceIds) ? body.threadSurfaceIds as string[] : [],
          }),
          materialChange: false,
          reasons: [],
        }
      },
    })

    try {
      await evidence.withinBoundary('UI', 'open the agent detail card from the selected surface node', async () => {
        const { agentDetailCard } = await openSelectedNodeDetailCard(page)
        await expect(agentDetailCard.getByText(/New canonical agent|No canonical change|Material change/)).toBeVisible()
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

        await openAccordionSection(page, 'agent')
        await expect(page.getByTestId('agent-tab-performance')).toHaveAttribute('data-active', 'true')
        await expect(page.getByText(/Select a registered agent to view local performance\.|Performance is tracked per canonical agent only\./)).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })

  test('role changes are treated as material and mint a replacement agent', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'agent-canonical-replacement')
    const initialAgent = buildMockAgent({
      id: 'agent-alpha',
      name: 'Agent Alpha',
      role: 'reviewer',
      model: 'claude-code',
    })

    await installCanonicalRouteHarness(page, {
      initialAgents: [initialAgent],
      initialAssignedAgentId: initialAgent.id,
      registerHandler: (body) => {
        const replacement = buildMockAgent({
          id: 'agent-alpha-v2',
          name: String(body.name ?? 'Agent Alpha'),
          description: String(body.description ?? 'Browser-verified canonical workflow'),
          role: String(body.role ?? 'builder'),
          model: String(body.model ?? 'claude-code'),
          promptRef: (body.promptRef as MockAgent['promptRef']) ?? initialAgent.promptRef,
          skillRefs: Array.isArray(body.skillRefs) ? body.skillRefs as MockAgent['skillRefs'] : initialAgent.skillRefs,
          tools: Array.isArray(body.tools) ? body.tools as string[] : initialAgent.tools,
          version: 2,
          supersedesAgentId: initialAgent.id,
        })

        return {
          agent: replacement,
          cloudRegistration: null,
          replacementOf: initialAgent.id,
          materialChange: true,
          reasons: ['role changed'],
        }
      },
    })

    try {
      await evidence.withinBoundary('UI', 'edit the draft role and show a material change before registration', async () => {
        await openAuthenticatedWorkbench(page)
        await selectFirstPhase(page)
        await openAccordionSection(page, 'node')

        const nodeSection = page.getByTestId('node-section')
        await nodeSection.getByTestId('node-draft-role').fill('builder')
        await expect(nodeSection.getByText('Material change')).toBeVisible()
        await expect(nodeSection.getByText('role changed')).toBeVisible()

        const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
        await surfaceNode.click()
        const agentDetailCard = page.getByTestId('agent-detail-card')
        await expect(agentDetailCard).toBeVisible()
        await expect(agentDetailCard.getByText('Material change: role changed')).toBeVisible()
      })

      const { registerBody, assignBody } = await evidence.withinBoundary('client -> API', 'register a replacement agent and rebind the node', async () => {
        const registerRequestPromise = page.waitForRequest(req => req.url().endsWith('/api/agents') && req.method() === 'POST')
        const assignRequestPromise = page.waitForRequest(req => {
          if (!req.url().endsWith('/api/step') || req.method() !== 'POST') return false
          const body = parseJsonBody(req)
          return body.action === 'edit' && body.assignedAgentId === 'agent-alpha-v2'
        })

        await page.getByTestId('agent-detail-register').click()

        return {
          registerBody: parseJsonBody(await registerRequestPromise),
          assignBody: parseJsonBody(await assignRequestPromise),
        }
      })

      expect(registerBody.role).toBe('builder')
      expect(assignBody.assignedAgentId).toBe('agent-alpha-v2')

      await evidence.withinBoundary('response -> UI', 'render the replacement success state', async () => {
        await expect(page.getByText('Registered replacement agent and rebound this node.')).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })

  test('description-only edits stay non-material and preserve the canonical agent id', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'agent-canonical-non-material')
    const initialAgent = buildMockAgent({
      id: 'agent-alpha',
      name: 'Agent Alpha',
      description: 'Original description',
      role: 'reviewer',
    })

    await installCanonicalRouteHarness(page, {
      initialAgents: [initialAgent],
      initialAssignedAgentId: initialAgent.id,
      registerHandler: (body) => ({
        agent: buildMockAgent({
          ...initialAgent,
          description: String(body.description ?? 'Updated copy only'),
          name: String(body.name ?? initialAgent.name),
          role: String(body.role ?? initialAgent.role),
          model: String(body.model ?? initialAgent.model),
          promptRef: (body.promptRef as MockAgent['promptRef']) ?? initialAgent.promptRef,
          skillRefs: Array.isArray(body.skillRefs) ? body.skillRefs as MockAgent['skillRefs'] : initialAgent.skillRefs,
          tools: Array.isArray(body.tools) ? body.tools as string[] : initialAgent.tools,
          version: 1,
        }),
        cloudRegistration: null,
        materialChange: false,
        reasons: [],
      }),
    })

    try {
      await evidence.withinBoundary('UI', 'edit description only and show a non-material change before registration', async () => {
        await openAuthenticatedWorkbench(page)
        await selectFirstPhase(page)
        await openAccordionSection(page, 'node')

        const nodeSection = page.getByTestId('node-section')
        await nodeSection.getByTestId('node-draft-description').fill('Updated copy only')
        await expect(nodeSection.getByText('Non-material change')).toBeVisible()
        await expect(nodeSection.getByText('Only name or description changed.')).toBeVisible()

        const surfaceNode = page.getByRole('button', { name: /Step orchestrator, status READY/i })
        await surfaceNode.click()
        const agentDetailCard = page.getByTestId('agent-detail-card')
        await expect(agentDetailCard).toBeVisible()
        await expect(agentDetailCard.getByText('Non-material change: name or description only')).toBeVisible()
      })

      const { registerBody, assignBody } = await evidence.withinBoundary('client -> API', 're-register the same canonical agent after a description edit', async () => {
        const registerRequestPromise = page.waitForRequest(req => req.url().endsWith('/api/agents') && req.method() === 'POST')
        const assignRequestPromise = page.waitForRequest(req => {
          if (!req.url().endsWith('/api/step') || req.method() !== 'POST') return false
          const body = parseJsonBody(req)
          return body.action === 'edit' && body.assignedAgentId === initialAgent.id
        })

        await page.getByTestId('agent-detail-register').click()

        return {
          registerBody: parseJsonBody(await registerRequestPromise),
          assignBody: parseJsonBody(await assignRequestPromise),
        }
      })

      expect(registerBody.description).toBe('Updated copy only')
      expect(assignBody.assignedAgentId).toBe(initialAgent.id)

      await evidence.withinBoundary('response -> UI', 'show the in-place registration success state', async () => {
        await expect(page.getByText('Registered agent and assigned it to this node.')).toBeVisible()
      })
    } finally {
      await evidence.finalize()
    }
  })

  test('assigning and unassigning through the registry control updates the step binding', async ({ page }, testInfo) => {
    const evidence = startBrowserEvidence(page, testInfo, 'agent-assign-unassign')
    const agentAlpha = buildMockAgent({
      id: 'agent-alpha',
      name: 'Agent Alpha',
      role: 'reviewer',
    })
    const agentBeta = buildMockAgent({
      id: 'agent-beta',
      name: 'Agent Beta',
      role: 'builder',
      model: 'gpt-5.2',
      promptRef: {
        id: 'agent-beta-prompt',
        version: 2,
        path: '.threados/prompts/agent-beta.md',
      },
      skillRefs: [{ id: 'tools', version: 2, path: '.threados/skills/tools/SKILL.md', capabilities: ['run'] }],
      tools: ['tools'],
    })

    const harness = await installCanonicalRouteHarness(page, {
      initialAgents: [agentAlpha, agentBeta],
      initialAssignedAgentId: agentAlpha.id,
      registerHandler: () => {
        throw new Error('registerHandler should not be called in assign/unassign test')
      },
    })

    try {
      await evidence.withinBoundary('UI', 'open the node workshop card with the assignment control', async () => {
        await openAuthenticatedWorkbench(page)
        await selectFirstPhase(page)
        await openAccordionSection(page, 'node')
        await expect(page.getByTestId('node-section').getByTestId('node-assign-existing-agent')).toBeVisible()
      })

      const assignBody = await evidence.withinBoundary('client -> API', 'assign a different canonical agent to the node', async () => {
        const assignRequestPromise = page.waitForRequest(req => {
          if (!req.url().endsWith('/api/step') || req.method() !== 'POST') return false
          const body = parseJsonBody(req)
          return body.action === 'edit' && body.assignedAgentId === 'agent-beta'
        })

        await page.getByTestId('node-section').getByTestId('node-assign-existing-agent').selectOption('agent-beta')
        return parseJsonBody(await assignRequestPromise)
      })

      expect(assignBody.assignedAgentId).toBe('agent-beta')
      await expect.poll(async () => page.getByTestId('node-section').getByTestId('node-assign-existing-agent').inputValue()).toBe('agent-beta')
      expect((harness.getSequence()?.steps as JsonRecord[]).find(step => step.id === STEP_ID)?.model).toBe('gpt-5.2')
      expect((harness.getSequence()?.steps as JsonRecord[]).find(step => step.id === STEP_ID)?.role).toBe('builder')

      const unassignBody = await evidence.withinBoundary('client -> API', 'clear the assigned agent while leaving the synced loadout in place', async () => {
        const unassignRequestPromise = page.waitForRequest(req => {
          if (!req.url().endsWith('/api/step') || req.method() !== 'POST') return false
          const body = parseJsonBody(req)
          return body.action === 'edit' && body.assignedAgentId === null
        })

        await page.getByTestId('node-section').getByTestId('node-assign-existing-agent').selectOption('')
        return parseJsonBody(await unassignRequestPromise)
      })

      expect(unassignBody.assignedAgentId).toBeNull()
      await expect.poll(async () => page.getByTestId('node-section').getByTestId('node-assign-existing-agent').inputValue()).toBe('')

      const syncedStep = (harness.getSequence()?.steps as JsonRecord[]).find(step => step.id === STEP_ID)
      expect(syncedStep?.assigned_agent_id).toBeUndefined()
      expect(syncedStep?.model).toBe('gpt-5.2')
      expect(syncedStep?.role).toBe('builder')
    } finally {
      await evidence.finalize()
    }
  })
})
