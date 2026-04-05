import { readSequence, writeSequence } from '../sequence/parser'
import { readMprocsMap, removeStepProcess, type MprocsMap } from '../mprocs/state'
import * as audit from '../audit/logger'
import type { Sequence } from '../sequence/schema'

interface MprocsSelectCommand {
  c: 'select-proc'
  index: number
}

interface MprocsCommandResult {
  success: boolean
  exitCode: number
  stderr?: string
}

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

interface ReconciliationDeps {
  readSequence: typeof readSequence
  writeSequence: typeof writeSequence
  readMprocsMap: typeof readMprocsMap
  removeStepProcess: typeof removeStepProcess
  logAudit: typeof audit.log
  createClient: () => {
    isServerRunning(): Promise<boolean>
    sendCommand(command: MprocsSelectCommand): Promise<MprocsCommandResult>
  }
}

const DEFAULT_DEPS: ReconciliationDeps = {
  readSequence,
  writeSequence,
  readMprocsMap,
  removeStepProcess,
  logAudit: audit.log,
  createClient: () => {
    let clientPromise:
      | Promise<{
        isServerRunning(): Promise<boolean>
        sendCommand(command: MprocsSelectCommand): Promise<MprocsCommandResult>
      }>
      | null = null

    async function getClient() {
      clientPromise ??= import('../mprocs/client').then(({ MprocsClient }) => new MprocsClient())
      return clientPromise
    }

    return {
      isServerRunning: async () => (await getClient()).isServerRunning(),
      sendCommand: async (command: MprocsSelectCommand) => (await getClient()).sendCommand(command),
    }
  },
}

function createOrphanChange(stepId: string, reason: string): ReconciliationChange {
  return {
    stepId,
    from: 'RUNNING',
    to: 'FAILED',
    reason,
  }
}

async function logOrphanFix(
  basePath: string,
  change: ReconciliationChange,
  deps: Pick<ReconciliationDeps, 'logAudit'>,
) {
  try {
    await deps.logAudit(basePath, {
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

async function checkMprocsAvailability(
  deps: Pick<ReconciliationDeps, 'createClient'>,
): Promise<boolean> {
  const client = deps.createClient()
  try {
    return await client.isServerRunning()
  } catch {
    return false
  }
}

async function checkTrackedProcess(
  processIndex: number,
  deps: Pick<ReconciliationDeps, 'createClient'>,
): Promise<boolean> {
  try {
    const result = await deps.createClient().sendCommand({ c: 'select-proc', index: processIndex })
    return result.success
  } catch {
    return false
  }
}

async function markOrphanedSteps(
  sequence: Sequence,
  mprocsMap: MprocsMap,
  mprocsAvailable: boolean,
  deps: Pick<ReconciliationDeps, 'createClient'>,
): Promise<ReconciliationChange[]> {
  const changes: ReconciliationChange[] = []

  for (const step of sequence.steps) {
    if (step.status !== 'RUNNING') continue

    const processIndex = mprocsMap[step.id]
    if (processIndex === undefined) {
      continue
    }

    if (!mprocsAvailable) {
      step.status = 'FAILED'
      changes.push(createOrphanChange(step.id, 'mprocs server not available, tracked process orphaned'))
      continue
    }

    const trackedProcessRunning = await checkTrackedProcess(processIndex, deps)
    if (!trackedProcessRunning) {
      step.status = 'FAILED'
      changes.push(createOrphanChange(step.id, `tracked mprocs process missing (index ${processIndex})`))
    }
  }

  return changes
}

/**
 * Reconcile sequence state with actual mprocs process state.
 * Steps marked RUNNING that don't have a corresponding running process
 * are marked as FAILED.
 */
export async function reconcileState(basePath: string): Promise<ReconciliationResult> {
  return reconcileStateWithDeps(basePath, DEFAULT_DEPS)
}

export async function reconcileStateWithDeps(
  basePath: string,
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { checked: 0, changes: [], errors: [] }

  let sequence
  try {
    sequence = await deps.readSequence(basePath)
  } catch (error) {
    result.errors.push(`Failed to read sequence: ${(error as Error).message}`)
    return result
  }

  const runningSteps = sequence.steps.filter(s => s.status === 'RUNNING')
  result.checked = runningSteps.length

  if (runningSteps.length === 0) return result

  let mprocsMap: MprocsMap
  try {
    mprocsMap = await deps.readMprocsMap(basePath)
  } catch (error) {
    result.errors.push(`Failed to read mprocs map: ${(error as Error).message}`)
    return result
  }

  const mprocsAvailable = await checkMprocsAvailability(deps)
  result.changes = await markOrphanedSteps(sequence, mprocsMap, mprocsAvailable, deps)

  if (result.changes.length > 0) {
    try {
      await deps.writeSequence(basePath, sequence)
    } catch (error) {
      result.errors.push(`Failed to write sequence: ${(error as Error).message}`)
      return result
    }

    for (const change of result.changes) {
      if (mprocsMap[change.stepId] !== undefined) {
        try {
          await deps.removeStepProcess(basePath, change.stepId)
        } catch (error) {
          result.errors.push(`Failed to remove mprocs map entry for ${change.stepId}: ${(error as Error).message}`)
        }
      }
    }

    for (const change of result.changes) {
      await logOrphanFix(basePath, change, deps)
    }
  }

  return result
}
