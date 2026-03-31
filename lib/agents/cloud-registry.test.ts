import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listCloudAgentPerformance,
  recordCloudAgentPerformance,
  registerCloudAgent,
  summarizeCloudAgentPerformance,
} from './cloud-registry'
import type { AgentRegistration } from './types'

const tempDirs: string[] = []

async function createTempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'thredos-cloud-registry-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

function createAgent(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    id: 'agent-alpha',
    name: 'Agent Alpha',
    registeredAt: '2026-03-19T00:00:00.000Z',
    builderId: 'builder-1',
    builderName: 'Builder One',
    threadSurfaceIds: [],
    model: 'gpt-4o',
    role: 'researcher',
    tools: ['search'],
    promptRef: { id: 'agent-alpha-prompt', version: 1, path: '.threados/prompts/agent-alpha.md' },
    skillRefs: [],
    composition: {
      model: 'gpt-4o',
      role: 'researcher',
      promptRef: { id: 'agent-alpha-prompt', version: 1, path: '.threados/prompts/agent-alpha.md' },
      skillRefs: [],
      tools: ['search'],
      identityHash: 'identity-alpha',
    },
    version: 1,
    ...overrides,
  }
}

describe('cloud agent registry', () => {
  test('registers an agent and records performance without workspace content', async () => {
    const workspace = await createTempWorkspace()
    const registration = await registerCloudAgent(workspace, createAgent())

    expect(registration.registrationNumber.startsWith('AG-')).toBe(true)
    expect(registration.agentId).toBe('agent-alpha')
    expect(registration.promptRef).toEqual({ id: 'agent-alpha-prompt', version: 1 })

    await recordCloudAgentPerformance(workspace, {
      registrationNumber: registration.registrationNumber,
      outcome: 'pass',
      durationMs: 4200,
      qualityScore: 9,
      notes: 'Local-first execution succeeded',
    })
    await recordCloudAgentPerformance(workspace, {
      registrationNumber: registration.registrationNumber,
      outcome: 'fail',
      durationMs: 5100,
      qualityScore: 4,
      notes: null,
    })

    const records = await listCloudAgentPerformance(workspace, registration.registrationNumber)
    const summary = await summarizeCloudAgentPerformance(workspace, registration.registrationNumber)

    expect(records).toHaveLength(2)
    expect(summary).toEqual({
      totalRuns: 2,
      passRate: 50,
      avgTimeMs: 4650,
      quality: 7,
    })
  })
})
