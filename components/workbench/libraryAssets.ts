import type { AgentRegistration } from '@/lib/agents/types'
import type { PromptRef, SkillRef } from '@/lib/library/types'
import type { Step } from '@/lib/sequence/schema'
import type { ThreadSkillBadge } from '@/lib/thread-surfaces/types'

export interface LibraryAssetDraft {
  id: string
  title: string
  kind: 'prompt' | 'skill'
  path: string
  version: number
  summary: string
  content: string
  canonical: boolean
  editable: boolean
  tags: string[]
}

export interface NodeAssetContext {
  step: Partial<Step> & {
    id: string
    name: string
    model?: string
    status?: string
    type?: string
    role?: string
    cwd?: string
    prompt_file?: string
    prompt_ref?: PromptRef
    skill_refs?: SkillRef[]
    node_description?: string
    expected_outcome?: string
    input_contract?: string
    output_contract?: string
    assigned_agent_id?: string | null
  }
  sequenceName?: string
  phaseLabel?: string
  agent?: AgentRegistration | null
  threadSkills?: ThreadSkillBadge[]
}

export const DEFAULT_SKILL_DOCS: Record<string, Omit<LibraryAssetDraft, 'id' | 'canonical' | 'editable'>> = {
  search: {
    title: 'Search',
    kind: 'skill',
    path: '.threados/skills/search/SKILL.md',
    version: 1,
    summary: 'Research the task, verify claims, and return grounded findings.',
    content: `# Search\n\nUse search to ground claims before acting.\n\n## Rules\n- Prefer primary sources.\n- Record sources with the result.\n- Stop when evidence is sufficient.\n`,
    tags: ['research', 'verification'],
  },
  browser: {
    title: 'Browser',
    kind: 'skill',
    path: '.threados/skills/browser/SKILL.md',
    version: 1,
    summary: 'Operate the browser carefully for forms, screenshots, and UI flows.',
    content: `# Browser\n\nUse browser actions for navigation, extraction, and flow validation.\n\n## Rules\n- Prefer deterministic interactions.\n- Capture the smallest surface needed.\n- Retry only when state is ambiguous.\n`,
    tags: ['ui', 'automation'],
  },
  files: {
    title: 'Files',
    kind: 'skill',
    path: '.threados/skills/files/SKILL.md',
    version: 1,
    summary: 'Read and write workspace files without mutating unrelated state.',
    content: `# Files\n\nUse file access when the work is workspace-local.\n\n## Rules\n- Preserve existing structure.\n- Prefer targeted edits.\n- Never rewrite unrelated files.\n`,
    tags: ['workspace', 'editing'],
  },
  tools: {
    title: 'Tools',
    kind: 'skill',
    path: '.threados/skills/tools/SKILL.md',
    version: 1,
    summary: 'Choose the smallest viable toolset for the task.',
    content: `# Tools\n\nUse tools intentionally, not reflexively.\n\n## Rules\n- Prefer direct execution over speculation.\n- Keep the toolchain minimal.\n- Escalate only when the task requires it.\n`,
    tags: ['tooling', 'execution'],
  },
  model: {
    title: 'Model',
    kind: 'skill',
    path: '.threados/skills/model/SKILL.md',
    version: 1,
    summary: 'Tune the model loadout for the role and keep identity changes explicit.',
    content: `# Model\n\nUse model selection to tune capability, latency, and cost.\n\n## Rules\n- Model changes are identity changes when they alter behavior materially.\n- Keep prompt and skill bindings explicit.\n- Record the reason for a change.\n`,
    tags: ['loadout', 'identity'],
  },
  review: {
    title: 'Review',
    kind: 'skill',
    path: '.threados/skills/review/SKILL.md',
    version: 1,
    summary: 'Inspect changes, surface risks, and validate the outcome.',
    content: `# Review\n\nUse review to surface correctness and deployment risk.\n\n## Rules\n- Call out regressions directly.\n- Verify tests before concluding.\n- Separate findings from commentary.\n`,
    tags: ['quality', 'verification'],
  },
  orchestration: {
    title: 'Orchestration',
    kind: 'skill',
    path: '.threados/skills/orchestration/SKILL.md',
    version: 1,
    summary: 'Coordinate dependencies, gates, and execution order.',
    content: `# Orchestration\n\nUse orchestration to manage step flow and gate transitions.\n\n## Rules\n- Respect dependencies.\n- Keep transitions explicit.\n- Never bypass a review gate silently.\n`,
    tags: ['workflow', 'gates'],
  },
  spawn: {
    title: 'Spawn',
    kind: 'skill',
    path: '.threados/skills/spawn/SKILL.md',
    version: 1,
    summary: 'Grant the ability to spawn child agents onto a lower-tier surface.',
    content: `# Spawn\n\nUse spawn to create child agents on the next surface down.\n\n## Rules\n- Spawn rights must be user-granted.\n- Child agents appear one tier beneath the parent.\n- Register the child before it starts work.\n`,
    tags: ['hierarchy', 'child-agent'],
  },
}

