import { describe, test, expect } from 'bun:test'
import { buildOptimizationPrompt } from './build-optimization-prompt'
import type { Sequence } from '@/lib/sequence/schema'

describe('buildOptimizationPrompt', () => {
  const minimalSequence: Sequence = {
    name: 'Test Seq',
    version: '1.0',
    steps: [
      { id: 'a', name: 'A', type: 'base', model: 'claude-code', prompt_file: 'a.md', depends_on: [], status: 'READY' },
      { id: 'b', name: 'B', type: 'base', model: 'claude-code', prompt_file: 'b.md', depends_on: [], status: 'READY' },
    ],
    gates: [],
    policy: { safe_mode: true, max_parallel: 4, max_spawn_depth: 10, max_children_per_surface: 20, max_total_surfaces: 200 },
  }

  test('includes sequence state', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('Test Seq')
  })

  test('includes optimization categories', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('parallelize')
    expect(prompt).toContain('add-gate')
  })

  test('includes the propose_optimizations tool reference', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('propose_optimizations')
  })

  test('handles empty sequence', () => {
    const empty: Sequence = {
      name: 'Empty',
      version: '1.0',
      steps: [],
      gates: [],
      policy: { safe_mode: true, max_parallel: 4, max_spawn_depth: 10, max_children_per_surface: 20, max_total_surfaces: 200 },
    }
    const prompt = buildOptimizationPrompt(empty)
    expect(prompt).toContain('Empty')
  })
})
