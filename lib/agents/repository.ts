import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { AgentRegistration, AgentState } from './types'

// ---------------------------------------------------------------------------
// Persistent file-based state
// ---------------------------------------------------------------------------

const AGENT_STATE_PATH = '.threados/state/agents.json'

const DEFAULT_AGENT_STATE: AgentState = {
  version: 1,
  agents: [],
}

export function getAgentStatePath(basePath: string): string {
  return join(basePath, AGENT_STATE_PATH)
}

export async function readAgentState(basePath: string): Promise<AgentState> {
  const fullPath = getAgentStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_AGENT_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<AgentState>

  return {
    version: 1,
    agents: Array.isArray(raw.agents) ? raw.agents : [],
  }
}

export async function writeAgentState(basePath: string, state: AgentState): Promise<void> {
  const fullPath = getAgentStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updateAgentState(
  basePath: string,
  updater: (currentState: AgentState) => AgentState | Promise<AgentState>,
): Promise<AgentState> {
  const currentState = await readAgentState(basePath)
  const nextState = await updater(currentState)
  await writeAgentState(basePath, nextState)
  return nextState
}

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

export class AgentRepository {
  private agents: Map<string, AgentRegistration> = new Map()

  registerAgent(agent: AgentRegistration): void {
    this.agents.set(agent.id, agent)
  }

  getAgent(agentId: string): AgentRegistration | null {
    return this.agents.get(agentId) ?? null
  }

  listAgents(): AgentRegistration[] {
    return Array.from(this.agents.values())
  }

  getAgentByBuilderId(builderId: string): AgentRegistration | null {
    for (const agent of this.agents.values()) {
      if (agent.builderId === builderId) return agent
    }
    return null
  }

  linkThreadSurface(agentId: string, threadSurfaceId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    if (agent.threadSurfaceIds.includes(threadSurfaceId)) return false
    agent.threadSurfaceIds.push(threadSurfaceId)
    return true
  }

  unlinkThreadSurface(agentId: string, threadSurfaceId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    const idx = agent.threadSurfaceIds.indexOf(threadSurfaceId)
    if (idx === -1) return false
    agent.threadSurfaceIds.splice(idx, 1)
    return true
  }
}
