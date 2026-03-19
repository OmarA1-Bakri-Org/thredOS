import type { SkillRef } from '@/lib/library/types'

export interface AgentSkill {
  id: string
  label: string
  inherited?: boolean
}

export interface AgentComposition {
  model: string
  role: string
  skillRefs: SkillRef[]
  tools: string[]
  identityHash: string
}

export interface MaterialChangeDecision {
  material: boolean
  reasons: string[]
  currentIdentityHash: string
  proposedIdentityHash: string
}

export interface AgentRegistration {
  id: string
  name: string
  description?: string
  registeredAt: string
  registrationNumber?: string
  cloudSyncedAt?: string | null
  builderId: string
  builderName: string
  threadSurfaceIds: string[]
  metadata?: Record<string, unknown>
  model?: string
  skills?: AgentSkill[]
  role?: string
  tools?: string[]
  skillRefs?: SkillRef[]
  composition?: AgentComposition
  version?: number
  supersedesAgentId?: string | null
}

export interface AgentState {
  version: number
  agents: AgentRegistration[]
}
