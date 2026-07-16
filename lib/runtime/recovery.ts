import type { ProcessRecord, StepAttempt, WorkflowRun } from './schema'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { transitionAttempt, transitionProcess, transitionRun } from './lifecycle'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
import { scanRecoveryPhysicalState } from './recovery-scanner'
import { parseRetryBinding } from './retry-binding'
import type {
  RuntimeReconciliationContext,
  RuntimeReconciliationReport,
  RuntimeRepositories,
} from './service-types'

const ACTIVE_PROCESS_STATUSES = new Set<ProcessRecord['status']>([
  'starting',
  'running',
  'terminating',
])
const ACTIVE_ATTEMPT_STATUSES = new Set<StepAttempt['status']>([
  'pending',
  'provisioning',
  'running',
])
const ACTIVE_RUN_STATUSES = new Set<WorkflowRun['status']>([
  'pending',
  'provisioning',
  'running',
])
const TERMINAL_RUN_STATUSES = new Set<WorkflowRun['status']>([
  'awaiting_review',
  'successful',
  'partially_successful',
  'failed',
  'cancelled',
  'interrupted',
])
const TERMINAL_ATTEMPT_STATUSES = new Set<StepAttempt['status']>([
  'completed',
  'needs_review',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
])

export interface OrphanTerminationPolicy {
  enabled: boolean
  /**
   * Direct process termination adapter. Implementations must pass the PID as a
   * direct argument and must not construct a shell command.
   */
  terminate(pid: number): Promise<void>
}

export interface CanonicalRecoveryOptions extends RuntimeReconciliationContext {
  now?: () => string
  probePid?: (pid: number) => Promise<boolean>
  orphanTermination?: OrphanTerminationPolicy
  repositories?: RuntimeRepositories
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function defaultProbePid(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

function repositoriesFor(basePath: string): RuntimeRepositories {
  return {
    runs: new RunRepository(basePath),
    attempts: new AttemptRepository(basePath),
    processes: new ProcessRepository(basePath),
    commands: new CommandRepository(basePath),
  }
}

function recordChange(
  report: RuntimeReconciliationReport,
  entityType: RuntimeReconciliationReport['changes'][number]['entityType'],
  entityId: string,
  from: string,
  to: string,
  reason: string,
): void {
  report.changes.push({ entityType, entityId, from, to, reason })
}

async function repairAcceptedReceipts(
  repositories: RuntimeRepositories,
  receipts: import('./schema').RuntimeCommandReceipt[],
  runs: Map<string, WorkflowRun>,
  attempts: Map<string, StepAttempt>,
  inconsistentRunIds: ReadonlySet<string>,
  missingReservedAttemptsByRun: ReadonlyMap<string, string>,
  now: string,
  report: RuntimeReconciliationReport,
): Promise<void> {
  for (const receipt of receipts) {
    if (receipt.status !== 'accepted') continue
    try {
      if (receipt.command_type === 'retry-attempt') {
        const binding = parseRetryBinding(receipt.result_ref)
        if (!binding) {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: 'PROCESS_LOST',
            errorMessage: 'Accepted retry receipt has no valid child-run binding',
          }, now)
          continue
        }
        const childRun = runs.get(binding.childRunId)
          ?? await repositories.runs.get(binding.childRunId)
        const durableAttempt = childRun?.attempt_ids
          .map(attemptId => attempts.get(attemptId))
          .find((attempt): attempt is StepAttempt =>
            attempt !== undefined
            && attempt.workflow_run_id === binding.childRunId
            && attempt.retry_of_attempt_id === binding.originalAttemptId)
        if (durableAttempt) {
          await repositories.commands.complete(receipt.id, {
            status: 'completed',
            resultRef: durableAttempt.id,
          }, now)
          continue
        }

        const missingAttemptId = missingReservedAttemptsByRun.get(binding.childRunId)
          ?? childRun?.attempt_ids.find(attemptId => !attempts.has(attemptId))
        if (missingAttemptId) {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: 'PROCESS_LOST',
            errorMessage: `Retry child run lost reserved attempt ${missingAttemptId}`,
          }, now)
          continue
        }
        const childStart = receipts.find(candidate =>
          candidate.idempotency_key === `retry-start:${receipt.id}`
          && candidate.command_type === 'start-run')
        if (childStart?.status === 'failed') {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: childStart.error_code ?? 'PROCESS_LOST',
            errorMessage: childStart.error_message ?? 'Retry child start failed without durable attempt lineage',
          }, now)
          continue
        }
        await repositories.commands.complete(receipt.id, {
          status: 'failed',
          errorCode: childRun?.error_code ?? 'PROCESS_LOST',
          errorMessage: childRun?.error_message ?? 'Retry child run has no durable attempt lineage',
        }, now)
        continue
      }

      if (!receipt.result_ref) continue
      if (receipt.command_type === 'start-run' || receipt.command_type === 'cancel-run') {
        const run = runs.get(receipt.result_ref) ?? await repositories.runs.get(receipt.result_ref)
        if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) continue
        if (inconsistentRunIds.has(run.id)) {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: 'PROCESS_LOST',
            errorMessage: `Run ${run.id} contained active attempt state after terminalization`,
          }, now)
        } else if (
          (receipt.command_type === 'start-run' && run.status === 'successful')
          || (receipt.command_type === 'cancel-run' && run.status === 'cancelled')
        ) {
          await repositories.commands.complete(receipt.id, {
            status: 'completed',
            resultRef: run.id,
          }, now)
        } else {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: run.error_code ?? 'RUNTIME_EXECUTION_FAILED',
            errorMessage: run.error_message ?? `Run ended with status ${run.status}`,
          }, now)
        }
        continue
      }

      if (receipt.command_type === 'cancel-attempt') {
        const attempt = attempts.get(receipt.result_ref)
          ?? await repositories.attempts.get(receipt.result_ref)
        if (!attempt || !TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) continue
        if (attempt.status === 'cancelled') {
          await repositories.commands.complete(receipt.id, {
            status: 'completed',
            resultRef: attempt.id,
          }, now)
        } else {
          await repositories.commands.complete(receipt.id, {
            status: 'failed',
            errorCode: attempt.error_code ?? 'RUNTIME_EXECUTION_FAILED',
            errorMessage: attempt.error_message ?? `Attempt ended with status ${attempt.status}`,
          }, now)
        }
        continue
      }

    } catch (error) {
      report.errors.push(`Failed to repair command receipt ${receipt.id}: ${message(error)}`)
    }
  }
}

