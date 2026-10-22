import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { buildAgentComposition } from '@/lib/agents/composition'
import { updateAgentState } from '@/lib/agents/repository'
import type { AgentRegistration } from '@/lib/agents/types'
import type { PromptRef, SkillRef } from '@/lib/library/types'
import { assertPortableRelativePath, assertSafePathSegment, resolvePathWithinRoot } from '@/lib/security/safe-path'

export interface RegisteredFixtureStep {
  id: string
  model: string
  prompt_file: string
  role?: string
  prompt_ref?: PromptRef | null
  skill_refs?: SkillRef[]
  assigned_agent_id?: string | null
  agent_ref?: string | null
}

async function materializeAsset(basePath: string, path: string, content: string): Promise<void> {
  assertPortableRelativePath(path, 'fixture canonical asset path')
  const target = await resolvePathWithinRoot(basePath, ...path.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, { flag: 'wx' }).catch(error => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  })
}

function fixtureAgentId(step: RegisteredFixtureStep): string {
  const id = `fixture-${assertSafePathSegment(step.id, 'fixture step id')}`
  if ((step.assigned_agent_id && step.assigned_agent_id !== id) || (step.agent_ref && step.agent_ref !== id)) {
    throw new Error(`Fixture setup refuses to register an unknown assignment for ${step.id}`)
  }
  return id
}

/** Explicit setup for declared fixture steps; never called by production or shared setup. */
export async function registerSequenceAgents<T extends RegisteredFixtureStep>(
  basePath: string,
  steps: readonly T[],
): Promise<Array<T & { assigned_agent_id: string; agent_ref: string; prompt_ref: PromptRef; skill_refs: SkillRef[] }>> {
  const bound = steps.map(step => {
    const id = fixtureAgentId(step)
    const promptRef = step.prompt_ref ?? { id: step.id, version: 1, path: step.prompt_file }
    return { ...step, assigned_agent_id: id, agent_ref: id, prompt_ref: promptRef, skill_refs: step.skill_refs ?? [] }
  })
  const agents: AgentRegistration[] = []
  for (const step of bound) {
    await materializeAsset(basePath, step.prompt_ref.path ?? step.prompt_file, `# ${step.id}\n`)
    for (const skill of step.skill_refs) {
      assertSafePathSegment(skill.id, 'fixture skill id')
      await materializeAsset(basePath, skill.path ?? `.threados/skills/${skill.id}/SKILL.md`, `# ${skill.id}\nRegistered fixture skill.\n`)
    }
    agents.push({
      id: step.assigned_agent_id,
      name: `Fixture ${step.id}`,
      builderId: 'fixture-builder',
      builderName: 'Fixture Builder',
      registeredAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      threadSurfaceIds: [],
      composition: buildAgentComposition({
        model: step.model, role: step.role, promptRef: step.prompt_ref,
        skillRefs: step.skill_refs, tools: [],
      }),
    })
  }
  await updateAgentState(basePath, current => {
    for (const agent of agents) {
      const existing = current.agents.find(item => item.id === agent.id)
      if (existing && existing.composition?.identityHash !== agent.composition?.identityHash) {
        throw new Error(`Fixture identity ${agent.id} already has a different composition`)
      }
    }
    return { ...current, agents: [...current.agents, ...agents.filter(agent => !current.agents.some(item => item.id === agent.id))] }
  })
  return bound
}
