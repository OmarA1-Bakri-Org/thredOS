import { describe, test, expect } from 'bun:test'
import { OPTIMIZATION_TOOLS, parseOptimizationToolCall } from './optimization-tools'

describe('OPTIMIZATION_TOOLS', () => {
  test('defines propose_optimizations tool', () => {
    const tool = OPTIMIZATION_TOOLS.find(t => t.type === 'function' && 'function' in t && t.function.name === 'propose_optimizations')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
  })
})

describe('parseOptimizationToolCall', () => {
  test('parses valid tool call', () => {
    const args = JSON.stringify({
      suggestions: [{
        category: 'parallelize',
        title: 'Run A and B in parallel',
        description: 'Steps A and B have no dependencies on each other',
        confidence: 0.9,
        impact: 'high',
        actions: [{ command: 'dep remove', args: { from: 'b', to: 'a' } }],
      }],
      summary: 'Found 1 optimization.',
    })
    const result = parseOptimizationToolCall(args)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].category).toBe('parallelize')
    expect(result.summary).toBe('Found 1 optimization.')
  })

  test('returns empty for invalid JSON', () => {
    const result = parseOptimizationToolCall('not json')
    expect(result.suggestions).toEqual([])
  })

  test('filters invalid suggestions', () => {
    const args = JSON.stringify({
      suggestions: [
        { category: 'parallelize', title: 'Valid', description: 'd', confidence: 0.8, impact: 'high', actions: [] },
        { bad: 'data' },
      ],
      summary: 'test',
    })
    const result = parseOptimizationToolCall(args)
    expect(result.suggestions).toHaveLength(1)
  })
})
