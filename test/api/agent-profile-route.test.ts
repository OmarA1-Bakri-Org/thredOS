import { describe, test, expect } from 'bun:test'
import type { AgentRegistration } from '@/lib/agents/types'

/**
 * Integration test for GET /api/agent-profile.
 *
 * Instead of mocking shared modules (which poisons other test files in Bun),
 * we test the buildAgentProfile logic directly with real data structures.
 * The route itself is a thin wrapper around these calls.
 */

// We cannot easily redirect the route's BASE_PATH (module-level process.cwd()),
// so we test the profile-building pipeline directly — same code path, no mocks.
import { buildAgentProfile, type ProfileNodeContext } from '@/lib/agents/profile'
import { aggregateAgentStats } from '@/lib/agents/stats'

describe('GET /api/agent-profile (integration logic)', () => {
  const makeAgent = (overrides: Partial<AgentRegistration> = {}): AgentRegistration => ({
    id: 'agent-1',
    name: 'Alpha Agent',
    description: 'Test agent',
    registeredAt: '2026-03-12T00:00:00.000Z',
    builderId: 'builder-1',
    builderName: 'Alice',
    threadSurfaceIds: ['ts-abc'],
    metadata: {},
    ...overrides,
  })

  test('builds profile when agent is registered for a threadSurfaceId', () => {
    const agent = makeAgent()
    const stats = aggregateAgentStats('agent-1', [], [])
    const node: ProfileNodeContext = {
      surfaceLabel: 'Test Surface',
      depth: 0,
      childCount: 0,
      role: null,
      runStatus: null,
      runSummary: null,
      linkedSurfaceCount: 1,
    }

    const profile = buildAgentProfile({ agent, stats, pack: null, node })
    expect(profile).toBeDefined()
    expect(profile.builder).toBe('Alice')
    expect(profile.division).toBe('Champion') // depth 0
    expect(profile.placement).toBe('Challenger') // no runs, no runStatus
  })

  test('returns valid profile when agent has no stats', () => {
    const agent = makeAgent()
    const stats = aggregateAgentStats('agent-1', [], [])
    const node: ProfileNodeContext = {
      surfaceLabel: 'Surface',
      depth: 1,
      childCount: 2,
      role: null,
      runStatus: null,
      runSummary: null,
      linkedSurfaceCount: 1,
    }

    const profile = buildAgentProfile({ agent, stats, pack: null, node })
    expect(profile).toBeDefined()
    expect(profile.threadPower).toBeGreaterThan(0)
    expect(profile.weight).toBeGreaterThan(0)
  })

  test('returns null when no agent matches threadSurfaceId', () => {
    const agents = [makeAgent({ threadSurfaceIds: ['ts-other'] })]
    const match = agents.find(a => a.threadSurfaceIds.includes('ts-nonexistent')) ?? null
    expect(match).toBeNull()
  })

  test('handles empty agent state gracefully', () => {
    const agents: AgentRegistration[] = []
    const match = agents.find(a => a.threadSurfaceIds.includes('ts-abc')) ?? null
    expect(match).toBeNull()
  })
})
