import { readAgentState } from '@/lib/agents/repository'
import { aggregateAgentStats } from '@/lib/agents/stats'
import { getBasePath } from '@/lib/config'
import { requireRequestSession } from '@/lib/api-helpers'
import { readPackState } from '@/lib/packs/repository'
import { buildAgentProfile, type ProfileNodeContext } from '@/lib/agents/profile'
import { readThreadRunnerState } from '@/lib/thread-runner/repository'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { AgentRegistration } from '@/lib/agents/types'
import { NextResponse } from 'next/server'

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
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const basePath = getBasePath()
    const url = new URL(request.url)
    const threadSurfaceId = url.searchParams.get('threadSurfaceId')

    if (!threadSurfaceId) {
      return NextResponse.json({ error: 'Missing threadSurfaceId query parameter' }, { status: 400 })
    }

    const agentState = await readAgentState(basePath)
    const agent = agentState.agents.find(a => a.threadSurfaceIds.includes(threadSurfaceId)) ?? null

    if (!agent) {
      return NextResponse.json({ profile: null })
    }

    const [packState, runnerState, surfaceState] = await Promise.all([
      readPackState(basePath),
      readThreadRunnerState(basePath),
      readThreadSurfaceState(basePath),
    ])

    const stats = aggregateAgentStats(agent.id, runnerState.races, runnerState.combatantRuns)
    const pack = packState.packs.find(p => p.builderId === agent.builderId) ?? null
    const node = buildProfileNodeContext(surfaceState, agent, threadSurfaceId)
    const profile = buildAgentProfile({ agent, stats, pack, node })

    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
