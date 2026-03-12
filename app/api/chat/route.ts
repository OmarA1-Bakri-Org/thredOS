import { NextRequest } from 'next/server'
import { readSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'

const MAX_MESSAGE_LENGTH = 10_000

/**
 * Chat API endpoint — SSE stream
 * POST { message: string }
 * Returns SSE events: message, actions, diff, done
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { message } = body

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return new Response(JSON.stringify({ error: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`))
      }

      try {
        // Try to load current sequence
        let sequence
        try {
          sequence = await readSequence(getBasePath())
        } catch {
          sequence = null
        }

        // If ANTHROPIC_API_KEY is set, we'd call Claude here
        // For now, echo the message with context-aware response
        if (process.env.ANTHROPIC_API_KEY && sequence) {
          // Future: call Anthropic API with buildSystemPrompt(sequence)
          // Stream response chunks as type: 'message'
          // Parse actions from response as type: 'actions'
          // Run dry-run and send type: 'diff'
        }

        // Stub response — sanitize user input to prevent injection
        const sanitizedMessage = message.replace(/[<>"]/g, '')
        const responseText = sequence
          ? `I see your sequence with ${sequence.steps.length} steps. You said: "${sanitizedMessage}". I'm ready to help manage your sequence — but I need an LLM API key to provide intelligent suggestions.`
          : `No sequence found. You said: "${sanitizedMessage}". Try running \`seqctl init\` first to create a sequence.`

        send('message', { content: responseText })
        send('actions', { actions: [] })
        send('done', {})
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
