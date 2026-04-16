import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string

async function setupWorkspace() {
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados/prompts/review.md'), '# Review\n')
  await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify({
    version: '1.0',
    name: 'degraded-cloud-proof',
    steps: [
      {
        id: 'step-a',
        name: 'Step A',
        type: 'base',
        model: 'shell',
        prompt_file: '.threados/prompts/review.md',
        prompt_ref: {
          id: 'review-prompt',
          version: 1,
          path: '.threados/prompts/review.md',
        },
        depends_on: [],
        status: 'READY',
      },
    ],
    gates: [],
  }))
}

function registrationBody() {
  return {
    id: 'agent-a',
    name: 'Agent A',
    description: 'Canonical reviewer agent',
    builderId: 'builder-1',
    builderName: 'Builder',
    model: 'claude-code',
    role: 'reviewer',
    promptRef: {
      id: 'review-prompt',
      version: 1,
      path: '.threados/prompts/review.md',
    },
    tools: ['test', 'lint', 'screenshot', 'inspection'],
    skillRefs: [
      { id: 'search', version: 1, path: '.threados/skills/search/SKILL.md', capabilities: ['search'] },
      { id: 'browser', version: 1, path: '.threados/skills/browser/SKILL.md', capabilities: ['navigate'] },
      { id: 'files', version: 1, path: '.threados/skills/files/SKILL.md', capabilities: ['read', 'write'] },
      { id: 'tools', version: 1, path: '.threados/skills/tools/SKILL.md', capabilities: ['execute'] },
    ],
    threadSurfaceIds: ['thread-step-a'],
  }
}

describe.serial('POST /api/agents degraded cloud', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-agents-degraded-cloud-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupWorkspace()
  })

  afterEach(async () => {
    mock.restore()
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('persists the canonical agent locally even when cloud registration fails', async () => {
    const cloudRegistry = await import('@/lib/agents/cloud-registry')
    spyOn(cloudRegistry, 'registerCloudAgent').mockImplementation(async () => {
      throw new Error('cloud unavailable')
    })

    const { POST } = await import('@/app/api/agents/route')

    const response = await POST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationBody()),
    }))

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.cloudRegistration).toBeNull()
    expect(payload.cloudSyncError).toBe('Cloud registration unavailable')
    expect(payload.agent.id).toBe('agent-a')
    expect(payload.agent.registrationNumber).toBeUndefined()

    const agentStateRaw = JSON.parse(await readFile(join(basePath, '.threados/state/agents.json'), 'utf8')) as {
      agents: Array<Record<string, unknown>>
    }
    const persistedAgent = agentStateRaw.agents.find(agent => agent.id === 'agent-a')
    expect(persistedAgent).toBeDefined()
    expect(persistedAgent?.model).toBe('codex')
    expect(persistedAgent?.role).toBe('reviewer')
    expect('registrationNumber' in (persistedAgent ?? {})).toBe(false)
    expect('cloudSyncedAt' in (persistedAgent ?? {})).toBe(false)

    const assetBody = await readFile(join(basePath, '.threados/agents/agent-a/AGENT.md'), 'utf8')
    expect(assetBody).toContain('id: agent-a')
    expect(assetBody).toContain('role: reviewer')
  })
})