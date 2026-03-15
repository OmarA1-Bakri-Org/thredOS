import { describe, test, expect } from 'bun:test'
import { CHAT_TOOLS, parseToolCallActions } from './chat-tools'

describe('CHAT_TOOLS', () => {
  test('defines a propose_actions tool', () => {
    const fnTools = CHAT_TOOLS.filter((t): t is Extract<typeof t, { type: 'function' }> => t.type === 'function')
    const tool = fnTools.find(t => t.function.name === 'propose_actions')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
    expect(tool!.function.parameters).toBeDefined()
  })
})

describe('parseToolCallActions', () => {
  test('parses valid tool call arguments', () => {
    const toolCalls = [{
      id: 'call_1',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [{ command: 'step add', args: { id: 'x', name: 'X', type: 'base', model: 'claude-code', prompt_file: 'p.md' } }],
        }),
      },
    }]
    const result = parseToolCallActions(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].command).toBe('step add')
  })

  test('returns empty for non-propose_actions calls', () => {
    const toolCalls = [{
      id: 'call_2',
      type: 'function' as const,
      function: { name: 'other_tool', arguments: '{}' },
    }]
    expect(parseToolCallActions(toolCalls)).toEqual([])
  })

  test('returns empty for malformed arguments', () => {
    const toolCalls = [{
      id: 'call_3',
      type: 'function' as const,
      function: { name: 'propose_actions', arguments: 'not json' },
    }]
    expect(parseToolCallActions(toolCalls)).toEqual([])
  })

  test('filters out invalid actions from parsed result', () => {
    const toolCalls = [{
      id: 'call_4',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [
            { command: 'run', args: {} },
            { notACommand: true },
          ],
        }),
      },
    }]
    const result = parseToolCallActions(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].command).toBe('run')
  })

  test('returns empty array when actions field is missing', () => {
    const toolCalls = [{
      id: 'call_5',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({ reasoning: 'no actions needed' }),
      },
    }]
    expect(parseToolCallActions(toolCalls)).toEqual([])
  })
})
