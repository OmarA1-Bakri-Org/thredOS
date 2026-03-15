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

interface RequiredStringField {
  value: unknown
  label: string
}

function validateRequiredStrings(fields: RequiredStringField[]): NextResponse | null {
  for (const { value, label } of fields) {
    if (!value || typeof value !== 'string') {
      return jsonError(`Missing or invalid ${label}`, 'VALIDATION_ERROR', 400)
    }
  }
  return null
}

function buildAgent(body: Partial<AgentRegistration>): AgentRegistration {
  return {
    id: body.id!,
    name: body.name!,
    description: body.description,
    registeredAt: body.registeredAt || new Date().toISOString(),
    builderId: body.builderId!,
    builderName: body.builderName!,
    threadSurfaceIds: Array.isArray(body.threadSurfaceIds) ? body.threadSurfaceIds : [],
    metadata: body.metadata,
    model: body.model,
    skills: Array.isArray(body.skills) ? body.skills : undefined,
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AgentRegistration>

    const validationError = validateRequiredStrings([
      { value: body.id, label: 'agent id' },
      { value: body.name, label: 'agent name' },
      { value: body.builderId, label: 'builderId' },
      { value: body.builderName, label: 'builderName' },
    ])
    if (validationError) return validationError

    const agent = buildAgent(body)
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
