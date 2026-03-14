export interface AgentRegistration {
  id: string
  name: string
  description?: string
  registeredAt: string
  builderId: string
  builderName: string
  threadSurfaceIds: string[]
  metadata?: Record<string, unknown>
}

export interface AgentState {
  version: number
  agents: AgentRegistration[]
}
