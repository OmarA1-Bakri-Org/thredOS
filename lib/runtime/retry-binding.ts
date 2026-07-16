import { assertSafePathSegment } from '../security/safe-path'

export interface RetryBinding {
  originalAttemptId: string
  childRunId: string
}

function decodeSafeId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    assertSafePathSegment(decoded, 'retry binding id')
    return decoded
  } catch {
    return null
  }
}

export function formatRetryBinding(originalAttemptId: string, childRunId: string): string {
  assertSafePathSegment(originalAttemptId, 'original attempt id')
  assertSafePathSegment(childRunId, 'child run id')
  return `retry:${encodeURIComponent(originalAttemptId)}:run:${encodeURIComponent(childRunId)}`
}

export function parseRetryBinding(value: string | null): RetryBinding | null {
  const match = /^retry:([^:]+):run:([^:]+)$/.exec(value ?? '')
  if (!match) return null
  const originalAttemptId = decodeSafeId(match[1]!)
  const childRunId = decodeSafeId(match[2]!)
  return originalAttemptId !== null && childRunId !== null
    ? { originalAttemptId, childRunId }
    : null
}

export function parseUnboundRetry(value: string | null): string | null {
  const match = /^retry:([^:]+)$/.exec(value ?? '')
  return match ? decodeSafeId(match[1]!) : null
}
