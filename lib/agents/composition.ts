import { createHash } from 'crypto'
import type { PromptRef, SkillRef } from '@/lib/library/types'
import type { AgentComposition, MaterialChangeDecision } from '@/lib/agents/types'

function sorted(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort((a, b) => a.localeCompare(b))
}

function normalizeSkillRefs(skillRefs: SkillRef[] | undefined): SkillRef[] {
  return [...(skillRefs ?? [])]
    .map(skill => ({
      id: skill.id,
      version: skill.version,
      path: skill.path,
      capabilities: sorted(skill.capabilities),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function normalizePromptRef(promptRef: PromptRef | null | undefined): PromptRef | null {
  if (!promptRef?.id) return null
  return {
    id: promptRef.id,
    version: promptRef.version,
    path: promptRef.path,
  }
}

function buildIdentityPrompt(promptRef: PromptRef | null): { id: string; version: number } | null {
  if (!promptRef) return null
  return {
    id: promptRef.id,
    version: promptRef.version,
  }
}

function buildIdentitySkills(skillRefs: SkillRef[]): Array<{ id: string; version: number; capabilities: string[] }> {
  return skillRefs.map(skill => ({
    id: skill.id,
    version: skill.version,
    capabilities: skill.capabilities ?? [],
  }))
}

export function buildAgentComposition(input: {
  model?: string
  role?: string
  promptRef?: PromptRef | null
  skillRefs?: SkillRef[]
  tools?: string[]
}): AgentComposition {
  const model = input.model ?? 'unknown'
  const role = input.role ?? 'unspecified'
  const promptRef = normalizePromptRef(input.promptRef)
  const skillRefs = normalizeSkillRefs(input.skillRefs)
  const tools = sorted(input.tools)
  const identityHash = createHash('sha256')
    .update(JSON.stringify({
      model,
      role,
      prompt: buildIdentityPrompt(promptRef),
      tools,
      skills: buildIdentitySkills(skillRefs),
    }))
    .digest('hex')

  return {
    model,
    role,
    promptRef,
    skillRefs,
    tools,
    identityHash,
  }
}

export function buildRegisteredAgentComposition(input: {
  model?: string
  role?: string
  promptRef?: PromptRef | null
  skillRefs?: SkillRef[]
  tools?: string[]
  composition?: AgentComposition
}): AgentComposition {
  return buildAgentComposition({
    model: input.composition?.model ?? input.model,
    role: input.composition?.role ?? input.role,
    promptRef: input.composition?.promptRef ?? input.promptRef ?? null,
    skillRefs: input.composition?.skillRefs?.length ? input.composition.skillRefs : input.skillRefs,
    tools: input.composition?.tools ?? input.tools,
  })
}

export function detectMaterialChange(current: AgentComposition, proposed: AgentComposition): MaterialChangeDecision {
  const reasons: string[] = []
  if (current.model !== proposed.model) reasons.push('model changed')
  if (current.role !== proposed.role) reasons.push('role changed')
  if (JSON.stringify(buildIdentityPrompt(current.promptRef)) !== JSON.stringify(buildIdentityPrompt(proposed.promptRef))) {
    reasons.push('prompt changed')
  }

  const currentTools = sorted(current.tools)
  const proposedTools = sorted(proposed.tools)
  if (JSON.stringify(currentTools) !== JSON.stringify(proposedTools)) reasons.push('toolset changed')

  const currentSkills = buildIdentitySkills(normalizeSkillRefs(current.skillRefs))
  const proposedSkills = buildIdentitySkills(normalizeSkillRefs(proposed.skillRefs))
  if (JSON.stringify(currentSkills) !== JSON.stringify(proposedSkills)) reasons.push('attached skill set changed')

  return {
    material: reasons.length > 0,
    reasons,
    currentIdentityHash: current.identityHash,
    proposedIdentityHash: proposed.identityHash,
  }
}
