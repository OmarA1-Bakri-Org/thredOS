import { NextRequest } from 'next/server'
import { readSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { createConfiguredProvider, getConfiguredModel } from '@/lib/llm/providers'
import type { Sequence } from '@/lib/sequence/schema'

const MAX_MESSAGE_LENGTH = 10_000

type SendFn = (type: string, data: Record<string, unknown>) => void

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

    const systemPrompt = `You are a ThreadOS assistant helping manage a sequence with ${sequence.steps.length} steps. Help the user understand and modify their sequence.`
    const completion = await provider.client.chat.completions.create({
      model: provider.defaultModel ?? resolvedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: true,
    })

    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        send('message', { content, streaming: true })
      }
    }

    send('actions', { actions: [] })
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
