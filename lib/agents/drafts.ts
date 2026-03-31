import type { AgentRegistration, AgentSkill } from '@/lib/agents/types'
import type { PromptRef, SkillRef } from '@/lib/library/types'

export interface AgentDraftStep {
  id: string
  name: string
  model?: string
  type?: string
  prompt_file?: string
  prompt_ref?: PromptRef
  skill_refs?: SkillRef[]
  node_description?: string
  expected_outcome?: string
}

export interface AgentDraftShape {
  stepId: string | null
  id: string
  name: string
  description: string
  role: string
  model: string
  promptRef: PromptRef | null
  selectedPromptId: string | null
  focusedSkillId: string | null
  skillRefs: SkillRef[]
  tools: string[]
}

export interface AgentPromptSelection {
  id: string
  version: number
  path: string
  canonical: boolean
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function inferAgentRole(step: AgentDraftStep, fallbackRole?: string | null): string {
  if (fallbackRole && fallbackRole.trim().length > 0) return fallbackRole
  const stepName = step.name.toLowerCase()
  if (stepName.includes('orchestrator')) return 'orchestrator'
  if (stepName.includes('review')) return 'reviewer'
  if (stepName.includes('research')) return 'researcher'
  if (stepName.includes('build')) return 'builder'
  return step.type === 'b' ? 'builder' : 'worker'
}

export function buildAgentDraft(input: {
  step: AgentDraftStep
  agent: AgentRegistration | null
  promptRef: PromptRef | null
  selectedPromptId?: string | null
  skillRefs: SkillRef[]
  toolIds: string[]
  role?: string | null
}): AgentDraftShape {
  const { step, agent, promptRef, selectedPromptId, skillRefs, toolIds, role } = input
  const canonicalPromptRef = agent?.promptRef
    ?? agent?.composition?.promptRef
    ?? promptRef
    ?? step.prompt_ref
    ?? (step.prompt_file
      ? {
          id: step.id,
          version: 1,
          path: step.prompt_file,
        }
      : null)
  const canonicalSkillRefs = agent?.skillRefs?.length
    ? agent.skillRefs
    : agent?.composition?.skillRefs?.length
      ? agent.composition.skillRefs
      : skillRefs
  const tools = agent?.tools?.length
    ? agent.tools
    : agent?.composition?.tools?.length
      ? agent.composition.tools
      : toolIds
  return {
    stepId: step.id,
    id: agent?.id ?? (slugify(step.name) || step.id),
    name: agent?.name ?? step.name,
    description: agent?.description ?? step.node_description ?? step.expected_outcome ?? `${step.name} canonical agent`,
    role: inferAgentRole(step, role ?? agent?.role ?? null),
    model: agent?.model ?? agent?.composition?.model ?? step.model ?? 'claude-code',
    promptRef: canonicalPromptRef,
    selectedPromptId: selectedPromptId ?? canonicalPromptRef?.id ?? null,
    focusedSkillId: canonicalSkillRefs[0]?.id ?? null,
    skillRefs: canonicalSkillRefs,
    tools,
  }
}

export function buildAgentSkills(skillRefs: SkillRef[]): AgentSkill[] {
  return skillRefs.map((skill) => ({
    id: skill.id,
    label: skill.id.replace(/[-_]+/g, ' '),
  }))
}

export function buildAgentRegistrationInput(input: {
  draft: AgentDraftShape
  agent: AgentRegistration | null
  threadSurfaceId: string
}) {
  const { draft, agent, threadSurfaceId } = input
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    builderId: agent?.builderId ?? 'local@thredos',
    builderName: agent?.builderName ?? 'Local Builder',
    model: draft.model,
    role: draft.role,
    promptRef: draft.promptRef,
    tools: draft.tools,
    skillRefs: draft.skillRefs,
    skills: buildAgentSkills(draft.skillRefs),
    threadSurfaceIds: threadSurfaceId ? [threadSurfaceId] : [],
  }
}

export function applyPromptSelection(
  draft: AgentDraftShape,
  prompt: AgentPromptSelection,
): Partial<AgentDraftShape> {
  return {
    selectedPromptId: prompt.id,
    ...(prompt.canonical
      ? {
          promptRef: {
            id: prompt.id,
            version: prompt.version,
            path: prompt.path,
          },
        }
      : {
          promptRef: draft.promptRef,
        }),
  }
}
