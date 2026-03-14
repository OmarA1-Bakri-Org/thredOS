import type { CombatantRun, Race } from '../thread-runner/types'

export interface AgentStats {
  agentId: string
  totalRuns: number
  wins: number
  podiums: number
  losses: number
  disqualifications: number
  avgPlacement: number
  bestPlacement: number
  totalRaceTime: number
  divisions: Record<string, { runs: number; wins: number }>
}

/**
 * Aggregate stats for an agent across all their combatant runs.
 *
 * - wins: placement === 1
 * - podiums: placement <= 3
 * - losses: completed runs with placement > 3
 * - disqualifications: runs with status === 'disqualified'
 * - avgPlacement: average of all non-null placements
 * - bestPlacement: lowest (best) placement number
 * - totalRaceTime: sum of execution durations in ms
 * - divisions: per-division breakdown of runs and wins
 */
// ── Per-run accumulators ─────────────────────────────────────────────

interface RunAccumulator {
  wins: number
  podiums: number
  losses: number
  disqualifications: number
  placementSum: number
  placementCount: number
  bestPlacement: number
  totalRaceTime: number
  divisions: Record<string, { runs: number; wins: number }>
}

function emptyAccumulator(): RunAccumulator {
  return {
    wins: 0,
    podiums: 0,
    losses: 0,
    disqualifications: 0,
    placementSum: 0,
    placementCount: 0,
    bestPlacement: Infinity,
    totalRaceTime: 0,
    divisions: {},
  }
}

function ensureDivision(acc: RunAccumulator, division: string): void {
  if (!acc.divisions[division]) {
    acc.divisions[division] = { runs: 0, wins: 0 }
  }
  acc.divisions[division].runs++
}

function accumulatePlacement(acc: RunAccumulator, placement: number, division: string): void {
  acc.placementSum += placement
  acc.placementCount++
  if (placement < acc.bestPlacement) acc.bestPlacement = placement

  if (placement === 1) {
    acc.wins++
    acc.podiums++
    acc.divisions[division].wins++
  } else if (placement <= 3) {
    acc.podiums++
  } else {
    acc.losses++
  }
}

function accumulateRaceTime(acc: RunAccumulator, run: CombatantRun): void {
  if (!run.startedAt || !run.endedAt) return
  const duration = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
  if (duration > 0) acc.totalRaceTime += duration
}

function processRun(acc: RunAccumulator, run: CombatantRun, division: string): void {
  ensureDivision(acc, division)

  if (run.status === 'disqualified') {
    acc.disqualifications++
    return
  }

  if (run.placement != null) {
    accumulatePlacement(acc, run.placement, division)
  }

  accumulateRaceTime(acc, run)
}

export function aggregateAgentStats(
  agentId: string,
  races: Race[],
  runs: CombatantRun[],
): AgentStats {
  const agentRuns = runs.filter(r => r.combatantId === agentId)
  const raceMap = new Map(races.map(race => [race.id, race]))
  const acc = emptyAccumulator()

  for (const run of agentRuns) {
    const division = raceMap.get(run.raceId)?.division ?? 'unknown'
    processRun(acc, run, division)
  }

  return {
    agentId,
    totalRuns: agentRuns.length,
    wins: acc.wins,
    podiums: acc.podiums,
    losses: acc.losses,
    disqualifications: acc.disqualifications,
    avgPlacement: acc.placementCount > 0 ? acc.placementSum / acc.placementCount : 0,
    bestPlacement: acc.bestPlacement === Infinity ? 0 : acc.bestPlacement,
    totalRaceTime: acc.totalRaceTime,
    divisions: acc.divisions,
  }
}
