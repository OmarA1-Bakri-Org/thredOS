import { describe, test, expect, beforeEach } from 'bun:test'
import { mkdtemp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  checkEligibility,
  ThreadRunnerRepository,
  readThreadRunnerState,
  writeThreadRunnerState,
  updateThreadRunnerState,
  getThreadRunnerStatePath,
} from './repository'
import type { ThreadRunnerState } from './repository'
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

// ---------------------------------------------------------------------------
// Persistent file-based state
// ---------------------------------------------------------------------------

describe('Persistent ThreadRunnerState', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'thread-runner-state-'))
  })

  const makeSampleState = (): ThreadRunnerState => ({
    version: 1,
    races: [
      {
        id: 'race-1',
        name: 'Sprint Alpha',
        division: 'open',
        classification: 'qualifier',
        startAt: '2026-03-12T00:00:00.000Z',
        endAt: null,
        status: 'open',
        maxCombatants: 8,
        combatantRunIds: ['run-1'],
      },
    ],
    combatantRuns: [
      {
        id: 'run-1',
        raceId: 'race-1',
        combatantId: 'combatant-1',
        threadSurfaceId: 'ts-1',
        startedAt: '2026-03-12T00:01:00.000Z',
        endedAt: null,
        status: 'running',
        verifiedAt: null,
        placement: null,
      },
    ],
  })

  test('readThreadRunnerState returns empty default state when file does not exist', async () => {
    const state = await readThreadRunnerState(tempDir)
    expect(state.version).toBe(1)
    expect(state.races).toEqual([])
    expect(state.combatantRuns).toEqual([])
  })

  test('writeThreadRunnerState creates the file and readThreadRunnerState reads it back', async () => {
    const sample = makeSampleState()
    await writeThreadRunnerState(tempDir, sample)

    const statePath = getThreadRunnerStatePath(tempDir)
    const { existsSync } = await import('fs')
    expect(existsSync(statePath)).toBe(true)

    const restored = await readThreadRunnerState(tempDir)
    expect(restored.version).toBe(1)
    expect(restored.races).toEqual(sample.races)
    expect(restored.combatantRuns).toEqual(sample.combatantRuns)
  })

  test('updateThreadRunnerState modifies existing state', async () => {
    const sample = makeSampleState()
    await writeThreadRunnerState(tempDir, sample)

    const updated = await updateThreadRunnerState(tempDir, (current) => {
      return {
        ...current,
        races: [
          ...current.races,
          {
            id: 'race-2',
            name: 'Sprint Beta',
            division: 'open',
            classification: 'final',
            startAt: '2026-03-13T00:00:00.000Z',
            endAt: null,
            status: 'open',
            maxCombatants: 4,
            combatantRunIds: [],
          },
        ],
      }
    })

    expect(updated.races).toHaveLength(2)
    expect(updated.races[1].id).toBe('race-2')

    // Verify persisted to disk
    const readBack = await readThreadRunnerState(tempDir)
    expect(readBack.races).toHaveLength(2)
    expect(readBack.races[1].name).toBe('Sprint Beta')
  })

  test('updateThreadRunnerState works on empty state when file does not exist', async () => {
    const updated = await updateThreadRunnerState(tempDir, (current) => {
      return {
        ...current,
        combatantRuns: [
          {
            id: 'run-new',
            raceId: 'race-1',
            combatantId: 'combatant-1',
            threadSurfaceId: 'ts-1',
            startedAt: '2026-03-12T00:01:00.000Z',
            endedAt: null,
            status: 'pending',
            verifiedAt: null,
            placement: null,
          },
        ],
      }
    })

    expect(updated.combatantRuns).toHaveLength(1)
    expect(updated.combatantRuns[0].id).toBe('run-new')

    const readBack = await readThreadRunnerState(tempDir)
    expect(readBack.combatantRuns).toHaveLength(1)
  })
})
