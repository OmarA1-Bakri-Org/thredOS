import { describe, test, expect, beforeEach } from 'bun:test'
import { checkEligibility, ThreadRunnerRepository } from './repository'
import type { CombatantRun, Race } from './types'

describe('checkEligibility', () => {
  test('returns not eligible with all requirements locked', () => {
    const status = checkEligibility()
    expect(status.eligible).toBe(false)
    expect(status.requirements).toHaveLength(3)
    expect(status.requirements.every(r => !r.met)).toBe(true)
  })

  test('returns expected requirement keys', () => {
    const status = checkEligibility()
    const keys = status.requirements.map(r => r.key)
    expect(keys).toContain('verified-identity')
    expect(keys).toContain('vm-access')
    expect(keys).toContain('active-subscription')
  })
})

describe('ThreadRunnerRepository', () => {
  let repo: ThreadRunnerRepository

  beforeEach(() => {
    repo = new ThreadRunnerRepository()
  })

  const makeRace = (overrides: Partial<Race> = {}): Race => ({
    id: 'race-1',
    name: 'Sprint Alpha',
    division: 'open',
    classification: 'qualifier',
    startAt: '2026-03-12T00:00:00.000Z',
    endAt: null,
    status: 'open',
    maxCombatants: 8,
    combatantRunIds: [],
    ...overrides,
  })

  const makeRun = (overrides: Partial<CombatantRun> = {}): CombatantRun => ({
    id: 'run-1',
    raceId: 'race-1',
    combatantId: 'combatant-1',
    threadSurfaceId: 'ts-1',
    startedAt: '2026-03-12T00:01:00.000Z',
    endedAt: null,
    status: 'pending',
    verifiedAt: null,
    placement: null,
    ...overrides,
  })

  test('enrollRace and getRace', () => {
    const race = makeRace()
    repo.enrollRace(race)
    expect(repo.getRace('race-1')).toEqual(race)
  })

  test('getRace returns null for unknown id', () => {
    expect(repo.getRace('nonexistent')).toBeNull()
  })

  test('listRaces returns all enrolled races', () => {
    repo.enrollRace(makeRace({ id: 'race-1' }))
    repo.enrollRace(makeRace({ id: 'race-2', name: 'Sprint Beta' }))
    expect(repo.listRaces()).toHaveLength(2)
  })

  test('recordCombatantRun stores run and links to race', () => {
    repo.enrollRace(makeRace())
    const run = makeRun()
    repo.recordCombatantRun(run)
    expect(repo.getCombatantRun('run-1')).toEqual(run)
    expect(repo.getRace('race-1')!.combatantRunIds).toContain('run-1')
  })

  test('recordCombatantRun does not duplicate run id in race', () => {
    repo.enrollRace(makeRace())
    const run = makeRun()
    repo.recordCombatantRun(run)
    repo.recordCombatantRun(run)
    expect(repo.getRace('race-1')!.combatantRunIds.filter(id => id === 'run-1')).toHaveLength(1)
  })

  test('getCombatantRun returns null for unknown id', () => {
    expect(repo.getCombatantRun('nonexistent')).toBeNull()
  })

  test('getResultsForRace returns empty placements for unknown race', () => {
    const result = repo.getResultsForRace('nonexistent')
    expect(result.raceId).toBe('nonexistent')
    expect(result.placements).toHaveLength(0)
  })

  test('getResultsForRace returns sorted placements for completed runs', () => {
    repo.enrollRace(makeRace())
    repo.recordCombatantRun(makeRun({
      id: 'run-1',
      combatantId: 'c-1',
      status: 'completed',
      startedAt: '2026-03-12T00:01:00.000Z',
      endedAt: '2026-03-12T00:05:00.000Z',
      placement: 2,
      verifiedAt: '2026-03-12T00:06:00.000Z',
    }))
    repo.recordCombatantRun(makeRun({
      id: 'run-2',
      combatantId: 'c-2',
      status: 'completed',
      startedAt: '2026-03-12T00:01:00.000Z',
      endedAt: '2026-03-12T00:03:00.000Z',
      placement: 1,
      verifiedAt: '2026-03-12T00:04:00.000Z',
    }))
    repo.recordCombatantRun(makeRun({
      id: 'run-3',
      combatantId: 'c-3',
      status: 'failed',
      placement: null,
    }))

    const result = repo.getResultsForRace('race-1')
    expect(result.placements).toHaveLength(2)
    expect(result.placements[0].placement).toBe(1)
    expect(result.placements[0].combatantId).toBe('c-2')
    expect(result.placements[1].placement).toBe(2)
    expect(result.placements[1].combatantId).toBe('c-1')
    expect(result.placements[0].time).toBe(120_000) // 2 minutes
    expect(result.placements[1].time).toBe(240_000) // 4 minutes
  })

  test('getResultsForRace excludes non-completed runs', () => {
    repo.enrollRace(makeRace())
    repo.recordCombatantRun(makeRun({ status: 'running' }))
    repo.recordCombatantRun(makeRun({ id: 'run-2', status: 'disqualified' }))
    const result = repo.getResultsForRace('race-1')
    expect(result.placements).toHaveLength(0)
  })
})
