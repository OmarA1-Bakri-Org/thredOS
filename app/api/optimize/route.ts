import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { readSequence } from '@/lib/sequence/parser'
import { createConfiguredProvider } from '@/lib/llm/providers'
import { buildOptimizationPrompt } from '@/lib/autoresearch/build-optimization-prompt'
import { OPTIMIZATION_TOOLS, parseOptimizationToolCall } from '@/lib/autoresearch/optimization-tools'
import { ActionValidator, type ProposedAction } from '@/lib/chat/validator'
import { extractActions } from '@/lib/chat/extract-actions'
import type { OptimizationCategory } from '@/lib/autoresearch/types'

const CATEGORY_HINTS: { pattern: RegExp; category: OptimizationCategory }[] = [
  { pattern: /parallel|concurren/i, category: 'parallelize' },
  { pattern: /gate|approv|block/i, category: 'add-gate' },
  { pattern: /remove.*dep|drop.*dep|decouple/i, category: 'remove-dep' },
  { pattern: /reorder|move.*before|move.*after|swap/i, category: 'reorder' },
  { pattern: /reassign|agent|assign/i, category: 'reassign-agent' },
]

function inferCategoryFromActions(actions: ProposedAction[], content: string): OptimizationCategory {
  // Check action commands first
  for (const action of actions) {
    const cmd = action.command.toLowerCase()
    for (const hint of CATEGORY_HINTS) {
      if (hint.pattern.test(cmd)) return hint.category
    }
  }
  // Fall back to content-based inference
  for (const hint of CATEGORY_HINTS) {
    if (hint.pattern.test(content)) return hint.category
  }
  // Default to reorder as the most generic structural change
  return 'reorder'
}

export async function POST() {
  try {
    const bp = getBasePath()
    const sequence = await readSequence(bp)

    const provider = createConfiguredProvider(process.env)
    if (!provider.client) {
      return NextResponse.json({ error: 'No LLM provider configured' }, { status: 503 })
    }

    const systemPrompt = buildOptimizationPrompt(sequence)

    const completion = await provider.client.chat.completions.create({
      model: provider.defaultModel ?? 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Analyze this sequence and propose optimizations.' },
      ],
      tools: OPTIMIZATION_TOOLS,
      tool_choice: { type: 'function', function: { name: 'propose_optimizations' } },
    })

    const message = completion.choices[0]?.message
    let result

    const toolCall = message?.tool_calls?.[0]
    if (toolCall && toolCall.type === 'function' && 'function' in toolCall) {
      result = parseOptimizationToolCall(toolCall.function.arguments)
    } else if (message?.content) {
      const actions = extractActions(message.content)
      result = {
        analyzedAt: new Date().toISOString(),
        suggestions: actions.length > 0 ? [{
          id: 'opt-0',
          category: inferCategoryFromActions(actions, message.content),
          title: 'Suggested changes',
          description: message.content.slice(0, 200),
          confidence: 0.5,
          impact: 'medium' as const,
          actions,
        }] : [],
        summary: message.content.slice(0, 500),
      }
    } else {
      result = { analyzedAt: new Date().toISOString(), suggestions: [], summary: 'No suggestions.' }
    }

    const validator = new ActionValidator(bp)
    for (const suggestion of result.suggestions) {
      if (suggestion.actions.length > 0) {
        const dryResult = await validator.dryRun(suggestion.actions)
        if (!dryResult.valid) {
          suggestion.confidence = Math.max(0, suggestion.confidence - 0.3)
          suggestion.description += ` (Validation warnings: ${dryResult.errors.join(', ')})`
        }
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Optimization failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
