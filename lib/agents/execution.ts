import { createHash } from 'crypto'
import { lstat } from 'fs/promises'
import { z } from 'zod'
import { PromptRefSchema, SkillRefSchema, type Step } from '../sequence/schema'
import { assertPortableRelativePath, assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { RuntimeServiceError } from '../runtime/errors'
import { buildAgentComposition, buildRegisteredAgentComposition } from './composition'
import { readAgentState } from './repository'
import type { AgentRegistration } from './types'
import type { AgentRegistrationEvidence } from '../contracts/schemas'

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/)

/** Execution evidence stored with the attempt, never reconstructed from a later assignment. */
export const AgentExecutionSnapshotSchema = z.object({
  registration_id: z.string().min(1),
  registration_version: z.number().int().positive(),
  composition_hash: DigestSchema,
  builder_id: z.string().min(1),
  registered_at: z.string().min(1),
  supersedes_agent_id: z.string().nullable(),
  model: z.string().min(1),
  role: z.string().min(1),
  prompt_ref: PromptRefSchema,
  skill_refs: z.array(SkillRefSchema),
  tools: z.array(z.string()),
  prompt_content_hash: DigestSchema,
  skill_content_hashes: z.array(z.object({
    id: z.string().min(1), version: z.number().int().positive(), content_hash: DigestSchema,
  })),
})
export type AgentExecutionSnapshot = z.infer<typeof AgentExecutionSnapshotSchema>

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readAsset(basePath: string, ref: { id: string; path?: string }, kind: 'prompt' | 'skill'): Promise<string> {
  let assetPath = ref.path
  if (!assetPath) {
    assertSafePathSegment(ref.id, `${kind} id`)
    assetPath = kind === 'prompt' ? `.threados/prompts/${ref.id}.md` : `.threados/skills/${ref.id}/SKILL.md`
  }
  assertPortableRelativePath(assetPath, `registered ${kind} path`)
  const path = await resolveExistingPathWithinRoot(basePath, ...assetPath.split('/'))
  const identity = await lstat(path, { bigint: true })
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error('Registered asset must be a regular file')
  await resolveExistingPathWithinRoot(basePath, ...assetPath.split('/'))
  return readTextFileNoFollow(path, {
    dev: identity.dev, ino: identity.ino, size: identity.size, mtimeNs: identity.mtimeNs,
  })
}

async function snapshot(basePath: string, agent: AgentRegistration): Promise<AgentExecutionSnapshot> {
  const composition = buildRegisteredAgentComposition(agent)
  if (!composition.promptRef || (agent.composition && agent.composition.identityHash !== composition.identityHash)) {
    throw new RuntimeServiceError('AGENT_REGISTRATION_INVALID', 'Registered agent has no valid canonical composition')
  }
  try {
    const prompt = await readAsset(basePath, composition.promptRef, 'prompt')
    const skillHashes = await Promise.all(composition.skillRefs.map(async ref => ({
      id: ref.id, version: ref.version, content_hash: digest(await readAsset(basePath, ref, 'skill')),
    })))
    return AgentExecutionSnapshotSchema.parse({
      registration_id: agent.id,
      registration_version: agent.version ?? 1,
      composition_hash: composition.identityHash,
      builder_id: agent.builderId,
      registered_at: agent.registeredAt,
      supersedes_agent_id: agent.supersedesAgentId ?? null,
      model: composition.model,
      role: composition.role,
      prompt_ref: composition.promptRef,
      skill_refs: composition.skillRefs,
      tools: composition.tools,
      prompt_content_hash: digest(prompt),
      skill_content_hashes: skillHashes,
    })
  } catch (error) {
    throw new RuntimeServiceError('AGENT_REGISTRATION_INVALID', 'Registered prompt or skill assets are unavailable or unsafe', error)
  }
}

export async function resolveStepAgent(
  basePath: string,
  step: Step,
  frozen?: AgentExecutionSnapshot | null,
): Promise<{ step: Step; registration: AgentExecutionSnapshot }> {
  if (!frozen && step.assigned_agent_id && step.agent_ref && step.assigned_agent_id !== step.agent_ref) {
    throw new RuntimeServiceError('AGENT_COMPOSITION_MISMATCH', 'Step agent assignment aliases disagree')
  }
  const id = frozen?.registration_id ?? step.assigned_agent_id ?? step.agent_ref
  if (!id) throw new RuntimeServiceError('AGENT_REGISTRATION_REQUIRED', 'Every executable step requires a registered agent')
  const state = await readAgentState(basePath)
  const matches = state.agents.filter(agent => agent.id === id)
  if (matches.length !== 1) throw new RuntimeServiceError('AGENT_NOT_REGISTERED', 'Assigned agent is not uniquely registered')
  const current = await snapshot(basePath, matches[0]!)
  if (frozen) {
    if (JSON.stringify(current) !== JSON.stringify(AgentExecutionSnapshotSchema.parse(frozen))) {
      throw new RuntimeServiceError('AGENT_IDENTITY_CHANGED', 'Frozen registration or its versioned assets changed; register a replacement agent')
    }
  } else {
    const declared = buildAgentComposition({
      model: step.model, role: step.role ?? current.role,
      promptRef: step.prompt_ref, skillRefs: step.skill_refs, tools: current.tools,
    })
    if (declared.identityHash !== current.composition_hash) {
      throw new RuntimeServiceError('AGENT_COMPOSITION_MISMATCH', 'Step loadout differs from its registered agent; assign a matching registration')
    }
  }
  const registration = frozen ? AgentExecutionSnapshotSchema.parse(frozen) : current
  return { registration, step: {
    ...step,
    assigned_agent_id: registration.registration_id,
    agent_ref: registration.registration_id,
    model: registration.model,
    role: registration.role,
    prompt_ref: registration.prompt_ref,
    prompt_file: registration.prompt_ref.path ?? `.threados/prompts/${registration.prompt_ref.id}.md`,
    skill_refs: registration.skill_refs,
  } }
}

export async function readRegisteredPrompt(basePath: string, registration: AgentExecutionSnapshot): Promise<string> {
  const prompt = await readAsset(basePath, registration.prompt_ref, 'prompt')
  if (digest(prompt) !== registration.prompt_content_hash) {
    throw new RuntimeServiceError('AGENT_IDENTITY_CHANGED', 'Registered prompt content changed after identity was frozen')
  }
  return prompt
}

export function agentRegistrationEvidence(registration: AgentExecutionSnapshot): AgentRegistrationEvidence {
  return {
    registration_id: registration.registration_id,
    registration_version: registration.registration_version,
    composition_hash: registration.composition_hash,
    builder_id: registration.builder_id,
    supersedes_agent_id: registration.supersedes_agent_id,
    prompt_content_hash: registration.prompt_content_hash,
  }
}
