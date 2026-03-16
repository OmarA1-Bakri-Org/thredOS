export interface AgentSkill {
  id: string
  label: string
  inherited?: boolean
}

export interface AgentRegistration {
  id: string
  name: string
  description?: string
  registeredAt: string
  builderId: string
  builderName: string
  threadSurfaceIds: string[]
  metadata?: Record<string, unknown>
  model?: string
  skills?: AgentSkill[]
}

export interface AgentState {
  version: number
  agents: AgentRegistration[]
}
