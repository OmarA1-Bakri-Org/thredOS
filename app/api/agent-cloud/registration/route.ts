import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import { registerCloudAgent, findCloudAgentRegistration } from '@/lib/agents/cloud-registry'
import { readAgentState, updateAgentState } from '@/lib/agents/repository'

const BodySchema = z.object({
  agentId: z.string().min(1),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const agentId = url.searchParams.get('agentId')
  const registrationNumber = url.searchParams.get('registrationNumber')

  if (!agentId && !registrationNumber) {
    return NextResponse.json({ error: 'agentId or registrationNumber is required' }, { status: 400 })
  }

  const registration = await findCloudAgentRegistration(getBasePath(), { agentId, registrationNumber })
  return NextResponse.json({ registration })
}

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
  }

  const basePath = getBasePath()
  const state = await readAgentState(basePath)
  const agent = state.agents.find(item => item.id === parsed.data.agentId)
  if (!agent) {
    return NextResponse.json({ error: `Agent '${parsed.data.agentId}' not found` }, { status: 404 })
  }

  const registration = await registerCloudAgent(basePath, agent)
  await updateAgentState(basePath, current => ({
    ...current,
    agents: current.agents.map(item => item.id === agent.id
      ? {
          ...item,
          registrationNumber: registration.registrationNumber,
          cloudSyncedAt: new Date().toISOString(),
        }
      : item),
  }))

  return NextResponse.json({ registration }, { status: 201 })
}
