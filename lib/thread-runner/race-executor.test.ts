import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { enrollRace, recordRun, getRaceResults, listRaces } from './race-executor'

describe('race-executor', () => {
  const tmpDir = join(import.meta.dir, '..', '..', 'tmp-race-exec-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.threados', 'state', 'thread-runner.json'),
      JSON.stringify({ version: 1, races: [], combatantRuns: [] })
    )
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('enrollRace creates a race and persists it', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'Race 1', division: 'Frontline', classification: 'Alpha', maxCombatants: 4,
    })
    expect(race.id).toBeDefined()
    expect(race.status).toBe('open')
    expect(race.combatantRunIds).toEqual([])

    const races = await listRaces(tmpDir)
    expect(races).toHaveLength(1)
  })

  test('recordRun attaches a run to a race', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 4,
    })

    const run = await recordRun(tmpDir, {
      raceId: race.id,
      combatantId: 'agent-1',
      threadSurfaceId: 'ts-1',
    })

    expect(run.id).toBeDefined()
    expect(run.status).toBe('pending')
    expect(run.raceId).toBe(race.id)
  })

  test('getRaceResults returns sorted placements', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 4,
    })

    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a1', threadSurfaceId: 'ts-1' })
    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a2', threadSurfaceId: 'ts-2' })

    const results = await getRaceResults(tmpDir, race.id)
    expect(results.raceId).toBe(race.id)
    expect(results.placements).toEqual([])
  })

  test('recordRun rejects when race is full', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 1,
    })
    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a1', threadSurfaceId: 'ts-1' })

    await expect(
      recordRun(tmpDir, { raceId: race.id, combatantId: 'a2', threadSurfaceId: 'ts-2' })
    ).rejects.toThrow('full')
  })

  test('recordRun rejects when race does not exist', async () => {
    await expect(
      recordRun(tmpDir, { raceId: 'nonexistent', combatantId: 'a1', threadSurfaceId: 'ts-1' })
    ).rejects.toThrow('not found')
  })
})
