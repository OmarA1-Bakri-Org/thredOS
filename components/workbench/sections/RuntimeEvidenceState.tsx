'use client'

import type { PropsWithChildren } from 'react'
import { RuntimeApiError } from '@/lib/ui/api'

function resolveRuntimeErrorCode(error: Error): string {
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : error instanceof RuntimeApiError
      ? error.code
      : 'CLIENT_ERROR'
}

export function RuntimeErrorNotice({
  error,
  testId = 'runtime-control-error',
}: {
  error: Error | null
  testId?: string
}) {
  if (!error) return null
  return (
    <div
      role="alert"
      data-testid={testId}
      className="border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-xs leading-relaxed text-rose-100"
    >
      <span className="font-mono font-semibold">{resolveRuntimeErrorCode(error)}</span>
      <span className="text-rose-200"> · {error.message}</span>
    </div>
  )
}

export function runtimeEvidenceMetricValue(
  entries: readonly unknown[] | null | undefined,
  error: Error | null,
  isLoading = false,
): string | number {
  if (error) return 'Unavailable'
  if (isLoading) return 'Loading'
  return entries?.length ?? 0
}

export interface RuntimeEvidenceStateProps {
  kind: string
  label: string
  error: Error | null
  isLoading?: boolean
  isEmpty: boolean
  emptyMessage: string
}

export function RuntimeEvidenceState({
  kind,
  label,
  error,
  isLoading = false,
  isEmpty,
  emptyMessage,
  children,
}: PropsWithChildren<RuntimeEvidenceStateProps>) {
  const testId = `run-${kind}-events`
  const title = `Recent ${label.toLowerCase()}`

  return (
    <div data-testid={testId}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      <div className="mt-2 divide-y divide-slate-800 border-y border-slate-800">
        {error ? (
          <div className="py-3 text-xs text-slate-500">{label} evidence unavailable.</div>
        ) : isLoading ? (
          <div className="py-3 text-xs text-slate-500">Loading {label.toLowerCase()} evidence…</div>
        ) : isEmpty ? (
          <div className="py-3 text-xs text-slate-500">{emptyMessage}</div>
        ) : children}
      </div>
      {error ? (
        <div className="mt-2">
          <RuntimeErrorNotice error={error} testId={`${testId}-error`} />
        </div>
      ) : null}
    </div>
  )
}
