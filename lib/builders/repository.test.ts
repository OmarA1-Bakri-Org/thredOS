import { describe, test, expect } from 'bun:test'
import { deriveBuilderProfile } from './repository'
import type { AgentRegistration } from '@/lib/agents/types'
import type { Pack } from '@/lib/packs/types'

describe('deriveBuilderProfile', () => {
  const builder1Agents: AgentRegistration[] = [
    { id: 'a1', name: 'Agent 1', builderId: 'builder-1', builderName: 'Omar', registeredAt: '2026-01-01T00:00:00Z', threadSurfaceIds: [] },
    { id: 'a2', name: 'Agent 2', builderId: 'builder-1', builderName: 'Omar', registeredAt: '2026-01-02T00:00:00Z', threadSurfaceIds: [] },
  ]

  const builder1Packs: Pack[] = [
    {
      id: 'p1', type: 'challenger', division: 'UI', classification: 'Alpha',
      highestStatus: 'champion',
      statusHistory: [
        { status: 'challenger', achievedAt: '2026-01-01T00:00:00Z', context: 'initial' },
        { status: 'champion', achievedAt: '2026-01-05T00:00:00Z', context: 'promoted' },
      ],
      builderId: 'builder-1', builderName: 'Omar', acquiredAt: '2026-01-01T00:00:00Z',
    },
  ]

  test('derives profile from agents and packs', () => {
    const profile = deriveBuilderProfile('builder-1', 'Omar', builder1Agents, builder1Packs)
    expect(profile.id).toBe('builder-1')
    expect(profile.name).toBe('Omar')
    expect(profile.stats.totalAgents).toBe(2)
    expect(profile.stats.totalPacks).toBe(1)
    expect(profile.stats.highestPackStatus).toBe('champion')
  })

  test('returns null highestPackStatus when no packs', () => {
    const profile = deriveBuilderProfile('builder-1', 'Omar', builder1Agents, [])
    expect(profile.stats.highestPackStatus).toBeNull()
    expect(profile.stats.totalPacks).toBe(0)
  })

  test('uses earliest agent registeredAt', () => {
    const profile = deriveBuilderProfile('builder-1', 'Omar', builder1Agents, [])
    expect(profile.registeredAt).toBe('2026-01-01T00:00:00Z')
  })

  test('handles empty agents and packs', () => {
    const profile = deriveBuilderProfile('builder-1', 'Omar', [], [])
    expect(profile.stats.totalAgents).toBe(0)
    expect(profile.stats.totalPacks).toBe(0)
    expect(profile.stats.highestPackStatus).toBeNull()
  })
})
