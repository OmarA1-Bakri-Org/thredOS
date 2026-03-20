import { NextRequest } from 'next/server'
import { readSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { requireRequestSession } from '@/lib/api-helpers'
import { createConfiguredProvider, getConfiguredModel } from '@/lib/llm/providers'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { extractActions } from '@/lib/chat/extract-actions'
import { ActionValidator } from '@/lib/chat/validator'
import { CHAT_TOOLS, parseToolCallActions } from '@/lib/chat/chat-tools'
import type { Sequence } from '@/lib/sequence/schema'
import type { ProposedAction } from '@/lib/chat/extract-actions'
import { applyRateLimit } from '@/lib/rate-limit'

const MAX_MESSAGE_LENGTH = 10_000

type SendFn = (type: string, data: Record<string, unknown>) => void

/**
 * Validate proposed actions and emit actions/diff/validation SSE events.
 * Shared by the tool_use, plain-text fallback, and streaming paths.
 */
async function emitValidatedActions(
  send: SendFn,
  proposedActions: ProposedAction[],
): Promise<void> {
  if (proposedActions.length > 0) {
    const validator = new ActionValidator(getBasePath())
    const dryRunResult = await validator.dryRun(proposedActions)
    send('actions', { actions: proposedActions })
    if (dryRunResult.valid && dryRunResult.diff) {
      send('diff', { diff: dryRunResult.diff })
    } else if (!dryRunResult.valid) {
      send('message', { content: `\n\nValidation: ${dryRunResult.errors.join(', ')}` })
    }
  } else {
    send('actions', { actions: [] })
  }
}

function buildJsonErrorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function tryLoadSequence(): Promise<Sequence | null> {
  try {
    return await readSequence(getBasePath())
  } catch {
    return null
  }
}

async function streamLlmResponse(
  send: SendFn,
  sequence: Sequence,
  message: string,
  resolvedModel: string,
): Promise<boolean> {
  try {
    const provider = createConfiguredProvider(process.env)
    if (!provider.client) return false

    const systemPrompt = buildSystemPrompt(sequence)

    // First: attempt non-streaming call with tool_use for structured output
    try {
      const toolResponse = await provider.client.chat.completions.create({
        model: provider.defaultModel ?? resolvedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        tools: CHAT_TOOLS,
        tool_choice: 'auto',
      })

      const choice = toolResponse.choices[0]
      if (choice?.message?.tool_calls?.length) {
        // Structured tool_use response — preferred path
        const textContent = choice.message.content ?? ''
        if (textContent) {
          send('message', { content: textContent })
        }

        const proposedActions = parseToolCallActions(choice.message.tool_calls)
        await emitValidatedActions(send, proposedActions)

        send('done', { model: resolvedModel, structured: true })
        return true
      }

      // No tool calls — model responded with plain text.
      const plainText = choice?.message?.content ?? ''
      if (plainText) {
        send('message', { content: plainText })
      }

      // Extract proposed actions from plain text (fallback)
      try {
        const proposedActions = extractActions(plainText)
        await emitValidatedActions(send, proposedActions)
      } catch (e) {
        console.error('[chat/route] Action extraction failed:', e)
        send('actions', { actions: [] })
      }

      send('done', { model: resolvedModel, structured: false })
      return true
    } catch (toolError) {
      // tool_use not supported by this model/backend — fall back to streaming
      console.warn('[chat/route] tool_use failed, falling back to streaming:', (toolError as Error).message)
    }

    // Fallback: streaming without tools (original path)
    const completion = await provider.client.chat.completions.create({
      model: provider.defaultModel ?? resolvedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: true,
    })

    let fullResponseText = ''
    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        send('message', { content, streaming: true })
        fullResponseText += content
      }
    }

    // Extract proposed actions from streamed text
    try {
      const proposedActions = extractActions(fullResponseText)
      await emitValidatedActions(send, proposedActions)
    } catch (e) {
      console.error('[chat/route] Action extraction failed:', e)
      send('actions', { actions: [] })
    }

    send('done', { model: resolvedModel })
    return true
  } catch {
    return false
  }
}

function sendStubResponse(send: SendFn, sequence: Sequence | null, message: string, resolvedModel: string) {
  const sanitizedMessage = message.replace(/[<>"]/g, '')
  const responseText = sequence
    ? `I see your sequence with ${sequence.steps.length} steps. You said: "${sanitizedMessage}". I'm ready to help manage your sequence — but I need an LLM API key to provide intelligent suggestions. Set THREADOS_MODEL and the corresponding API key in your .env file.`
    : `No sequence found. You said: "${sanitizedMessage}". Try running \`seqctl init\` first to create a sequence.`

  send('message', { content: responseText })
  send('actions', { actions: [] })
  send('done', { model: resolvedModel, stub: true })
}

/**
 * Chat API endpoint — SSE stream
 * POST { message: string, model?: string }
 * Returns SSE events: message, actions, diff, done
 */
export async function POST(request: NextRequest) {
  const session = requireRequestSession(request)
  if ('status' in session) return session

  const rateLimited = applyRateLimit(request, {
    bucket: 'chat',
    limit: 20,
    windowMs: 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const body = await request.json()
  const { message, model } = body

  if (!message || typeof message !== 'string') {
    return buildJsonErrorResponse('message is required', 400)
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return buildJsonErrorResponse(`message exceeds maximum length of ${MAX_MESSAGE_LENGTH}`, 400)
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send: SendFn = (type, data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`))
      }

      try {
        const sequence = await tryLoadSequence()
        const resolvedModel = model ?? getConfiguredModel(process.env)

        const llmStreamed = sequence
          ? await streamLlmResponse(send, sequence, message, resolvedModel)
          : false

        if (!llmStreamed) {
          sendStubResponse(send, sequence, message, resolvedModel)
        }
      } catch (e) {
        console.error('[chat/route] Error processing SSE stream:', e)
        send('message', { content: 'Error processing request' })
        send('done', {})
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
