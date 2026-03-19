import { createHash } from 'crypto'
import type { SkillRef } from '@/lib/library/types'
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

export function buildAgentComposition(input: {
  model?: string
  role?: string
  skillRefs?: SkillRef[]
  tools?: string[]
}): AgentComposition {
  const model = input.model ?? 'unknown'
  const role = input.role ?? 'unspecified'
  const skillRefs = normalizeSkillRefs(input.skillRefs)
  const tools = sorted(input.tools)
  const identityHash = createHash('sha256')
    .update(JSON.stringify({
      model,
      role,
      tools,
      skills: skillRefs.map(skill => ({
        id: skill.id,
        version: skill.version,
        capabilities: skill.capabilities ?? [],
      })),
    }))
    .digest('hex')

  return {
    model,
    role,
    skillRefs,
    tools,
    identityHash,
  }
}

export function detectMaterialChange(current: AgentComposition, proposed: AgentComposition): MaterialChangeDecision {
  const reasons: string[] = []
  if (current.model !== proposed.model) reasons.push('model changed')
  if (current.role !== proposed.role) reasons.push('role changed')

  const currentTools = sorted(current.tools)
  const proposedTools = sorted(proposed.tools)
  if (JSON.stringify(currentTools) !== JSON.stringify(proposedTools)) reasons.push('toolset changed')

  const currentSkills = normalizeSkillRefs(current.skillRefs)
  const proposedSkills = normalizeSkillRefs(proposed.skillRefs)
  if (JSON.stringify(currentSkills) !== JSON.stringify(proposedSkills)) reasons.push('attached skill set changed')

  return {
    material: reasons.length > 0,
    reasons,
    currentIdentityHash: current.identityHash,
    proposedIdentityHash: proposed.identityHash,
  }
}

