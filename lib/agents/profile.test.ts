import { describe, test, expect } from 'bun:test'
import { buildAgentProfile, type ProfileDataSources, type ProfileNodeContext } from './profile'
import type { AgentRegistration } from './types'
import type { AgentStats } from './stats'
import type { Pack } from '../packs/types'

// ── Factory helpers ─────────────────────────────────────────────────────

function makeAgent(overrides?: Partial<AgentRegistration>): AgentRegistration {
  return {
    id: 'agent-1',
    name: 'Alpha Agent',
    description: 'Test agent',
    registeredAt: '2026-03-12T00:00:00.000Z',
    builderId: 'builder-1',
    builderName: 'Alice',
    threadSurfaceIds: ['ts-1'],
    metadata: {},
    ...overrides,
  }
}

function makeStats(overrides?: Partial<AgentStats>): AgentStats {
  return {
    agentId: 'agent-1',
    totalRuns: 10,
    wins: 5,
    podiums: 7,
    losses: 2,
    disqualifications: 1,
    avgPlacement: 2.5,
    bestPlacement: 1,
    totalRaceTime: 600_000,
    divisions: { open: { runs: 10, wins: 5 } },
    ...overrides,
  }
}

function makePack(overrides?: Partial<Pack>): Pack {
  return {
    id: 'pack-1',
    type: 'hero',
    builderId: 'builder-1',
    builderName: 'Alice',
    division: 'Champion',
    classification: 'Prompting',
    acquiredAt: '2026-03-12T00:00:00.000Z',
    highestStatus: 'hero',
    statusHistory: [
      { status: 'challenger', achievedAt: '2026-03-10T00:00:00.000Z', context: 'Initial' },
      { status: 'hero', achievedAt: '2026-03-12T00:00:00.000Z', context: 'Won finals' },
    ],
    ...overrides,
  }
}

function makeNode(overrides?: Partial<ProfileNodeContext>): ProfileNodeContext {
  return {
    surfaceLabel: 'step-alpha',
    depth: 0,
    childCount: 3,
    role: 'orchestrator',
    runStatus: 'successful',
    runSummary: 'All tasks completed',
    linkedSurfaceCount: 2,
    ...overrides,
  }
}

// ── Full data test ──────────────────────────────────────────────────────

