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
export function aggregateAgentStats(
  agentId: string,
  races: Race[],
  runs: CombatantRun[],
): AgentStats {
  const agentRuns = runs.filter(r => r.combatantId === agentId)

  const raceMap = new Map<string, Race>()
  for (const race of races) {
    raceMap.set(race.id, race)
  }

  let wins = 0
  let podiums = 0
  let losses = 0
  let disqualifications = 0
  let placementSum = 0
  let placementCount = 0
  let bestPlacement = Infinity
  let totalRaceTime = 0
  const divisions: Record<string, { runs: number; wins: number }> = {}

  for (const run of agentRuns) {
    // Track division stats
    const race = raceMap.get(run.raceId)
    const division = race?.division ?? 'unknown'

    if (!divisions[division]) {
      divisions[division] = { runs: 0, wins: 0 }
    }
    divisions[division].runs++

    if (run.status === 'disqualified') {
      disqualifications++
      continue
    }

    if (run.placement != null) {
      placementSum += run.placement
      placementCount++

      if (run.placement < bestPlacement) {
        bestPlacement = run.placement
      }

      if (run.placement === 1) {
        wins++
        podiums++
        divisions[division].wins++
      } else if (run.placement <= 3) {
        podiums++
      } else {
        losses++
      }
    }

    // Accumulate race time
    if (run.startedAt && run.endedAt) {
      const start = new Date(run.startedAt).getTime()
      const end = new Date(run.endedAt).getTime()
      if (end > start) {
        totalRaceTime += end - start
      }
    }
  }

  return {
    agentId,
    totalRuns: agentRuns.length,
    wins,
    podiums,
    losses,
    disqualifications,
    avgPlacement: placementCount > 0 ? placementSum / placementCount : 0,
    bestPlacement: bestPlacement === Infinity ? 0 : bestPlacement,
    totalRaceTime,
    divisions,
  }
}
