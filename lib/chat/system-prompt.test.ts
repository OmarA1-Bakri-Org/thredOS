import { describe, test, expect } from 'bun:test'
import { buildSystemPrompt } from './system-prompt'
import type { Sequence } from '../sequence/schema'

const mockSequence: Sequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [
    {
      id: 'step-1',
      name: 'Step One',
      type: 'base',
      model: 'claude-code',
      prompt_file: 'prompts/step-1.md',
      depends_on: [],
      status: 'RUNNING',
    },
    {
      id: 'step-2',
      name: 'Step Two',
      type: 'p',
      model: 'claude-code',
      prompt_file: 'prompts/step-2.md',
      depends_on: ['step-1'],
      status: 'READY',
    },
  ],
  gates: [
    { id: 'gate-1', name: 'Review Gate', depends_on: ['step-1'], status: 'PENDING', cascade: false, childGateIds: [] },
  ],
}

describe('buildSystemPrompt', () => {
  test('includes sequence name', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('test-seq')
  })

  test('includes step IDs and statuses', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('step-1')
    expect(prompt).toContain('RUNNING')
    expect(prompt).toContain('step-2')
    expect(prompt).toContain('READY')
  })

  test('includes gate info', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('gate-1')
    expect(prompt).toContain('PENDING')
  })

  test('includes available commands', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('step add')
    expect(prompt).toContain('step remove')
    expect(prompt).toContain('gate approve')
    expect(prompt).toContain('dep add')
  })

  test('includes safety rules', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('NEVER auto-execute')
    expect(prompt).toContain('ProposedAction')
  })

  test('includes step types reference', () => {
    const prompt = buildSystemPrompt(mockSequence)
    expect(prompt).toContain('base')
    expect(prompt).toContain('fusion')
    expect(prompt).toContain('Long-autonomy')
  })
})