describe('buildAgentProfile', () => {
  describe('full data (all sources provided)', () => {
    const sources: ProfileDataSources = {
      agent: makeAgent(),
      stats: makeStats(),
      pack: makePack(),
      node: makeNode(),
    }

    const profile = buildAgentProfile(sources)

    test('builder comes from agent.builderName', () => {
      expect(profile.builder).toBe('Alice')
    })

    test('pack name maps from pack.highestStatus via PACK_DISPLAY', () => {
      expect(profile.pack).toBe('Hero Pack')
    })

    test('division comes from pack.division', () => {
      expect(profile.division).toBe('Champion')
    })

    test('classification comes from pack.classification', () => {
      expect(profile.classification).toBe('Prompting')
    })

    test('threadPower is computed correctly (base 5.0 + bonuses, capped at 9.9)', () => {
      // winRate = 5/10 = 0.5 → winBonus = 0.5 * 2.5 = 1.25
      // podiumRate = 7/10 = 0.7 → podiumBonus = 0.7 * 1.2 = 0.84
      // runVolumeBonus = min(1.0, 10/20) = 0.5
      // avgPlacementBonus = max(0, (5 - 2.5) * 0.15) = 0.375
      // total = 5.0 + 1.25 + 0.84 + 0.5 + 0.375 = 7.965 → toFixed(1) = 8.0
      expect(profile.threadPower).toBe(8.0)
    })

    test('weight is computed correctly (base 4.0 + bonuses, capped at 9.9)', () => {
      // podiumBonus = min(2.5, 7 * 0.5) = min(2.5, 3.5) = 2.5
      // packBonus = hero → 1.5
      // depthBonus = depth 0 → 1.2
      // total = 4.0 + 2.5 + 1.5 + 1.2 = 9.2
      expect(profile.weight).toBe(9.2)
    })

    test('verified is true when agent exists and stats have runs', () => {
      expect(profile.verified).toBe(true)
    })

    test('rubric has 6 metrics with correct labels', () => {
      expect(profile.rubric).toHaveLength(6)
      const labels = profile.rubric.map(m => m.label)
      expect(labels).toEqual(['Tools', 'Model', 'Autonomy', 'Coordination', 'Reliability', 'Economy'])
    })

    test('rubric values are within 0-10 range', () => {
      for (const metric of profile.rubric) {
        expect(metric.value).toBeGreaterThanOrEqual(0)
        expect(metric.value).toBeLessThanOrEqual(10)
      }
    })

    test('skills come from agent.metadata.skills when present', () => {
      const customSkills = [
        { id: 'code', label: 'Code', inherited: false },
        { id: 'debug', label: 'Debug', inherited: true },
      ]
      const withSkills = buildAgentProfile({
        ...sources,
        agent: makeAgent({ metadata: { skills: customSkills } }),
      })
      expect(withSkills.skills).toEqual(customSkills)
    })

    test('skills default to 6 items when agent has no custom skills', () => {
      expect(profile.skills).toHaveLength(6)
      expect(profile.skills[0]).toEqual({ id: 'search', label: 'Search', inherited: false })
    })

    test('delta string shows win rate and total runs', () => {
      // winRate = 50%
      expect(profile.delta).toBe('50% win rate across 10 runs')
    })

    test('placement derived from bestPlacement=1', () => {
      expect(profile.placement).toBe('1st')
    })
  })

  // ── Pack display name mapping ───────────────────────────────────────

  describe('pack display name mapping', () => {
    const base = { agent: makeAgent(), stats: makeStats(), node: makeNode() }

    test('hero pack → "Hero Pack"', () => {
      const p = buildAgentProfile({ ...base, pack: makePack({ highestStatus: 'hero' }) })
      expect(p.pack).toBe('Hero Pack')
    })

    test('champion pack → "Champion\'s Pack"', () => {
      const p = buildAgentProfile({ ...base, pack: makePack({ highestStatus: 'champion' }) })
      expect(p.pack).toBe("Champion's Pack")
    })

    test('challenger pack → "Challenger Pack"', () => {
      const p = buildAgentProfile({ ...base, pack: makePack({ highestStatus: 'challenger' }) })
      expect(p.pack).toBe('Challenger Pack')
    })
  })

  // ── Null agent ──────────────────────────────────────────────────────

  describe('null agent', () => {
    const sources: ProfileDataSources = {
      agent: null,
      stats: makeStats(),
      pack: makePack(),
      node: makeNode(),
    }

    const profile = buildAgentProfile(sources)

    test('builder defaults to "thredOS Registry"', () => {
      expect(profile.builder).toBe('thredOS Registry')
    })

    test('skills returns default 6-item array', () => {
      expect(profile.skills).toHaveLength(6)
      expect(profile.skills.map(s => s.id)).toEqual([
        'search', 'browser', 'model', 'tools', 'files', 'orchestration',
      ])
    })

    test('function does not throw', () => {
      expect(() => buildAgentProfile(sources)).not.toThrow()
    })

    test('verified is false when agent is null', () => {
      expect(profile.verified).toBe(false)
    })
  })

  // ── Null stats ──────────────────────────────────────────────────────

  describe('null stats', () => {
    const sources: ProfileDataSources = {
      agent: makeAgent(),
      stats: null,
      pack: makePack(),
      node: makeNode({ runStatus: 'successful', childCount: 3 }),
    }

    const profile = buildAgentProfile(sources)

    test('falls back to algorithmic ThreadPower from hierarchy context', () => {
      // Fallback: childWeight = min(3, 5) = 3
      // statusBonus = successful → 0.9
      // total = 6.2 + 3*0.45 + 0.9 = 6.2 + 1.35 + 0.9 = 8.45 → min(9.6, 8.5) = 8.5
      expect(profile.threadPower).toBe(8.5)
    })

    test('falls back to algorithmic Weight from hierarchy context', () => {
      // Fallback: childWeight = min(3, 5) = 3
      // depthBonus = depth 0 → 1.5
      // total = 4.6 + 3*0.55 + 1.5 = 4.6 + 1.65 + 1.5 = 7.75 → min(9.4, 7.8) = 7.8
      expect(profile.weight).toBe(7.8)
    })

    test('delta shows fallback text for successful run status', () => {
      expect(profile.delta).toBe('+0.4 from successful runs')
    })

    test('delta shows running fallback text', () => {
      const running = buildAgentProfile({
        ...sources,
        node: makeNode({ runStatus: 'running' }),
      })
      expect(running.delta).toBe('+0.9 from verified runs')
    })

    test('rubric uses depth-based values (fallback path)', () => {
      expect(profile.rubric).toHaveLength(6)
      // depth 0 Model = 8
      const modelMetric = profile.rubric.find(m => m.label === 'Model')
      expect(modelMetric!.value).toBe(8)
      // Reliability for successful = 8
      const reliabilityMetric = profile.rubric.find(m => m.label === 'Reliability')
      expect(reliabilityMetric!.value).toBe(8)
    })

    test('verified is true when agent exists and runStatus is successful', () => {
      expect(profile.verified).toBe(true)
    })
  })

  // ── Null pack ───────────────────────────────────────────────────────

  describe('null pack', () => {
    test('division derived from depth 0 → "Champion"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ depth: 0 }),
      })
      expect(p.division).toBe('Champion')
    })

    test('division derived from depth 1 → "Frontline"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ depth: 1 }),
      })
      expect(p.division).toBe('Frontline')
    })

    test('division derived from depth 2+ → "Mini"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ depth: 3 }),
      })
      expect(p.division).toBe('Mini')
    })

    test('classification derived from orchestrator role → "Prompting"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ role: 'orchestrator' }),
      })
      expect(p.classification).toBe('Prompting')
    })

    test('classification derived from synthesis role → "Closed Source"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ role: 'synthesis' }),
      })
      expect(p.classification).toBe('Closed Source')
    })

    test('classification derived from other role → "Open Champion"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ role: 'worker' }),
      })
      expect(p.classification).toBe('Open Champion')
    })

    test('pack name derived from placement when pack is null', () => {
      // bestPlacement=1 → placement='1st' → packName = "Champion's Pack"
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats({ bestPlacement: 1 }),
        pack: null,
        node: makeNode(),
      })
      expect(p.pack).toBe("Champion's Pack")
    })

    test('pack name is "Challenger Pack" when placement is "Challenger"', () => {
      // No stats, runStatus null → placement = 'Challenger'
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: null,
        pack: null,
        node: makeNode({ runStatus: null }),
      })
      expect(p.pack).toBe('Challenger Pack')
    })

    test('pack name is "Hero Pack" when placement is "Finalist"', () => {
      // No stats, runStatus 'running' → placement = 'Finalist'
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: null,
        pack: null,
        node: makeNode({ runStatus: 'running' }),
      })
      expect(p.pack).toBe('Hero Pack')
    })

    test('weight uses packBonus=0.3 when pack is null with stats', () => {
      // base=4.0, podiumBonus=min(2.5, 7*0.5)=2.5, packBonus=0.3, depthBonus(0)=1.2
      // total = 4.0 + 2.5 + 0.3 + 1.2 = 8.0
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: null,
        node: makeNode({ depth: 0 }),
      })
      expect(p.weight).toBe(8.0)
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('agent with 0 wins (all losses)', () => {
      const stats = makeStats({
        totalRuns: 5,
        wins: 0,
        podiums: 0,
        losses: 5,
        disqualifications: 0,
        avgPlacement: 6.0,
        bestPlacement: 4,
      })
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats,
        pack: makePack(),
        node: makeNode(),
      })

      // winRate=0 → winBonus=0, podiumRate=0 → podiumBonus=0
      // runVolumeBonus=min(1.0, 5/20)=0.25
      // avgPlacementBonus=max(0, (5-6)*0.15)=max(0, -0.15)=0
      // threadPower = 5.0 + 0 + 0 + 0.25 + 0 = 5.25 → 5.3 (toFixed(1))
      expect(p.threadPower).toBe(5.3)

      // placement: bestPlacement=4 → "4th"
      expect(p.placement).toBe('4th')

      // delta: 0% win rate
      expect(p.delta).toBe('0% win rate across 5 runs')
    })

    test('agent with perfect record (100% win rate)', () => {
      const stats = makeStats({
        totalRuns: 20,
        wins: 20,
        podiums: 20,
        losses: 0,
        disqualifications: 0,
        avgPlacement: 1.0,
        bestPlacement: 1,
      })
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats,
        pack: makePack(),
        node: makeNode(),
      })

      // winRate=1.0 → winBonus=2.5, podiumRate=1.0 → podiumBonus=1.2
      // runVolumeBonus=min(1.0, 20/20)=1.0
      // avgPlacementBonus=max(0, (5-1)*0.15)=0.6
      // total = 5.0 + 2.5 + 1.2 + 1.0 + 0.6 = 10.3 → capped at 9.9
      expect(p.threadPower).toBe(9.9)
      expect(p.placement).toBe('1st')
      expect(p.delta).toBe('100% win rate across 20 runs')
    })

    test('stats with 0 totalRuns falls back to hierarchy-based computation', () => {
      const stats = makeStats({ totalRuns: 0, wins: 0, podiums: 0, losses: 0 })
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats,
        pack: makePack(),
        node: makeNode({ runStatus: 'running', childCount: 2 }),
      })

      // Falls back because totalRuns === 0
      // ThreadPower fallback: childWeight=min(2,5)=2, statusBonus=running→0.6
      // 6.2 + 2*0.45 + 0.6 = 6.2 + 0.9 + 0.6 = 7.7
      expect(p.threadPower).toBe(7.7)

      // Weight fallback: childWeight=2, depthBonus(0)=1.5
      // 4.6 + 2*0.55 + 1.5 = 4.6 + 1.1 + 1.5 = 7.2
      expect(p.weight).toBe(7.2)

      // Placement fallback (0 totalRuns): runStatus='running' → 'Finalist'
      expect(p.placement).toBe('Finalist')
    })

    test('very deep node (depth > 2)', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: makePack(),
        node: makeNode({ depth: 5 }),
      })

      // depth > 1 → depthBonus = 0.2 in weight
      // base=4.0, podiumBonus=2.5, packBonus(hero)=1.5, depthBonus=0.2
      // weight = 4.0 + 2.5 + 1.5 + 0.2 = 8.2
      expect(p.weight).toBe(8.2)

      // Model rubric: depth > 1 → 6
      const modelMetric = p.rubric.find(m => m.label === 'Model')
      expect(modelMetric!.value).toBe(6)
    })

    test('very deep node (depth > 2) with null stats for division fallback', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: null,
        pack: null,
        node: makeNode({ depth: 4 }),
      })

      expect(p.division).toBe('Mini')
    })

    test('agent with custom skills in metadata', () => {
      const customSkills = [
        { id: 'analysis', label: 'Analysis', inherited: false },
        { id: 'planning', label: 'Planning', inherited: true },
        { id: 'execution', label: 'Execution', inherited: false },
      ]
      const p = buildAgentProfile({
        agent: makeAgent({ metadata: { skills: customSkills } }),
        stats: makeStats(),
        pack: makePack(),
        node: makeNode(),
      })

      expect(p.skills).toHaveLength(3)
      expect(p.skills).toEqual(customSkills)
    })

    test('skills inherit defaults to false when not specified', () => {
      const customSkills = [
        { id: 'search', label: 'Search' },
      ]
      const p = buildAgentProfile({
        agent: makeAgent({ metadata: { skills: customSkills } }),
        stats: makeStats(),
        pack: makePack(),
        node: makeNode(),
      })

      expect(p.skills[0].inherited).toBe(false)
    })

    test('bestPlacement=2 maps to "2nd"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats({ bestPlacement: 2 }),
        pack: null,
        node: makeNode(),
      })
      expect(p.placement).toBe('2nd')
    })

    test('bestPlacement=3 maps to "3rd"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats({ bestPlacement: 3 }),
        pack: null,
        node: makeNode(),
      })
      expect(p.placement).toBe('3rd')
    })

    test('bestPlacement > 3 uses "th" suffix', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats({ bestPlacement: 7 }),
        pack: null,
        node: makeNode(),
      })
      expect(p.placement).toBe('7th')
    })

    test('bestPlacement=0 with totalRuns > 0 returns "Competitor"', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats({ bestPlacement: 0, totalRuns: 5 }),
        pack: null,
        node: makeNode(),
      })
      expect(p.placement).toBe('Competitor')
    })

    test('rubric coordination caps at 10', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: makePack(),
        node: makeNode({ childCount: 20, depth: 0 }),
      })
      const coordination = p.rubric.find(m => m.label === 'Coordination')
      expect(coordination!.value).toBeLessThanOrEqual(10)
    })

    test('rubric tools caps at 10', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: makeStats(),
        pack: makePack(),
        node: makeNode({ linkedSurfaceCount: 20 }),
      })
      const tools = p.rubric.find(m => m.label === 'Tools')
      expect(tools!.value).toBeLessThanOrEqual(10)
    })

    test('all null except node returns valid profile without throwing', () => {
      const p = buildAgentProfile({
        agent: null,
        stats: null,
        pack: null,
        node: makeNode(),
      })

      expect(p.builder).toBe('thredOS Registry')
      expect(p.verified).toBe(false)
      expect(p.rubric).toHaveLength(6)
      expect(p.skills).toHaveLength(6)
      expect(typeof p.threadPower).toBe('number')
      expect(typeof p.weight).toBe('number')
      expect(typeof p.division).toBe('string')
      expect(typeof p.classification).toBe('string')
      expect(typeof p.placement).toBe('string')
      expect(typeof p.pack).toBe('string')
      expect(typeof p.delta).toBe('string')
    })

    test('verified is true when agent exists and runStatus is running (no stats)', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: null,
        pack: null,
        node: makeNode({ runStatus: 'running' }),
      })
      expect(p.verified).toBe(true)
    })

    test('verified is false when agent exists but no stats and runStatus is null', () => {
      const p = buildAgentProfile({
        agent: makeAgent(),
        stats: null,
        pack: null,
        node: makeNode({ runStatus: null }),
      })
      expect(p.verified).toBe(false)
    })
  })
})
