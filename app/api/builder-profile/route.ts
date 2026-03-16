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

    // Find the builder name from their agents, falling back to pack data
    const builderAgent = agentState.agents.find(a => a.builderId === builderId)
    const builderPack = !builderAgent
      ? packState.packs.find(p => p.builderId === builderId)
      : undefined

    const builderName = builderAgent?.builderName ?? builderPack?.builderName
    if (!builderName) {
      return NextResponse.json({ error: `No agents or packs found for builder '${builderId}'` }, { status: 404 })
    }

    const profile = deriveBuilderProfile(
      builderId,
      builderName,
      agentState.agents,
      packState.packs,
    )

    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ error: 'Failed to derive builder profile' }, { status: 500 })
  }
}
