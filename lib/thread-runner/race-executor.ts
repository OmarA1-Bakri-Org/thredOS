import { readThreadRunnerState, updateThreadRunnerState } from './repository'
import type { CombatantRun, Race, RaceResult } from './types'

interface EnrollRaceInput {
  name: string
  division: string
  classification: string
  maxCombatants: number
}

interface RecordRunInput {
  raceId: string
  combatantId: string
  threadSurfaceId: string
}

export async function enrollRace(basePath: string, input: EnrollRaceInput): Promise<Race> {
  const race: Race = {
    id: `race-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name,
    division: input.division,
    classification: input.classification,
    startAt: new Date().toISOString(),
    endAt: null,
    status: 'open',
    maxCombatants: input.maxCombatants,
    combatantRunIds: [],
  }

  await updateThreadRunnerState(basePath, (state) => ({
    ...state,
    races: [...state.races, race],
  }))

  return race
}

export async function recordRun(basePath: string, input: RecordRunInput): Promise<CombatantRun> {
  const state = await readThreadRunnerState(basePath)
  const race = state.races.find(r => r.id === input.raceId)

  if (!race) {
    throw new Error(`Race ${input.raceId} not found`)
  }

  if (race.combatantRunIds.length >= race.maxCombatants) {
    throw new Error(`Race ${input.raceId} is full (max ${race.maxCombatants})`)
  }

  const run: CombatantRun = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    raceId: input.raceId,
    combatantId: input.combatantId,
    threadSurfaceId: input.threadSurfaceId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'pending',
    verifiedAt: null,
    placement: null,
  }

  await updateThreadRunnerState(basePath, (state) => {
    const raceToUpdate = state.races.find(r => r.id === input.raceId)
    if (raceToUpdate) {
      raceToUpdate.combatantRunIds.push(run.id)
    }
    return {
      ...state,
      combatantRuns: [...state.combatantRuns, run],
    }
  })

  return run
}

export async function listRaces(basePath: string): Promise<Race[]> {
  const state = await readThreadRunnerState(basePath)
  return state.races
}

export async function getRaceResults(basePath: string, raceId: string): Promise<RaceResult> {
  const state = await readThreadRunnerState(basePath)
  const race = state.races.find(r => r.id === raceId)

  if (!race) {
    return { raceId, placements: [] }
  }

  const completedRuns = race.combatantRunIds
    .map(id => state.combatantRuns.find(r => r.id === id))
    .filter((run): run is CombatantRun => run != null && run.status === 'completed' && run.placement != null)
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))

  return {
    raceId,
    placements: completedRuns.map(run => ({
      combatantRunId: run.id,
      combatantId: run.combatantId,
      placement: run.placement!,
      time: run.endedAt && run.startedAt
        ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
        : 0,
      verifiedAt: run.verifiedAt ?? new Date().toISOString(),
    })),
  }
}
