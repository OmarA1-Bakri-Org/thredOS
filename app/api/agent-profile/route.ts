import { readAgentState } from '@/lib/agents/repository'
import { aggregateAgentStats } from '@/lib/agents/stats'
import { readPackState } from '@/lib/packs/repository'
import { buildAgentProfile, type ProfileNodeContext } from '@/lib/agents/profile'
import { readThreadRunnerState } from '@/lib/thread-runner/repository'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { AgentRegistration } from '@/lib/agents/types'

const BASE_PATH = process.cwd()

function buildProfileNodeContext(
  surfaceState: Awaited<ReturnType<typeof readThreadSurfaceState>>,
  agent: AgentRegistration,
  threadSurfaceId: string,
): ProfileNodeContext {
  const surface = surfaceState.threadSurfaces.find(s => s.id === threadSurfaceId)
  const run = surfaceState.runs.find(r => r.threadSurfaceId === threadSurfaceId)

  return {
    surfaceLabel: surface?.surfaceLabel ?? 'Unknown',
    depth: surface?.depth ?? 0,
    childCount: surface?.childSurfaceIds.length ?? 0,
    role: surface?.role ?? null,
    runStatus: run?.runStatus ?? null,
    runSummary: run?.runSummary ?? null,
    linkedSurfaceCount: agent.threadSurfaceIds.length,
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const threadSurfaceId = url.searchParams.get('threadSurfaceId')

    if (!threadSurfaceId) {
      return Response.json({ error: 'Missing threadSurfaceId query parameter' }, { status: 400 })
    }

    const agentState = await readAgentState(BASE_PATH)
    const agent = agentState.agents.find(a => a.threadSurfaceIds.includes(threadSurfaceId)) ?? null

    if (!agent) {
      return Response.json({ profile: null })
    }

    const [packState, runnerState, surfaceState] = await Promise.all([
      readPackState(BASE_PATH),
      readThreadRunnerState(BASE_PATH),
      readThreadSurfaceState(BASE_PATH),
    ])

    const stats = aggregateAgentStats(agent.id, runnerState.races, runnerState.combatantRuns)
    const pack = packState.packs.find(p => p.builderId === agent.builderId) ?? null
    const node = buildProfileNodeContext(surfaceState, agent, threadSurfaceId)
    const profile = buildAgentProfile({ agent, stats, pack, node })

    return Response.json({ profile })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