/**
 * Reconcile canonical V2 runtime truth after service ownership has been lost.
 *
 * A PID probe is evidence only. Even an apparently live PID cannot restore the
 * output streams and control handle owned by the previous service instance.
 */
export async function reconcileCanonicalRuntime(
  basePath: string,
  options: CanonicalRecoveryOptions = {},
): Promise<RuntimeReconciliationReport> {
  const repositories = options.repositories ?? repositoriesFor(basePath)
  const now = (options.now ?? (() => new Date().toISOString()))()
  const probePid = options.probePid ?? defaultProbePid
  const report: RuntimeReconciliationReport = { checked: 0, changes: [], errors: [] }
  const physical = await scanRecoveryPhysicalState(basePath)
  report.errors.push(...physical.errors)
  const attempts = new Map(physical.attempts)
  const runs = new Map(physical.runs)
  const processes = [...physical.processes.values()]
  const managedAttemptIds = new Set<string>()
  const inconsistentRunIds = new Set<string>()
  const missingReservedAttemptsByRun = new Map<string, string>()

  report.checked += processes.length

  for (const processRecord of processes) {
    if (!ACTIVE_PROCESS_STATUSES.has(processRecord.status)) continue
    if (options.isProcessManaged?.(
      processRecord.id,
      processRecord.workflow_run_id,
      processRecord.attempt_id,
    )) {
      managedAttemptIds.add(processRecord.attempt_id)
      continue
    }

    let alive = false
    if (processRecord.pid !== null) {
      try {
        alive = await probePid(processRecord.pid)
      } catch (error) {
        report.errors.push(`Failed to probe process ${processRecord.id} (pid ${processRecord.pid}): ${message(error)}`)
      }
    }

    try {
      await transitionProcess(repositories.processes, processRecord, 'lost', {
        ended_at: processRecord.ended_at ?? now,
      })
      recordChange(
        report,
        'process',
        processRecord.id,
        processRecord.status,
        'lost',
        alive
          ? 'service restarted and cannot reattach to the apparently live process'
          : 'service restarted without a reattachable process handle',
      )
    } catch (error) {
      report.errors.push(`Failed to mark process ${processRecord.id} lost: ${message(error)}`)
    }

    if (
      alive
      && processRecord.pid !== null
      && processRecord.provider === 'local-process'
      && options.orphanTermination?.enabled
    ) {
      try {
        await options.orphanTermination.terminate(processRecord.pid)
      } catch (error) {
        report.errors.push(
          `Failed to terminate orphan process ${processRecord.id} (pid ${processRecord.pid}): ${message(error)}`,
        )
      }
    }

    try {
      const owner = await repositories.attempts.get(processRecord.attempt_id)
      if (!owner) {
        report.errors.push(`Process ${processRecord.id} references missing attempt ${processRecord.attempt_id}`)
      } else if (owner.workflow_run_id !== processRecord.workflow_run_id) {
        report.errors.push(
          `Process ${processRecord.id} ownership does not match attempt ${owner.id}`,
        )
      } else {
        attempts.set(owner.id, owner)
      }
    } catch (error) {
      report.errors.push(`Failed to inspect owner of process ${processRecord.id}: ${message(error)}`)
    }
  }

  report.checked += runs.size
  report.checked += attempts.size

  for (const run of runs.values()) {
    if (!TERMINAL_RUN_STATUSES.has(run.status)) continue
    for (const attemptId of run.attempt_ids) {
      const attempt = attempts.get(attemptId)
      if (attempt?.workflow_run_id === run.id) continue
      inconsistentRunIds.add(run.id)
      report.errors.push(
        `Run ${run.id} is terminal as ${run.status} but references missing attempt ${attemptId}`,
      )
    }
  }

  for (const owner of [...attempts.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      !ACTIVE_ATTEMPT_STATUSES.has(owner.status)
      || managedAttemptIds.has(owner.id)
      || options.isAttemptManaged?.(owner.id, owner.workflow_run_id)
    ) continue
    const owningRun = runs.get(owner.workflow_run_id)
    if (owningRun && TERMINAL_RUN_STATUSES.has(owningRun.status)) {
      inconsistentRunIds.add(owningRun.id)
      report.errors.push(
        `Run ${owningRun.id} is terminal as ${owningRun.status} but owned active attempt ${owner.id} required recovery`,
      )
    }
    if (owner.process_id) {
      try {
        const processRecord = await repositories.processes.get(owner.process_id)
        if (!processRecord) {
          report.errors.push(`Attempt ${owner.id} references missing process ${owner.process_id}`)
        }
      } catch (error) {
        report.errors.push(`Failed to inspect process for attempt ${owner.id}: ${message(error)}`)
      }
    }
    try {
      const interrupted = await transitionAttempt(repositories.attempts, owner, 'interrupted', {
        ended_at: owner.ended_at ?? now,
        error_code: 'PROCESS_LOST',
        error_message: 'Runtime service restarted before the attempt reached terminal process evidence',
      })
      attempts.set(interrupted.id, interrupted)
      recordChange(
        report,
        'attempt',
        owner.id,
        owner.status,
        'interrupted',
        'runtime service restarted before terminal process evidence was persisted',
      )
    } catch (error) {
      report.errors.push(`Failed to interrupt attempt ${owner.id}: ${message(error)}`)
    }
  }

  for (const run of [...runs.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue
    if (options.isRunManaged?.(run.id)) continue
    const runAttempts = [...attempts.values()].filter(attempt => attempt.workflow_run_id === run.id)
    if (runAttempts.some(attempt => managedAttemptIds.has(attempt.id))) continue

    let missingReservedAttempt: string | null = null
    for (const attemptId of run.attempt_ids) {
      try {
        const referenced = attempts.get(attemptId) ?? await repositories.attempts.get(attemptId)
        if (!referenced) {
          missingReservedAttempt ??= attemptId
          missingReservedAttemptsByRun.set(run.id, attemptId)
          report.errors.push(
            `Run ${run.id} references reserved attempt ${attemptId} whose record is missing`,
          )
        } else if (referenced.workflow_run_id !== run.id) {
          report.errors.push(`Run ${run.id} references attempt ${attemptId} owned by ${referenced.workflow_run_id}`)
        }
      } catch (error) {
        report.errors.push(`Failed to inspect attempt ${attemptId} referenced by run ${run.id}: ${message(error)}`)
      }
    }

    const errorMessage = missingReservedAttempt
      ? `Reserved attempt ${missingReservedAttempt} was not persisted before restart`
      : 'Runtime service restarted before the run reached terminal attempt evidence'
    try {
      const interrupted = await transitionRun(repositories.runs, run, 'interrupted', {
        ended_at: run.ended_at ?? now,
        error_code: 'PROCESS_LOST',
        error_message: errorMessage,
      })
      runs.set(interrupted.id, interrupted)
      recordChange(
        report,
        'run',
        run.id,
        run.status,
        'interrupted',
        missingReservedAttempt
          ? 'reserved attempt record was missing after restart'
          : 'runtime service restarted before terminal attempt evidence was persisted',
      )
    } catch (error) {
      report.errors.push(`Failed to interrupt run ${run.id}: ${message(error)}`)
    }
  }

  await repairAcceptedReceipts(
    repositories,
    physical.receipts,
    runs,
    attempts,
    inconsistentRunIds,
    missingReservedAttemptsByRun,
    now,
    report,
  )
  return report
}
