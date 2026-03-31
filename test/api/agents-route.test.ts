import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { readSequence } from '@/lib/sequence/parser'

let basePath: string

async function setupWorkspace() {
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados/prompts/step-a.md'), '# Step A\n')
  await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify({
    version: '1.0',
    name: 'agent-route-tests',
    steps: [
      {
        id: 'step-a',
        name: 'Step A',
        type: 'base',
        model: 'shell',
        prompt_file: '.threados/prompts/step-a.md',
        prompt_ref: {
          id: 'step-a',
          version: 1,
          path: '.threados/prompts/step-a.md',
        },
        depends_on: [],
        status: 'READY',
      },
    ],
    gates: [],
  }))
}

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-a',
    name: 'Agent A',
    description: 'Canonical agent',
    builderId: 'builder-1',
    builderName: 'Builder',
    model: 'codex',
    role: 'reviewer',
    promptRef: {
      id: 'review-prompt',
      version: 1,
      path: '.threados/prompts/review.md',
    },
    tools: ['browser'],
    skillRefs: [{ id: 'browser', version: 2, path: '.threados/skills/browser/SKILL.md', capabilities: ['navigate'] }],
    threadSurfaceIds: ['thread-step-a'],
    ...overrides,
  }
}

describe.serial('POST /api/agents', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-agents-route-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupWorkspace()
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('prompt-only edits create a replacement agent', async () => {
    const { POST } = await import('@/app/api/agents/route')

    const first = await POST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody()),
    }))
    expect(first.status).toBe(201)

    const replacement = await POST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody({
        promptRef: {
          id: 'review-prompt-v2',
          version: 1,
          path: '.threados/prompts/review-v2.md',
        },
      })),
    }))
    const payload = await replacement.json()

    expect(replacement.status).toBe(201)
    expect(payload.materialChange).toBe(true)
    expect(payload.replacementOf).toBe('agent-a')
    expect(payload.agent.id).toBe('agent-a-v2')
    expect(payload.agent.supersedesAgentId).toBe('agent-a')
    expect(payload.agent.version).toBe(2)
  })

  test('description-only edits keep the same canonical version', async () => {
    const { POST } = await import('@/app/api/agents/route')

    await POST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody()),
    }))

    const updated = await POST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody({
        description: 'Updated copy only',
      })),
    }))
    const payload = await updated.json()

    expect(updated.status).toBe(201)
    expect(payload.agent.id).toBe('agent-a')
    expect(payload.agent.version).toBe(1)
    expect(payload.agent.description).toBe('Updated copy only')
  })
})

describe.serial('POST /api/step assignment sync', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-step-assign-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupWorkspace()
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('assigning an agent syncs the step loadout', async () => {
    const { POST: registerAgent } = await import('@/app/api/agents/route')
    const { POST: editStep } = await import('@/app/api/step/route')

    const registered = await registerAgent(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody({
        threadSurfaceIds: [],
        promptRef: {
          id: 'canonical-review-prompt',
          version: 2,
          path: '.threados/prompts/canonical-review.md',
        },
        skillRefs: [{ id: 'files', version: 3, path: '.threados/skills/files/SKILL.md', capabilities: ['edit'] }],
        tools: ['shell', 'git'],
        model: 'claude-code',
        role: 'builder',
      })),
    }))
    expect(registered.status).toBe(201)

    const assigned = await editStep(new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', stepId: 'step-a', assignedAgentId: 'agent-a' }),
    }))
    expect(assigned.status).toBe(200)

    const sequence = await readSequence(basePath)
    const step = sequence.steps.find(item => item.id === 'step-a')
    expect(step?.assigned_agent_id).toBe('agent-a')
    expect(step?.model).toBe('claude-code')
    expect(step?.role).toBe('builder')
    expect(step?.prompt_ref).toEqual({
      id: 'canonical-review-prompt',
      version: 2,
      path: '.threados/prompts/canonical-review.md',
    })
    expect(step?.prompt_file).toBe('.threados/prompts/canonical-review.md')
    expect(step?.skill_refs).toEqual([
      { id: 'files', version: 3, path: '.threados/skills/files/SKILL.md', capabilities: ['edit'] },
    ])
  })
})
