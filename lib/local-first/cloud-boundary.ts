import { z } from 'zod'
import type { AgentRegistration } from '@/lib/agents/types'

const FORBIDDEN_CLOUD_KEYS = new Set([
  'prompt',
  'promptContent',
  'skillContent',
  'workflowContent',
  'sequence',
  'thread',
  'threadSurface',
  'artifact',
  'artifacts',
  'provenance',
  'workspace',
  'workspaceFile',
  'workspacePath',
])

export const CloudAgentRegistrationPayloadSchema = z.object({
  registrationNumber: z.string(),
  agentId: z.string(),
  identityHash: z.string(),
  version: z.number().int().positive(),
  registeredAt: z.string(),
  supersedesRegistrationNumber: z.string().nullable(),
  name: z.string(),
  model: z.string(),
  role: z.string(),
  promptRef: z.object({
    id: z.string(),
    version: z.number().int().positive(),
  }).nullable(),
  skillRefs: z.array(z.object({
    id: z.string(),
    version: z.number().int().positive(),
    capabilities: z.array(z.string()),
  })),
  skillIds: z.array(z.string()),
  tools: z.array(z.string()),
})

export type CloudAgentRegistrationPayload = z.infer<typeof CloudAgentRegistrationPayloadSchema>

export function sanitizeAgentForCloud(
  agent: AgentRegistration,
  input: Omit<CloudAgentRegistrationPayload, 'agentId' | 'name' | 'model' | 'role' | 'promptRef' | 'skillRefs' | 'skillIds' | 'tools'>,
): CloudAgentRegistrationPayload {
  return CloudAgentRegistrationPayloadSchema.parse({
    ...input,
    agentId: agent.id,
    name: agent.name,
    model: agent.model ?? 'unassigned',
    role: agent.role ?? 'unspecified',
    promptRef: agent.promptRef
      ? {
          id: agent.promptRef.id,
          version: agent.promptRef.version,
        }
      : null,
    skillRefs: (agent.skillRefs ?? []).map(skill => ({
      id: skill.id,
      version: skill.version,
      capabilities: skill.capabilities ?? [],
    })),
    skillIds: (agent.skillRefs ?? []).map(skill => skill.id),
    tools: agent.tools ?? [],
  })
}

export function collectForbiddenCloudKeys(value: unknown): string[] {
  const matches = new Set<string>()

  function walk(candidate: unknown) {
    if (!candidate || typeof candidate !== 'object') return
    if (Array.isArray(candidate)) {
      candidate.forEach(walk)
      return
    }

    for (const [key, nested] of Object.entries(candidate)) {
      if (FORBIDDEN_CLOUD_KEYS.has(key)) {
        matches.add(key)
      }
      walk(nested)
    }
  }

  walk(value)
  return [...matches]
}
