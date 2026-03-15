import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { readAgentState } from '@/lib/agents/repository'
import { readPackState } from '@/lib/packs/repository'
import { deriveBuilderProfile } from '@/lib/builders/repository'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const builderId = url.searchParams.get('builderId')

    if (!builderId) {
      return NextResponse.json({ error: 'Missing builderId query parameter' }, { status: 400 })
    }

    const bp = getBasePath()
    const [agentState, packState] = await Promise.all([
      readAgentState(bp),
      readPackState(bp),
    ])

    // Find the builder name from their agents
    const builderAgent = agentState.agents.find(a => a.builderId === builderId)
    if (!builderAgent) {
      return NextResponse.json({ error: `No agents found for builder '${builderId}'` }, { status: 404 })
    }

    const profile = deriveBuilderProfile(
      builderId,
      builderAgent.builderName,
      agentState.agents,
      packState.packs,
    )

    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ error: 'Failed to derive builder profile' }, { status: 500 })
  }
}
