import type { ChatCompletionTool, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions'
import type { ProposedAction } from './validator'
import { CHAT_MUTATION_COMMANDS, isChatMutationCommand } from './commands'

/**
 * Tool definition for the chat LLM to propose thredOS actions.
 * Used with OpenAI/OpenRouter function calling (tools parameter).
 */
export const CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_actions',
      description:
        'Propose one or more thredOS sequence mutation actions for user review before applying.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Array of proposed thredOS actions',
            items: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  enum: [...CHAT_MUTATION_COMMANDS],
                  description:
                    `The thredOS sequence mutation command (${CHAT_MUTATION_COMMANDS.join(', ')})`,
                },
                args: {
                  type: 'object',
                  description: 'Command arguments (varies by command)',
                },
              },
              required: ['command', 'args'],
            },
          },
        },
        required: ['actions'],
      },
    },
  },
]

/**
 * Parse tool_calls from the LLM response into ProposedAction[].
 * Filters to only the propose_actions tool and validates each action.
 * Never throws — returns [] on failure.
 */
export function parseToolCallActions(
  toolCalls: ChatCompletionMessageToolCall[],
): ProposedAction[] {
  const proposeCall = toolCalls.find(
    (tc): tc is Extract<ChatCompletionMessageToolCall, { type: 'function' }> =>
      tc.type === 'function' && 'function' in tc && tc.function.name === 'propose_actions',
  )
  if (!proposeCall) return []

  try {
    const parsed = JSON.parse(proposeCall.function.arguments)
    if (!Array.isArray(parsed.actions)) return []

    return parsed.actions.filter(
      (a: unknown): a is ProposedAction =>
        typeof a === 'object' &&
        a !== null &&
        'command' in a &&
        typeof (a as ProposedAction).command === 'string' &&
        'args' in a &&
        typeof (a as ProposedAction).args === 'object' &&
        (a as ProposedAction).args !== null &&
        !Array.isArray((a as ProposedAction).args) &&
        isChatMutationCommand((a as ProposedAction).command),
    )
  } catch {
    return []
  }
}
