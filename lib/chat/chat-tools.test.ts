import { describe, test, expect } from 'bun:test'
import { CHAT_TOOLS, parseToolCallActions } from './chat-tools'
import { CHAT_MUTATION_COMMANDS } from './commands'

describe('CHAT_TOOLS', () => {
  test('defines a propose_actions tool', () => {
    const fnTools = CHAT_TOOLS.filter((t): t is Extract<typeof t, { type: 'function' }> => t.type === 'function')
    const tool = fnTools.find(t => t.function.name === 'propose_actions')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
    expect(tool!.function.parameters).toBeDefined()
    const actionItem = (
      tool!.function.parameters as {
        properties: {
          actions: {
            items: {
              properties: {
                command: { enum?: string[] }
              }
            }
          }
        }
      }
    ).properties.actions.items
    expect(actionItem.properties.command.enum).toEqual([...CHAT_MUTATION_COMMANDS])
    expect(tool!.function.description).not.toContain('run')
    expect(JSON.stringify(tool!.function.parameters)).not.toContain('run')
    expect(JSON.stringify(tool!.function.parameters)).not.toContain('stop')
    expect(JSON.stringify(tool!.function.parameters)).not.toContain('restart')
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

  test('filters out runtime and invalid actions from parsed result', () => {
    const toolCalls = [{
      id: 'call_4',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [
            { command: 'run', args: {} },
            { command: 'step update', args: { id: 'step-1', name: 'Renamed' } },
            { notACommand: true },
            { command: 'unknown', args: {} },
          ],
        }),
      },
    }]
    const result = parseToolCallActions(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].command).toBe('step update')
  })

  test('filters out malformed args while keeping allowed mutation actions', () => {
    const toolCalls = [{
      id: 'call_6',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [
            { command: 'step add', args: 'bad-args' },
            { command: 'dep add' },
            { command: 'group create', args: ['not', 'an', 'object'] },
            { command: 'gate block', args: { id: 'gate-1' } },
          ],
        }),
      },
    }]

    expect(parseToolCallActions(toolCalls)).toEqual([
      { command: 'gate block', args: { id: 'gate-1' } },
    ])
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
