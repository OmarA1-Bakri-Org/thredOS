import { readAgentState } from '@/lib/agents/repository'
import { aggregateAgentStats, type AgentStats } from '@/lib/agents/stats'
import { readThreadRunnerState } from '@/lib/thread-runner/repository'
import { getBasePath } from '@/lib/config'

function computePerformanceData(stats: AgentStats) {
  const passRate = stats.totalRuns > 0
    ? ((stats.totalRuns - stats.disqualifications - stats.losses) / stats.totalRuns) * 100
    : 0

  const avgTimeMs = stats.totalRuns > 0
    ? Math.round(stats.totalRaceTime / stats.totalRuns)
    : 0

  // Quality: derived from avg placement (1st = 10, 5th+ = 5)
  const quality = stats.avgPlacement > 0
    ? Math.min(10, Math.max(1, Math.round(11 - stats.avgPlacement * 1.5)))
    : 0

  return {
    totalRuns: stats.totalRuns,
    passRate: Math.round(passRate),
    avgTimeMs,
    quality,
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const agentId = url.searchParams.get('agentId')

    if (!agentId) {
      return Response.json({ error: 'Missing agentId query parameter' }, { status: 400 })
    }

    const bp = getBasePath()
    const [agentState, runnerState] = await Promise.all([
      readAgentState(bp),
      readThreadRunnerState(bp),
    ])

    const agent = agentState.agents.find(a => a.id === agentId)
    if (!agent) {
      return Response.json({ stats: null })
    }

    const stats = aggregateAgentStats(agentId, runnerState.races, runnerState.combatantRuns)

    if (stats.totalRuns === 0) {
      return Response.json({ stats: null })
    }

    return Response.json({ stats: computePerformanceData(stats) })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
