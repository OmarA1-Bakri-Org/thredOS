import { describe, expect, test } from 'bun:test'
import { buildAgentComposition, detectMaterialChange } from './composition'

describe('agent composition', () => {
  test('prompt changes are material', () => {
    const current = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-a', version: 1, path: '.threados/prompts/prompt-a.md' },
      skillRefs: [{ id: 'files', version: 1, capabilities: [] }],
      tools: ['shell'],
    })
    const proposed = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-b', version: 1, path: '.threados/prompts/prompt-b.md' },
      skillRefs: [{ id: 'files', version: 1, capabilities: [] }],
      tools: ['shell'],
    })

    const decision = detectMaterialChange(current, proposed)
    expect(decision.material).toBe(true)
    expect(decision.reasons).toContain('prompt changed')
  })

  test('skill version changes are material', () => {
    const current = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-a', version: 1, path: '.threados/prompts/prompt-a.md' },
      skillRefs: [{ id: 'files', version: 1, capabilities: [] }],
      tools: ['shell'],
    })
    const proposed = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-a', version: 1, path: '.threados/prompts/prompt-a.md' },
      skillRefs: [{ id: 'files', version: 2, capabilities: [] }],
      tools: ['shell'],
    })

    const decision = detectMaterialChange(current, proposed)
    expect(decision.material).toBe(true)
    expect(decision.reasons).toContain('attached skill set changed')
  })

  test('local path-only changes do not alter identity', () => {
    const current = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-a', version: 1, path: '.threados/prompts/prompt-a.md' },
      skillRefs: [{ id: 'files', version: 1, path: '.threados/skills/files/SKILL.md', capabilities: [] }],
      tools: ['shell'],
    })
    const proposed = buildAgentComposition({
      model: 'claude-code',
      role: 'builder',
      promptRef: { id: 'prompt-a', version: 1, path: '.threados/prompts/renamed-prompt-a.md' },
      skillRefs: [{ id: 'files', version: 1, path: '.threados/skills/files/ALT.md', capabilities: [] }],
      tools: ['shell'],
    })

    const decision = detectMaterialChange(current, proposed)
    expect(decision.material).toBe(false)
    expect(current.identityHash).toBe(proposed.identityHash)
  })
})
