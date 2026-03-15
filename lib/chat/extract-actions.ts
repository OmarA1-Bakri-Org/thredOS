export interface ProposedAction {
  command: string
  args: Record<string, unknown>
}

/**
 * Extract proposed actions from LLM response text.
 * Handles: markdown code fences, bare JSON arrays, single JSON objects.
 * Never throws — returns [] on failure.
 */
export function extractActions(text: string): ProposedAction[] {
  const jsonStr = extractJsonString(text)
  if (!jsonStr) return []

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed.filter(isProposedAction)
    }
    if (isProposedAction(parsed)) return [parsed]
    return []
  } catch {
    return []
  }
}

function extractJsonString(text: string): string | null {
  // Try markdown code fence first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1]?.trim()) return fenceMatch[1].trim()

  // Try bare JSON array
  const arrayMatch = text.match(/\[[\s\S]*?\{[\s\S]*?\}[\s\S]*?\]/)
  if (arrayMatch?.[0]) return arrayMatch[0]

  // Try bare JSON object (greedy closing brace to capture nested objects)
  const objectMatch = text.match(/\{[^{}]*"command"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/)
  if (objectMatch?.[0]) {
    // Verify it's valid JSON before returning
    try {
      JSON.parse(objectMatch[0])
      return objectMatch[0]
    } catch {
      // Fall through
    }
  }

  // Fallback: try to find any JSON object with "command" key using balanced brace matching
  const cmdIdx = text.indexOf('"command"')
  if (cmdIdx === -1) return null
  const startIdx = text.lastIndexOf('{', cmdIdx)
  if (startIdx === -1) return null
  // Walk forward to find matching closing brace
  let depth = 0
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1)
        try {
          JSON.parse(candidate)
          return candidate
        } catch {
          return null
        }
      }
    }
  }


  return null
}

function isProposedAction(obj: unknown): obj is ProposedAction {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'command' in obj &&
    typeof (obj as ProposedAction).command === 'string'
  )
}
