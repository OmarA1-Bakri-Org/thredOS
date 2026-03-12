import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError, jsonError } from '@/lib/api-helpers'
import { readAgentState, updateAgentState } from '@/lib/agents/repository'
import type { AgentRegistration } from '@/lib/agents/types'

export async function GET() {
  try {
    const state = await readAgentState(getBasePath())
    return NextResponse.json({ agents: state.agents })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AgentRegistration>

    if (!body.id || typeof body.id !== 'string') {
      return jsonError('Missing or invalid agent id', 'VALIDATION_ERROR', 400)
    }
    if (!body.name || typeof body.name !== 'string') {
      return jsonError('Missing or invalid agent name', 'VALIDATION_ERROR', 400)
    }
    if (!body.builderId || typeof body.builderId !== 'string') {
      return jsonError('Missing or invalid builderId', 'VALIDATION_ERROR', 400)
    }
    if (!body.builderName || typeof body.builderName !== 'string') {
      return jsonError('Missing or invalid builderName', 'VALIDATION_ERROR', 400)
    }

    const agent: AgentRegistration = {
      id: body.id,
      name: body.name,
      description: body.description,
      registeredAt: body.registeredAt || new Date().toISOString(),
      builderId: body.builderId,
      builderName: body.builderName,
      threadSurfaceIds: Array.isArray(body.threadSurfaceIds) ? body.threadSurfaceIds : [],
      metadata: body.metadata,
    }

    const bp = getBasePath()

    const updated = await updateAgentState(bp, (state) => {
      if (state.agents.some(a => a.id === agent.id)) {
        throw new Error(`Agent '${agent.id}' already exists`)
      }
      return {
        ...state,
        agents: [...state.agents, agent],
      }
    })

    const registered = updated.agents.find(a => a.id === agent.id)!
    return NextResponse.json({ agent: registered }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(err.message, 'CONFLICT', 409)
    }
    return handleError(err)
  }
}
