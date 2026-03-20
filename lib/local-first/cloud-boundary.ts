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
  skillIds: z.array(z.string()),
  tools: z.array(z.string()),
})

export type CloudAgentRegistrationPayload = z.infer<typeof CloudAgentRegistrationPayloadSchema>

export const CloudPerformancePayloadSchema = z.object({
  id: z.string(),
  registrationNumber: z.string(),
  recordedAt: z.string(),
  outcome: z.enum(['pass', 'fail', 'needs_review']),
  durationMs: z.number().int().nonnegative().nullable(),
  qualityScore: z.number().int().min(0).max(10).nullable(),
  notes: z.string().nullable(),
})

export type CloudPerformancePayload = z.infer<typeof CloudPerformancePayloadSchema>

export function sanitizeAgentForCloud(
  agent: AgentRegistration,
  input: Omit<CloudAgentRegistrationPayload, 'agentId' | 'name' | 'model' | 'role' | 'skillIds' | 'tools'>,
): CloudAgentRegistrationPayload {
  return CloudAgentRegistrationPayloadSchema.parse({
    ...input,
    agentId: agent.id,
    name: agent.name,
    model: agent.model ?? 'unassigned',
    role: agent.role ?? 'unspecified',
    skillIds: (agent.skillRefs ?? []).map(skill => skill.id),
    tools: agent.tools ?? [],
  })
}

export function sanitizePerformanceForCloud(
  input: CloudPerformancePayload,
): CloudPerformancePayload {
  return CloudPerformancePayloadSchema.parse(input)
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
