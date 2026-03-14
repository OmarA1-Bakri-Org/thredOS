import { readSequence, writeSequence } from '../sequence/parser'
import { MprocsClient } from '../mprocs/client'
import * as audit from '../audit/logger'
import type { Step } from '../sequence/schema'

export interface ReconciliationChange {
  stepId: string
  from: string
  to: string
  reason: string
}

export interface ReconciliationResult {
  checked: number
  changes: ReconciliationChange[]
  errors: string[]
}

function createOrphanChange(stepId: string): ReconciliationChange {
  return {
    stepId,
    from: 'RUNNING',
    to: 'FAILED',
    reason: 'mprocs server not available, process orphaned',
  }
}

async function logOrphanFix(basePath: string, change: ReconciliationChange) {
  try {
    await audit.log(basePath, {
      timestamp: new Date().toISOString(),
      actor: 'reconciler',
      action: 'reconcile',
      target: change.stepId,
      payload: { ...change },
      result: 'orphan-fixed',
    })
  } catch {
    // Audit logging failure shouldn't block reconciliation
  }
}

async function checkMprocsAvailability(): Promise<boolean> {
  const client = new MprocsClient()
  try {
    return await client.isServerRunning()
  } catch {
    return false
  }
}

function markOrphanedSteps(
  runningSteps: Step[],
  mprocsAvailable: boolean,
): ReconciliationChange[] {
  if (mprocsAvailable) return []

  return runningSteps.map(step => {
    step.status = 'FAILED'
    return createOrphanChange(step.id)
  })
}

/**
 * Reconcile sequence state with actual mprocs process state.
 * Steps marked RUNNING that don't have a corresponding running process
 * are marked as FAILED.
 */
export async function reconcileState(basePath: string): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { checked: 0, changes: [], errors: [] }

  let sequence
  try {
    sequence = await readSequence(basePath)
  } catch (error) {
    result.errors.push(`Failed to read sequence: ${(error as Error).message}`)
    return result
  }

  const runningSteps = sequence.steps.filter(s => s.status === 'RUNNING')
  result.checked = runningSteps.length

  if (runningSteps.length === 0) return result

  const mprocsAvailable = await checkMprocsAvailability()
  result.changes = markOrphanedSteps(runningSteps, mprocsAvailable)

  for (const change of result.changes) {
    await logOrphanFix(basePath, change)
  }

  if (result.changes.length > 0) {
    try {
      await writeSequence(basePath, sequence)
    } catch (error) {
      result.errors.push(`Failed to write sequence: ${(error as Error).message}`)
    }
  }

  return result
}
