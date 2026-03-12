import { describe, expect, test } from 'bun:test'
import { aggregateAgentStats } from './stats'
import type { CombatantRun, Race } from '../thread-runner/types'

const makeRace = (overrides: Partial<Race> = {}): Race => ({
  id: 'race-1',
  name: 'Sprint Alpha',
  division: 'open',
  classification: 'qualifier',
  startAt: '2026-03-12T00:00:00.000Z',
  endAt: null,
  status: 'completed',
  maxCombatants: 8,
  combatantRunIds: [],
  ...overrides,
})

const makeRun = (overrides: Partial<CombatantRun> = {}): CombatantRun => ({
  id: 'run-1',
  raceId: 'race-1',
  combatantId: 'agent-1',
  threadSurfaceId: 'ts-1',
  startedAt: '2026-03-12T00:01:00.000Z',
  endedAt: '2026-03-12T00:05:00.000Z',
  status: 'completed',
  verifiedAt: '2026-03-12T00:06:00.000Z',
  placement: 1,
  ...overrides,
})

describe('aggregateAgentStats', () => {
  test('empty runs returns zero stats', () => {
    const stats = aggregateAgentStats('agent-1', [], [])
    expect(stats.agentId).toBe('agent-1')
    expect(stats.totalRuns).toBe(0)
    expect(stats.wins).toBe(0)
    expect(stats.podiums).toBe(0)
    expect(stats.losses).toBe(0)
    expect(stats.disqualifications).toBe(0)
    expect(stats.avgPlacement).toBe(0)
    expect(stats.bestPlacement).toBe(0)
    expect(stats.totalRaceTime).toBe(0)
    expect(stats.divisions).toEqual({})
  })

  test('single win is counted correctly', () => {
    const races = [makeRace()]
    const runs = [makeRun({ placement: 1 })]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.totalRuns).toBe(1)
    expect(stats.wins).toBe(1)
    expect(stats.podiums).toBe(1)
    expect(stats.losses).toBe(0)
    expect(stats.avgPlacement).toBe(1)
    expect(stats.bestPlacement).toBe(1)
  })

  test('podium placements are counted correctly', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({ id: 'run-1', placement: 2 }),
      makeRun({ id: 'run-2', placement: 3 }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.wins).toBe(0)
    expect(stats.podiums).toBe(2)
    expect(stats.losses).toBe(0)
  })

  test('losses are placement > 3', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({ id: 'run-1', placement: 4 }),
      makeRun({ id: 'run-2', placement: 7 }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.wins).toBe(0)
    expect(stats.podiums).toBe(0)
    expect(stats.losses).toBe(2)
  })

  test('disqualified runs counted correctly', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({ id: 'run-1', status: 'disqualified', placement: null }),
      makeRun({ id: 'run-2', status: 'disqualified', placement: null }),
      makeRun({ id: 'run-3', placement: 1 }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.totalRuns).toBe(3)
    expect(stats.disqualifications).toBe(2)
    expect(stats.wins).toBe(1)
  })

  test('aggregate stats for multiple runs', () => {
    const races = [
      makeRace({ id: 'race-1', division: 'open' }),
      makeRace({ id: 'race-2', division: 'elite' }),
    ]
    const runs = [
      makeRun({
        id: 'run-1',
        raceId: 'race-1',
        placement: 1,
        startedAt: '2026-03-12T00:00:00.000Z',
        endedAt: '2026-03-12T00:02:00.000Z',
      }),
      makeRun({
        id: 'run-2',
        raceId: 'race-1',
        placement: 2,
        startedAt: '2026-03-12T00:00:00.000Z',
        endedAt: '2026-03-12T00:03:00.000Z',
      }),
      makeRun({
        id: 'run-3',
        raceId: 'race-2',
        placement: 5,
        startedAt: '2026-03-12T00:00:00.000Z',
        endedAt: '2026-03-12T00:01:00.000Z',
      }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.totalRuns).toBe(3)
    expect(stats.wins).toBe(1)
    expect(stats.podiums).toBe(2)
    expect(stats.losses).toBe(1)
    expect(stats.bestPlacement).toBe(1)
    expect(stats.avgPlacement).toBeCloseTo((1 + 2 + 5) / 3)
    // 2min + 3min + 1min = 6min = 360_000ms
    expect(stats.totalRaceTime).toBe(360_000)
  })

  test('division breakdown works', () => {
    const races = [
      makeRace({ id: 'race-1', division: 'open' }),
      makeRace({ id: 'race-2', division: 'elite' }),
      makeRace({ id: 'race-3', division: 'open' }),
    ]
    const runs = [
      makeRun({ id: 'run-1', raceId: 'race-1', placement: 1 }),
      makeRun({ id: 'run-2', raceId: 'race-2', placement: 2 }),
      makeRun({ id: 'run-3', raceId: 'race-3', placement: 1 }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.divisions.open).toEqual({ runs: 2, wins: 2 })
    expect(stats.divisions.elite).toEqual({ runs: 1, wins: 0 })
  })

  test('only counts runs for the specified agent', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({ id: 'run-1', combatantId: 'agent-1', placement: 1 }),
      makeRun({ id: 'run-2', combatantId: 'agent-2', placement: 1 }),
      makeRun({ id: 'run-3', combatantId: 'agent-1', placement: 3 }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.totalRuns).toBe(2)
    expect(stats.wins).toBe(1)
    expect(stats.podiums).toBe(2)
  })

  test('bestPlacement is 0 when no placements exist', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({ id: 'run-1', status: 'disqualified', placement: null }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    expect(stats.bestPlacement).toBe(0)
    expect(stats.avgPlacement).toBe(0)
  })

  test('totalRaceTime accumulates across all completed runs', () => {
    const races = [makeRace()]
    const runs = [
      makeRun({
        id: 'run-1',
        startedAt: '2026-03-12T00:00:00.000Z',
        endedAt: '2026-03-12T00:01:00.000Z',
        placement: 1,
      }),
      makeRun({
        id: 'run-2',
        startedAt: '2026-03-12T00:00:00.000Z',
        endedAt: '2026-03-12T00:02:00.000Z',
        placement: 2,
      }),
    ]
    const stats = aggregateAgentStats('agent-1', races, runs)

    // 1min + 2min = 3min = 180_000ms
    expect(stats.totalRaceTime).toBe(180_000)
  })
})
