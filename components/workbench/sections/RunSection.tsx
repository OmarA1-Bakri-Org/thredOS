'use client'

import { useState } from 'react'
import {
  Download,
  Eye,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useUIStore } from '@/lib/ui/store'
import {
  RuntimeApiError,
  useApprovals,
  useAttempt,
  useCancelAttempt,
  useCancelRun,
  useExportBundle,
  useRevealSurface,
  useRetryAttempt,
  useRun,
  useRunAttempts,
  useRuns,
  useStartRun,
  useStatus,
  useThreadMerges,
  useThreadRuns,
  useThreadSurfaces,
  useTraces,
} from '@/lib/ui/api'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { AttemptProjection, RunProjection, SequenceStatusProjection } from '@/lib/runtime/service-types'
import type { StepAttemptStatus, WorkflowRunStatus } from '@/lib/runtime/schema'

const CANCELLABLE_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'pending',
  'provisioning',
  'running',
  'applying',
])
const RETRYABLE_ATTEMPT_STATUSES = new Set<StepAttemptStatus>([
  'completed',
  'needs_review',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
])
const ACTIVE_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'pending',
  'provisioning',
  'running',
  'awaiting_review',
  'applying',
])

export function isActiveRunStatus(status: WorkflowRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status)
}

export function canCancelRun(projection: RunProjection | null): boolean {
  return projection?.source === 'v2' && CANCELLABLE_RUN_STATUSES.has(projection.run.status)
}

export function canCancelAttempt(projection: AttemptProjection | null): boolean {
  if (projection?.source !== 'v2' || projection.attempt.status !== 'running') return false
  return projection.process != null
    && projection.process.status !== 'terminating'
    && projection.process.status !== 'exited'
    && projection.process.status !== 'lost'
}

export function canRetryAttempt(projection: AttemptProjection | null): boolean {
  return projection?.source === 'v2'
    && RETRYABLE_ATTEMPT_STATUSES.has(projection.attempt.status)
}

export function selectionForStartedRun(projection: RunProjection): {
  runId: string
  attemptId: string | null
} {
  return {
    runId: projection.run.id,
    attemptId: projection.attempts.at(-1)?.id ?? null,
  }
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatDuration(value: number | null): string {
  if (value == null) return '—'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
}

function statusTone(status: string): string {
  if (['successful', 'completed', 'exited'].includes(status)) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
  }
  if (['failed', 'lost', 'interrupted', 'timed_out', 'cancelled'].includes(status)) {
    return 'border-rose-500/35 bg-rose-500/10 text-rose-100'
  }
  if (['needs_review', 'awaiting_review', 'terminating'].includes(status)) {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-100'
  }
  return 'border-sky-500/35 bg-sky-500/10 text-sky-100'
}

function RuntimeStateBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] ${statusTone(status)}`}>
      {label ? `${label} · ` : ''}{status.replaceAll('_', ' ')}
    </span>
  )
}

function Metric({
  label,
  value,
  tone = 'text-white',
  testId,
}: {
  label: string
  value: string | number
  tone?: string
  testId?: string
}) {
  return (
    <div className="border-l border-slate-800 pl-3 first:border-l-0 first:pl-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd data-testid={testId} className={`mt-1 text-base font-semibold ${tone}`}>{value}</dd>
    </div>
  )
}

function RuntimeErrorNotice({ error }: { error: Error | null }) {
  if (!error) return null
  const code = 'code' in error && typeof error.code === 'string'
    ? error.code
    : error instanceof RuntimeApiError
      ? error.code
      : 'CLIENT_ERROR'
  return (
    <div
      role="alert"
      data-testid="runtime-control-error"
      className="border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-xs leading-relaxed text-rose-100"
    >
      <span className="font-mono font-semibold">{code}</span>
      <span className="text-rose-200"> · {error.message}</span>
    </div>
  )
}

export interface RuntimeRunConsoleProps {
  sequenceStatus?: SequenceStatusProjection
  runs: RunProjection[]
  activeRun: RunProjection | null
  attempts: AttemptProjection[]
  activeAttempt: AttemptProjection | null
  isLoading: boolean
  isRefreshing: boolean
  queryError: Error | null
  controlError: Error | null
  runAllPending: boolean
  cancelRunPending: boolean
  cancelAttemptPending: boolean
  retryAttemptPending: boolean
  onRunAll(): void
  onCancelRun(runId: string): void
  onCancelAttempt(attemptId: string): void
  onRetryAttempt(attemptId: string): void
  onSelectRun(runId: string): void
  onSelectAttempt(attemptId: string): void
}

export function RuntimeRunConsole({
  sequenceStatus,
  runs,
  activeRun,
  attempts,
  activeAttempt,
  isLoading,
  isRefreshing,
  queryError,
  controlError,
  runAllPending,
  cancelRunPending,
  cancelAttemptPending,
  retryAttemptPending,
  onRunAll,
  onCancelRun,
  onCancelAttempt,
  onRetryAttempt,
  onSelectRun,
  onSelectAttempt,
}: RuntimeRunConsoleProps) {
  const activeCount = runs.filter(item => isActiveRunStatus(item.run.status)).length
  const successfulCount = runs.filter(item => item.run.status === 'successful').length
  const failedCount = runs.filter(item =>
    ['failed', 'cancelled', 'interrupted'].includes(item.run.status),
  ).length

  return (
    <section
      data-testid="runtime-run-console"
      aria-busy={isLoading || isRefreshing}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Runtime control
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {isRefreshing ? 'Refreshing canonical state…' : 'Shared API and CLI runtime'}
          </div>
        </div>
        {activeRun ? (
          <span className="border border-slate-700 bg-slate-950/70 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-300">
            {activeRun.source === 'legacy' ? 'legacy · read only' : 'v2 canonical'}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-y border-slate-800 py-3">
        <Button
          type="button"
          size="sm"
          onClick={onRunAll}
          disabled={runAllPending}
          data-testid="run-all-button"
        >
          <Play aria-hidden="true" />
          {runAllPending ? 'Starting…' : 'Run all'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => activeRun && onCancelRun(activeRun.run.id)}
          disabled={!canCancelRun(activeRun) || cancelRunPending}
          data-testid="cancel-run-button"
        >
          <Square aria-hidden="true" />
          {cancelRunPending ? 'Cancelling run…' : 'Cancel run'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => activeAttempt && onCancelAttempt(activeAttempt.attempt.id)}
          disabled={!canCancelAttempt(activeAttempt) || cancelAttemptPending}
          data-testid="cancel-attempt-button"
        >
          <Square aria-hidden="true" />
          {cancelAttemptPending ? 'Cancelling attempt…' : 'Cancel attempt'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => activeAttempt && onRetryAttempt(activeAttempt.attempt.id)}
          disabled={!canRetryAttempt(activeAttempt) || retryAttemptPending}
          data-testid="retry-attempt-button"
        >
          <RotateCcw aria-hidden="true" />
          {retryAttemptPending ? 'Creating retry…' : 'Retry attempt'}
        </Button>
      </div>

      <RuntimeErrorNotice error={controlError ?? queryError} />

      <dl className="grid grid-cols-2 gap-y-3 border-b border-slate-800 pb-3 sm:grid-cols-4">
        <Metric label="Ready steps" value={sequenceStatus?.summary.ready ?? 0} tone="text-slate-100" />
        <Metric label="Active runs" value={activeCount} tone="text-sky-200" />
        <Metric label="Successful" value={successfulCount} tone="text-emerald-200" />
        <Metric label="Stopped / failed" value={failedCount} tone="text-rose-200" />
      </dl>

      {isLoading ? (
        <div data-testid="runtime-loading" className="space-y-2" aria-live="polite">
          <div className="h-16 animate-pulse bg-slate-900 motion-reduce:animate-none" />
          <div className="h-12 animate-pulse bg-slate-900 motion-reduce:animate-none" />
          <span className="sr-only">Loading runtime records</span>
        </div>
      ) : runs.length === 0 ? (
        <div
          data-testid="runtime-empty"
          className="border border-dashed border-slate-700 px-4 py-5 text-sm leading-relaxed text-slate-400"
        >
          No workflow runs have been recorded. Start the runnable frontier to create the first
          canonical run and attempt records.
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Workflow runs
            </div>
            <div className="divide-y divide-slate-800 border-y border-slate-800">
              {[...runs]
                .sort((left, right) => right.run.created_at.localeCompare(left.run.created_at))
                .slice(0, 8)
                .map(item => {
                  const selected = item.run.id === activeRun?.run.id
                  return (
                    <button
                      type="button"
                      key={item.run.id}
                      onClick={() => onSelectRun(item.run.id)}
                      aria-pressed={selected}
                      className={`grid w-full grid-cols-[1fr_auto] gap-3 px-2 py-2.5 text-left transition-colors ${
                        selected ? 'bg-sky-500/8' : 'hover:bg-slate-900/70'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-200">
                          {item.run.id}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">
                          {item.run.target.kind} · {item.run.strategy} · {item.attempts.length} attempt{item.attempts.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        {item.source === 'legacy' ? (
                          <span className="border border-amber-500/30 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-amber-200">
                            legacy
                          </span>
                        ) : null}
                        <RuntimeStateBadge status={item.run.status} />
                      </span>
                    </button>
                  )
                })}
            </div>
          </div>

          {activeRun ? (
            <div data-testid="run-identity" className="border-l-2 border-sky-500/55 pl-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                    Workflow run
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-white">
                    {activeRun.run.id}
                  </div>
                </div>
                <RuntimeStateBadge status={activeRun.run.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Strategy</dt>
                  <dd className="mt-0.5 text-slate-200">{activeRun.run.strategy}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Created</dt>
                  <dd className="mt-0.5 text-slate-200">
                    <time dateTime={activeRun.run.created_at}>
                      {formatTimestamp(activeRun.run.created_at)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Attempts</dt>
                  <dd className="mt-0.5 text-slate-200">{attempts.length}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {activeRun ? (
            <div className="space-y-1">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                Attempt ledger
              </div>
              <div
                data-testid="attempt-ledger"
                aria-busy={isRefreshing}
                className="divide-y divide-slate-800 border-y border-slate-800"
              >
                {attempts.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-slate-500">
                    No attempt has been persisted for this run.
                  </div>
                ) : attempts.map(item => {
                  const selected = item.attempt.id === activeAttempt?.attempt.id
                  return (
                    <button
                      type="button"
                      key={item.attempt.id}
                      onClick={() => onSelectAttempt(item.attempt.id)}
                      aria-pressed={selected}
                      className={`grid w-full grid-cols-[1fr_auto] gap-3 px-2 py-2.5 text-left transition-colors ${
                        selected ? 'bg-sky-500/8' : 'hover:bg-slate-900/70'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[10px] text-slate-200">
                          #{item.attempt.attempt_number} · {item.attempt.id}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">
                          {item.attempt.step_id}
                          {item.attempt.retry_of_attempt_id
                            ? ` · retry of ${item.attempt.retry_of_attempt_id}`
                            : ''}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <RuntimeStateBadge status={item.attempt.status} label="attempt" />
                        <RuntimeStateBadge
                          status={item.process?.status ?? 'not_registered'}
                          label="process"
                        />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {activeAttempt ? (
            <div
              data-testid="attempt-detail"
              className="border border-slate-800 bg-[#070d16] px-3 py-3"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                    Selected attempt
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-white">
                    {activeAttempt.attempt.id}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <RuntimeStateBadge status={activeAttempt.attempt.status} label="attempt" />
                  <RuntimeStateBadge
                    status={activeAttempt.process?.status ?? 'not_registered'}
                    label="process"
                  />
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Workflow run</dt>
                  <dd className="mt-0.5 break-all text-slate-200">
                    {activeAttempt.attempt.workflow_run_id}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Process ID</dt>
                  <dd className="mt-0.5 break-all text-slate-200">
                    {activeAttempt.process?.id ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">PID</dt>
                  <dd className="mt-0.5 text-slate-200">{activeAttempt.process?.pid ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Exit code</dt>
                  <dd className="mt-0.5 text-slate-200">{activeAttempt.attempt.exit_code ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="mt-0.5 text-slate-200">
                    {formatDuration(activeAttempt.attempt.duration_ms)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Heartbeat</dt>
                  <dd className="mt-0.5 text-slate-200">
                    {formatTimestamp(activeAttempt.attempt.last_heartbeat_at)}
                  </dd>
                </div>
              </dl>
              {activeAttempt.attempt.error_code || activeAttempt.attempt.error_message ? (
                <div className="mt-3 border-t border-slate-800 pt-2 text-xs text-rose-200">
                  {activeAttempt.attempt.error_code ?? 'RUNTIME_ERROR'}
                  {activeAttempt.attempt.error_message
                    ? ` · ${activeAttempt.attempt.error_message}`
                    : ''}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function latestRun(projections: RunProjection[] | undefined): RunProjection | null {
  return projections && projections.length > 0
    ? [...projections].sort((left, right) =>
        right.run.created_at.localeCompare(left.run.created_at),
      )[0]
    : null
}

function latestAttempt(projections: AttemptProjection[] | undefined): AttemptProjection | null {
  return projections && projections.length > 0
    ? [...projections].sort((left, right) => {
        const byAttempt = right.attempt.attempt_number - left.attempt.attempt_number
        return byAttempt || right.attempt.id.localeCompare(left.attempt.id)
      })[0]
    : null
}

export function RunSection() {
  const [confirmRun, setConfirmRun] = useState(false)
  const [localRunId, setLocalRunId] = useState<string | null>(null)
  const [localAttemptId, setLocalAttemptId] = useState<string | null>(null)
  const startRun = useStartRun()
  const cancelRun = useCancelRun()
  const cancelAttempt = useCancelAttempt()
  const retryAttempt = useRetryAttempt()
  const exportBundle = useExportBundle()
  const revealSurface = useRevealSurface()
  const { data: status } = useStatus()
  const selectedThreadSurfaceId = useUIStore(state => state.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(state => state.selectedRunId)
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: surfaceRuns } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()
  const runtimeRuns = useRuns()

  const laneBoard = threadSurfaces && surfaceRuns && mergeEvents
    ? createLaneBoardModel({
        threadSurfaces,
        runs: surfaceRuns,
        mergeEvents,
        runIds: surfaceRuns.map(run => run.id),
      })
    : null
  const focusedDetail = threadSurfaces && surfaceRuns && mergeEvents && laneBoard
    ? resolveThreadSurfaceFocusedDetail({
        threadSurfaces,
        runs: surfaceRuns,
        mergeEvents,
        rows: laneBoard.rows,
        mergeGroups: laneBoard.mergeGroups,
        focusedThreadSurfaceId: selectedThreadSurfaceId,
        selectedRunId,
      })
    : null
  const selectedSurfaceRun = surfaceRuns?.find(run =>
    run.id === selectedRunId
    || run.workflowRunId === selectedRunId
    || run.attemptId === selectedRunId,
  )
  const selectedCanonicalRunId = runtimeRuns.data?.some(item => item.run.id === selectedRunId)
    ? selectedRunId
    : selectedSurfaceRun?.workflowRunId
  const activeRunId = localRunId ?? selectedCanonicalRunId ?? latestRun(runtimeRuns.data)?.run.id ?? null
  const runQuery = useRun(activeRunId)
  const activeRun = runQuery.data
    ?? runtimeRuns.data?.find(item => item.run.id === activeRunId)
    ?? null
  const attemptsQuery = useRunAttempts(activeRunId)
  const selectedCanonicalAttemptId = attemptsQuery.data?.some(
    item => item.attempt.id === selectedRunId,
  )
    ? selectedRunId
    : selectedSurfaceRun?.attemptId
  const activeAttemptId = localAttemptId
    ?? selectedCanonicalAttemptId
    ?? latestAttempt(attemptsQuery.data)?.attempt.id
    ?? null
  const attemptQuery = useAttempt(activeAttemptId)
  const activeAttempt = attemptQuery.data
    ?? attemptsQuery.data?.find(item => item.attempt.id === activeAttemptId)
    ?? null
  const controlError = cancelRun.error
    ?? cancelAttempt.error
    ?? retryAttempt.error
    ?? (startRun.error instanceof Error ? startRun.error : null)
  const queryError = runtimeRuns.error instanceof Error
    ? runtimeRuns.error
    : runQuery.error instanceof Error
      ? runQuery.error
      : attemptsQuery.error instanceof Error
        ? attemptsQuery.error
        : null

  const activeSurfaceId = focusedDetail?.threadSurfaceId ?? selectedThreadSurfaceId ?? null
  const runIsActive = activeRun != null && isActiveRunStatus(activeRun.run.status)
  const { data: traceEvents } = useTraces(activeRunId, runIsActive)
  const { data: approvals } = useApprovals(activeRunId, runIsActive)
  const exportPath = (exportBundle.data as { exportPath?: string } | undefined)?.exportPath ?? null
  const exportError = exportBundle.error instanceof Error ? exportBundle.error : null
  const recentTraceEvents = [...((traceEvents ?? []) as Array<{
    event_type?: string
    ts?: string
    actor?: string
  }>)].slice(-4).reverse()
  const recentApprovals = [...((approvals ?? []) as Array<{
    id: string
    action_type?: string
    status?: string
    approved_by?: string | null
  }>)].slice(-4).reverse()
  const showRevealButton = Boolean(
    activeRunId
    && activeSurfaceId
    && focusedDetail?.surfaceClass === 'sealed'
    && focusedDetail?.revealState === 'sealed',
  )

  return (
    <div className="space-y-5" data-testid="run-section">
      <RuntimeRunConsole
        sequenceStatus={status}
        runs={runtimeRuns.data ?? []}
        activeRun={activeRun}
        attempts={attemptsQuery.data ?? []}
        activeAttempt={activeAttempt}
        isLoading={runtimeRuns.isLoading}
        isRefreshing={runtimeRuns.isFetching || runQuery.isFetching || attemptsQuery.isFetching}
        queryError={queryError}
        controlError={controlError}
        runAllPending={startRun.isPending}
        cancelRunPending={cancelRun.isPending}
        cancelAttemptPending={cancelAttempt.isPending}
        retryAttemptPending={retryAttempt.isPending}
        onRunAll={() => setConfirmRun(true)}
        onCancelRun={runId => cancelRun.mutate(runId)}
        onCancelAttempt={attemptId => cancelAttempt.mutate(attemptId)}
        onRetryAttempt={attemptId => retryAttempt.mutate(attemptId, {
          onSuccess: projection => {
            setLocalRunId(projection.attempt.workflow_run_id)
            setLocalAttemptId(projection.attempt.id)
          },
        })}
        onSelectRun={runId => {
          setLocalRunId(runId)
          setLocalAttemptId(null)
        }}
        onSelectAttempt={setLocalAttemptId}
      />

      {activeRunId ? (
        <section data-testid="run-control-plane" className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Evidence
              </div>
              <div className="mt-1 text-xs text-slate-400">Trace, approvals, export, and reveal</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="run-export-button"
                onClick={() => exportBundle.mutate({ runId: activeRunId })}
                disabled={exportBundle.isPending}
              >
                <Download aria-hidden="true" />
                {exportBundle.isPending ? 'Exporting…' : 'Export run'}
              </Button>
              {showRevealButton ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="run-reveal-button"
                  onClick={() => revealSurface.mutate({
                    surfaceId: activeSurfaceId!,
                    runId: activeRunId,
                  })}
                  disabled={revealSurface.isPending}
                >
                  <Eye aria-hidden="true" />
                  {revealSurface.isPending ? 'Revealing…' : 'Reveal surface'}
                </Button>
              ) : null}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 border-y border-slate-800 py-3">
            <Metric label="Trace events" value={traceEvents?.length ?? 0} testId="run-trace-count" />
            <Metric label="Approvals" value={approvals?.length ?? 0} testId="run-approval-count" />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <div data-testid="run-trace-events">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                Recent trace
              </div>
              <div className="mt-2 divide-y divide-slate-800 border-y border-slate-800">
                {recentTraceEvents.length === 0 ? (
                  <div className="py-3 text-xs text-slate-500">No trace events recorded yet.</div>
                ) : recentTraceEvents.map((event, index) => (
                  <div
                    key={`${event.ts ?? 'ts'}-${event.event_type ?? 'event'}-${index}`}
                    className="py-2 text-xs text-slate-200"
                  >
                    <div className="font-mono uppercase tracking-[0.12em] text-slate-300">
                      {event.event_type ?? 'unknown'}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {event.actor ?? 'threados'} · {event.ts ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div data-testid="run-approval-events">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                Recent approvals
              </div>
              <div className="mt-2 divide-y divide-slate-800 border-y border-slate-800">
                {recentApprovals.length === 0 ? (
                  <div className="py-3 text-xs text-slate-500">No approvals recorded yet.</div>
                ) : recentApprovals.map(approval => (
                  <div key={approval.id} className="py-2 text-xs text-slate-200">
                    <div className="font-mono uppercase tracking-[0.12em] text-slate-300">
                      {approval.action_type ?? 'approval'}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {approval.status ?? 'pending'}
                      {approval.approved_by ? ` · ${approval.approved_by}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {exportPath ? (
            <div
              data-testid="run-export-path"
              className="border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100"
            >
              Bundle ready at {exportPath}
            </div>
          ) : null}
          <RuntimeErrorNotice error={exportError} />
          {revealSurface.data ? (
            <div className="border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
              Surface reveal recorded.
            </div>
          ) : null}
        </section>
      ) : null}

      {focusedDetail ? (
        <section className="space-y-3 border-t border-slate-800 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Surface context
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-500">Surface</dt>
              <dd className="mt-0.5 break-all text-slate-200">{focusedDetail.threadSurfaceId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Surface run</dt>
              <dd className="mt-0.5 break-all text-slate-200">{focusedDetail.runId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Reveal state</dt>
              <dd className="mt-0.5 text-slate-200">{focusedDetail.revealState ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Isolation</dt>
              <dd className="mt-0.5 text-slate-200">{focusedDetail.isolationLabel ?? '—'}</dd>
            </div>
          </dl>
          <div className="border-l border-slate-700 pl-3 text-sm leading-relaxed text-slate-300">
            {focusedDetail.runSummary ?? 'No surface-run summary recorded yet.'}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmRun}
        title="Run runnable frontier?"
        description="This dispatches the current runnable steps through the shared sequential runtime."
        confirmLabel="Run all"
        tone="default"
        onCancel={() => setConfirmRun(false)}
        onConfirm={() => {
          setConfirmRun(false)
          startRun.mutate({
            sequence_id: '$current',
            target: { kind: 'runnable' },
            strategy: 'sequential',
            max_concurrency: 1,
            policy_confirmed: true,
          }, {
            onSuccess: projection => {
              const selection = selectionForStartedRun(projection)
              setLocalRunId(selection.runId)
              setLocalAttemptId(selection.attemptId)
            },
          })
        }}
      />
    </div>
  )
}
