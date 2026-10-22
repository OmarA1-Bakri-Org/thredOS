import { join } from 'path'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import { ensureStateRoot } from '@/lib/runtime/paths'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '@/lib/security/safe-path'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
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
  let content: string
  try {
    const fullPath = await resolveExistingPathWithinRoot(basePath, '.threados', 'state', 'agents.json')
    content = await readTextFileNoFollow(fullPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return structuredClone(DEFAULT_AGENT_STATE)
    }
    throw error
  }

  const raw = JSON.parse(content) as Partial<AgentState>

  return {
    version: 1,
    agents: Array.isArray(raw.agents) ? raw.agents : [],
  }
}

async function withAgentStateLock<T>(basePath: string, operation: () => Promise<T>): Promise<T> {
  const stateRoot = await ensureStateRoot(basePath)
  const lockPath = await resolvePathWithinRoot(stateRoot, 'agents.json.lock')
  return withExclusiveFileLock(lockPath, operation, { allowedRoot: basePath })
}

async function writeAgentStateUnlocked(basePath: string, state: AgentState): Promise<void> {
  const stateRoot = await resolveExistingPathWithinRoot(basePath, '.threados', 'state')
  const fullPath = await resolvePathWithinRoot(stateRoot, 'agents.json')
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`, { allowedRoot: basePath })
}

export async function writeAgentState(basePath: string, state: AgentState): Promise<void> {
  await withAgentStateLock(basePath, () => writeAgentStateUnlocked(basePath, state))
}

export async function updateAgentState(
  basePath: string,
  updater: (currentState: AgentState) => AgentState | Promise<AgentState>,
): Promise<AgentState> {
  return withAgentStateLock(basePath, async () => {
    const currentState = await readAgentState(basePath)
    const nextState = await updater(currentState)
    await writeAgentStateUnlocked(basePath, nextState)
    return nextState
  })
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