export function buildPromptDrafts({ step, sequenceName, phaseLabel, agent }: NodeAssetContext): LibraryAssetDraft[] {
  const promptPath = step.prompt_ref?.path ?? step.prompt_file ?? `.threados/prompts/${step.id}.md`
  const promptVersion = step.prompt_ref?.version ?? 1
  const nodePrompt = step.node_description ?? `Describe how ${step.name} should operate inside ${sequenceName ?? 'this sequence'}.`
  const outcome = step.expected_outcome ?? `Produce a useful result for ${phaseLabel ?? 'the selected phase'}.`

  const primary: LibraryAssetDraft = {
    id: `${step.id}-prompt`,
    title: `${step.name} prompt`,
    kind: 'prompt',
    path: promptPath,
    version: promptVersion,
    summary: 'Primary node prompt bound to this step.',
    content: `# ${step.name}\n\n## What this node is\n${nodePrompt}\n\n## Expected outcome\n${outcome}\n\n## Inputs\n${step.input_contract ?? 'Use the step context, dependencies, and current surface state.'}\n\n## Outputs\n${step.output_contract ?? 'Return concise work output, notes, and any follow-on actions.'}\n\n## Role\n${step.role ?? agent?.role ?? 'Role not specified yet.'}\n`,
    canonical: true,
    editable: true,
    tags: ['node', 'prompt'],
  }

  const loadout: LibraryAssetDraft = {
    id: `${step.id}-loadout`,
    title: `${step.name} loadout prompt`,
    kind: 'prompt',
    path: `.threados/prompts/${step.id}.loadout.md`,
    version: 1,
    summary: 'Prompt draft for the agent loadout attached to this node.',
    content: `# ${step.name} loadout\n\nUse the attached model, role, and skills as the active loadout.\n\n## Model\n${step.model ?? agent?.model ?? 'Unassigned'}\n\n## Role\n${step.role ?? agent?.role ?? 'Unassigned'}\n\n## Prompt binding\n${promptPath}\n\n## Skills\n${(step.skill_refs?.map(ref => ref.id).join(', ') || agent?.skillRefs?.map(ref => ref.id).join(', ') || 'None yet')}\n`,
    canonical: false,
    editable: true,
    tags: ['loadout', 'prompt'],
  }

  const spawn: LibraryAssetDraft = {
    id: `${step.id}-spawn`,
    title: `${step.name} spawn prompt`,
    kind: 'prompt',
    path: `.threados/prompts/${step.id}.spawn.md`,
    version: 1,
    summary: 'Prompt draft for lower-tier child agents spawned from this node.',
    content: `# ${step.name} spawn\n\nUse this prompt when spawning a child agent.\n\n## Hierarchy rule\nSpawn onto the next lower surface only.\n\n## Spawn condition\n${step.skill_refs?.some(ref => ref.id === 'spawn') || agent?.skillRefs?.some(ref => ref.id === 'spawn') ? 'Spawn is explicitly granted for this loadout.' : 'Spawn is not yet granted for this loadout.'}\n\n## Child agent brief\nCarry forward the parent context, but keep the child scoped to the delegated subtask.\n`,
    canonical: false,
    editable: true,
    tags: ['spawn', 'child-agent'],
  }

  return [primary, loadout, spawn]
}

export function buildSkillDrafts(step: NodeAssetContext['step'], agent: AgentRegistration | null, surfaceSkills: ThreadSkillBadge[] = []): LibraryAssetDraft[] {
  const refs = step.skill_refs?.length
    ? step.skill_refs
    : agent?.skillRefs?.length
      ? agent.skillRefs
      : surfaceSkills.map(skill => ({
          id: skill.id,
          version: 1,
          path: `.threados/skills/${skill.id}/SKILL.md`,
          capabilities: [],
        }))

  const ids = refs.map(ref => ref.id)
  const canonicalIds = ids.length > 0 ? ids : ['search', 'browser', 'files', 'tools', 'spawn']

  return canonicalIds.map(id => {
    const base = DEFAULT_SKILL_DOCS[id] ?? {
      title: id.replace(/-/g, ' '),
      kind: 'skill' as const,
      path: `.threados/skills/${id}/SKILL.md`,
      version: 1,
      summary: 'User-authored skill.',
      content: `# ${id}\n\nDescribe how this skill should behave.\n`,
      tags: ['custom'],
    }

    return {
      id,
      title: base.title,
      kind: 'skill' as const,
      path: base.path,
      version: base.version,
      summary: base.summary,
      content: base.content,
      canonical: true,
      editable: true,
      tags: base.tags,
    }
  })
}

export function formatSkillSummary(skillIds: string[], limit = 3): string {
  if (skillIds.length === 0) return 'No skills yet'
  const visible = skillIds.slice(0, limit)
  const overflow = skillIds.length - visible.length
  return overflow > 0 ? `${visible.join(' · ')} +${overflow}` : visible.join(' · ')
}

export function formatToolSummary(tools: string[] = []): string {
  if (tools.length === 0) return 'No tools bound'
  return tools.join(' · ')
}
