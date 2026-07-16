export interface RetryBinding {
  originalAttemptId: string
  childRunId: string
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function formatRetryBinding(originalAttemptId: string, childRunId: string): string {
  return `retry:${encodeURIComponent(originalAttemptId)}:run:${encodeURIComponent(childRunId)}`
}

export function parseRetryBinding(value: string | null): RetryBinding | null {
  const match = /^retry:([^:]+):run:([^:]+)$/.exec(value ?? '')
  if (!match) return null
  const originalAttemptId = decode(match[1]!)
  const childRunId = decode(match[2]!)
  return originalAttemptId !== null && childRunId !== null
    ? { originalAttemptId, childRunId }
    : null
}

export function parseUnboundRetry(value: string | null): string | null {
  const match = /^retry:([^:]+)$/.exec(value ?? '')
  return match ? decode(match[1]!) : null
}
