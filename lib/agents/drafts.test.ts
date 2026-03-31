import { describe, expect, test } from 'bun:test'
import { applyPromptSelection, type AgentDraftShape } from './drafts'

const baseDraft: AgentDraftShape = {
  stepId: 'step-a',
  id: 'agent-a',
  name: 'Agent A',
  description: 'Test agent',
  role: 'builder',
  model: 'claude-code',
  promptRef: { id: 'canonical-prompt', version: 1, path: '.threados/prompts/canonical.md' },
  selectedPromptId: 'canonical-prompt',
  focusedSkillId: 'files',
  skillRefs: [{ id: 'files', version: 1, path: '.threados/skills/files/SKILL.md', capabilities: [] }],
  tools: ['shell'],
}

describe('agent drafts', () => {
  test('canonical prompt selection updates promptRef', () => {
    const next = applyPromptSelection(baseDraft, {
      id: 'replacement-prompt',
      version: 2,
      path: '.threados/prompts/replacement.md',
      canonical: true,
    })

    expect(next.promptRef).toEqual({
      id: 'replacement-prompt',
      version: 2,
      path: '.threados/prompts/replacement.md',
    })
  })

  test('non-canonical prompt selection keeps the canonical promptRef', () => {
    const next = applyPromptSelection(baseDraft, {
      id: 'step-a-loadout',
      version: 1,
      path: '.threados/prompts/step-a.loadout.md',
      canonical: false,
    })

    expect(next.selectedPromptId).toBe('step-a-loadout')
    expect(next.promptRef).toEqual(baseDraft.promptRef)
  })
})
