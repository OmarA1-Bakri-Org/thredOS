import type { ProcessRecord, StepAttempt, WorkflowRun } from './schema'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { transitionAttempt, transitionProcess, transitionRun } from './lifecycle'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
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
  now: string,
  report: RuntimeReconciliationReport,
): Promise<void> {
  let receipts
  try {
    receipts = await repositories.commands.list()
  } catch (error) {
    report.errors.push(`Failed to list runtime command receipts: ${message(error)}`)
    return
  }

  for (const receipt of receipts) {
    if (receipt.status !== 'accepted' || !receipt.result_ref) continue
    try {
      if (receipt.command_type === 'start-run' || receipt.command_type === 'cancel-run') {
        const run = await repositories.runs.get(receipt.result_ref)
        if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) continue
        if (
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
        const attempt = await repositories.attempts.get(receipt.result_ref)
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
  const attempts = new Map<string, StepAttempt>()
  const managedAttemptIds = new Set<string>()

  let processes: ProcessRecord[] = []
  try {
    processes = await repositories.processes.list()
  } catch (error) {
    report.errors.push(`Failed to list canonical processes: ${message(error)}`)
  }
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

  let runs: WorkflowRun[] = []
  try {
    runs = await repositories.runs.list()
  } catch (error) {
    report.errors.push(`Failed to list canonical runs: ${message(error)}`)
  }
  report.checked += runs.length

  for (const run of runs) {
    try {
      for (const attempt of await repositories.attempts.listForRun(run.id)) {
        attempts.set(attempt.id, attempt)
      }
    } catch (error) {
      report.errors.push(`Failed to list attempts for run ${run.id}: ${message(error)}`)
    }
  }
  report.checked += attempts.size

  for (const owner of [...attempts.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      !ACTIVE_ATTEMPT_STATUSES.has(owner.status)
      || managedAttemptIds.has(owner.id)
      || options.isAttemptManaged?.(owner.id, owner.workflow_run_id)
    ) continue
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
      await transitionAttempt(repositories.attempts, owner, 'interrupted', {
        ended_at: owner.ended_at ?? now,
        error_code: 'PROCESS_LOST',
        error_message: 'Runtime service restarted before the attempt reached terminal process evidence',
      })
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

  for (const run of runs.sort((left, right) => left.id.localeCompare(right.id))) {
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
      await transitionRun(repositories.runs, run, 'interrupted', {
        ended_at: run.ended_at ?? now,
        error_code: 'PROCESS_LOST',
        error_message: errorMessage,
      })
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

  await repairAcceptedReceipts(repositories, now, report)
  return report
}
