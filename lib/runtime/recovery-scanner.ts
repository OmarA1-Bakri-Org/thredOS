import { readdir } from 'fs/promises'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { lookupCommandsRoot, lookupRunsRoot } from './paths'
import {
  ProcessRecordSchema,
  RuntimeCommandReceiptSchema,
  StepAttemptSchema,
  WorkflowRunSchema,
  type ProcessRecord,
  type RuntimeCommandReceipt,
  type StepAttempt,
  type WorkflowRun,
} from './schema'

export interface RecoveryPhysicalSnapshot {
  runs: Map<string, WorkflowRun>
  attempts: Map<string, StepAttempt>
  processes: Map<string, ProcessRecord>
  receipts: RuntimeCommandReceipt[]
  errors: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readTextFileNoFollow(path))
}

function addUnique<T extends { id: string }>(
  records: Map<string, T>,
  quarantined: Set<string>,
  record: T,
  kind: string,
  errors: string[],
): boolean {
  if (quarantined.has(record.id)) return false
  if (records.has(record.id)) {
    records.delete(record.id)
    quarantined.add(record.id)
    errors.push(`Duplicate ${kind} identity ${record.id}`)
    return false
  }
  records.set(record.id, record)
  return true
}

function quarantineIdentity<T>(
  records: Map<string, T>,
  quarantined: Set<string>,
  id: string,
): void {
  records.delete(id)
  quarantined.add(id)
}

interface ProcessInspectionContext {
  snapshot: RecoveryPhysicalSnapshot
  quarantinedProcesses: Set<string>
  runId: string
  attemptId: string
  validAttempt: boolean
  attemptPath: string | null
}

function validProcessOwnership(
  record: ProcessRecord,
  label: string,
  expectedProcessId: string | undefined,
  context: ProcessInspectionContext,
): boolean {
  const { snapshot, quarantinedProcesses, runId, attemptId } = context
  if (expectedProcessId !== undefined && record.id !== expectedProcessId) {
    quarantineIdentity(snapshot.processes, quarantinedProcesses, record.id)
    snapshot.errors.push(`Process record identity mismatch at ${label}: expected ${expectedProcessId}, received ${record.id}`)
    return false
  }
  if (record.workflow_run_id !== runId || record.attempt_id !== attemptId) {
    quarantineIdentity(snapshot.processes, quarantinedProcesses, record.id)
    snapshot.errors.push(`Process ownership mismatch at ${label}: expected run ${runId} attempt ${attemptId}, received run ${record.workflow_run_id} attempt ${record.attempt_id}`)
    return false
  }
  return true
}

function validProcessAncestor(record: ProcessRecord, label: string, context: ProcessInspectionContext): boolean {
  try {
    assertSafePathSegment(record.id, 'process id')
  } catch (error) {
    context.snapshot.errors.push(`Unsafe process record identity at ${label}: ${errorMessage(error)}`)
    return false
  }
  if (!context.validAttempt) {
    quarantineIdentity(context.snapshot.processes, context.quarantinedProcesses, record.id)
    context.snapshot.errors.push(context.attemptPath
      ? `Process ${record.id} references invalid attempt ${record.attempt_id}`
      : `Process ${record.id} references missing attempt ${record.attempt_id}`)
    return false
  }
  return true
}

async function inspectRecoveryProcess(
  path: string,
  label: string,
  expectedProcessId: string | undefined,
  context: ProcessInspectionContext,
): Promise<void> {
  try {
    const parsed = ProcessRecordSchema.safeParse(await readJson(path))
    if (!parsed.success) {
      context.snapshot.errors.push(`Malformed process record at ${label}: ${parsed.error.message}`)
      return
    }
    if (!validProcessOwnership(parsed.data, label, expectedProcessId, context)) return
    if (!validProcessAncestor(parsed.data, label, context)) return
    addUnique(context.snapshot.processes, context.quarantinedProcesses, parsed.data, 'process', context.snapshot.errors)
  } catch (error) {
    context.snapshot.errors.push(`Malformed process record at ${label}: ${errorMessage(error)}`)
  }
}

async function scanRuntimeRecords(
  basePath: string,
  snapshot: RecoveryPhysicalSnapshot,
): Promise<void> {
  const root = await lookupRunsRoot(basePath)
  if (!root) return
  const quarantinedRuns = new Set<string>()
  const quarantinedAttempts = new Set<string>()
  const quarantinedProcesses = new Set<string>()

  for (const runEntry of await readdir(root, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue
    try {
      assertSafePathSegment(runEntry.name, 'run id')
    } catch (error) {
      snapshot.errors.push(`Unsafe run directory ${runEntry.name}: ${errorMessage(error)}`)
      continue
    }
    try {
      const runDirectory = await resolveExistingPathWithinRoot(root, runEntry.name)
      const runLabel = `${runEntry.name}/run.json`
      let validRun = false
      const runPath = await resolveExistingPathWithinRoot(runDirectory, 'run.json').catch(() => null)
      if (!runPath) {
        snapshot.errors.push(`Missing run record at ${runLabel}`)
      } else {
        try {
          const parsed = WorkflowRunSchema.safeParse(await readJson(runPath))
          if (!parsed.success) {
            snapshot.errors.push(`Malformed run record at ${runLabel}: ${parsed.error.message}`)
          } else if (parsed.data.id !== runEntry.name) {
            quarantineIdentity(snapshot.runs, quarantinedRuns, parsed.data.id)
            snapshot.errors.push(
              `Run record identity mismatch at ${runLabel}: expected ${runEntry.name}, received ${parsed.data.id}`,
            )
          } else {
            validRun = addUnique(
              snapshot.runs,
              quarantinedRuns,
              parsed.data,
              'run',
              snapshot.errors,
            )
          }
        } catch (error) {
          snapshot.errors.push(`Malformed run record at ${runLabel}: ${errorMessage(error)}`)
        }
      }

      const attemptsRoot = await resolveExistingPathWithinRoot(runDirectory, 'attempts').catch(() => null)
      if (!attemptsRoot) continue
      for (const attemptEntry of await readdir(attemptsRoot, { withFileTypes: true })) {
        if (!attemptEntry.isDirectory()) continue
        try {
          assertSafePathSegment(attemptEntry.name, 'attempt id')
        } catch (error) {
          snapshot.errors.push(
            `Unsafe attempt directory ${runEntry.name}/attempts/${attemptEntry.name}: ${errorMessage(error)}`,
          )
          continue
        }
        try {
          const attemptDirectory = await resolveExistingPathWithinRoot(attemptsRoot, attemptEntry.name)
          const attemptLabel = `${runEntry.name}/attempts/${attemptEntry.name}/attempt.json`
          const attemptPath = await resolveExistingPathWithinRoot(attemptDirectory, 'attempt.json').catch(() => null)
          let validAttempt = false
          if (attemptPath) {
            try {
              const parsed = StepAttemptSchema.safeParse(await readJson(attemptPath))
              if (!parsed.success) {
                snapshot.errors.push(`Malformed attempt record at ${attemptLabel}: ${parsed.error.message}`)
              } else {
                let identityValid = true
                if (parsed.data.id !== attemptEntry.name) {
                  quarantineIdentity(
                    snapshot.attempts,
                    quarantinedAttempts,
                    parsed.data.id,
                  )
                  snapshot.errors.push(
                    `Attempt record identity mismatch at ${attemptLabel}: expected ${attemptEntry.name}, received ${parsed.data.id}`,
                  )
                  identityValid = false
                }
                if (parsed.data.workflow_run_id !== runEntry.name) {
                  quarantineIdentity(
                    snapshot.attempts,
                    quarantinedAttempts,
                    parsed.data.id,
                  )
                  snapshot.errors.push(
                    `Attempt ownership mismatch at ${attemptLabel}: expected run ${runEntry.name}, received ${parsed.data.workflow_run_id}`,
                  )
                  identityValid = false
                }
                if (identityValid && validRun) {
                  validAttempt = addUnique(
                    snapshot.attempts,
                    quarantinedAttempts,
                    parsed.data,
                    'attempt',
                    snapshot.errors,
                  )
                } else if (identityValid) {
                  quarantineIdentity(
                    snapshot.attempts,
                    quarantinedAttempts,
                    parsed.data.id,
                  )
                  snapshot.errors.push(
                    `Attempt ${parsed.data.id} is under invalid run ${runEntry.name}`,
                  )
                }
              }
            } catch (error) {
              snapshot.errors.push(`Malformed attempt record at ${attemptLabel}: ${errorMessage(error)}`)
            }
          }

          const processInspection: ProcessInspectionContext = {
            snapshot, quarantinedProcesses, runId: runEntry.name,
            attemptId: attemptEntry.name, validAttempt, attemptPath,
          }
          const inspectProcess = async (
            processPath: string,
            processLabel: string,
            expectedProcessId?: string,
          ): Promise<void> => await inspectRecoveryProcess(
            processPath, processLabel, expectedProcessId, processInspection,
          )

          const legacyProcessLabel = `${runEntry.name}/attempts/${attemptEntry.name}/process.json`
          const legacyProcessPath = await resolveExistingPathWithinRoot(attemptDirectory, 'process.json').catch(() => null)
          if (legacyProcessPath) {
            await inspectProcess(legacyProcessPath, legacyProcessLabel)
          }
          const processesDirectory = await resolveExistingPathWithinRoot(attemptDirectory, 'processes').catch(() => null)
          if (processesDirectory) {
            for (const processEntry of await readdir(processesDirectory, { withFileTypes: true })) {
              if (!processEntry.isFile() || !processEntry.name.endsWith('.json')) continue
              const processId = processEntry.name.slice(0, -'.json'.length)
              try {
                assertSafePathSegment(processId, 'process id')
              } catch (error) {
                snapshot.errors.push(
                  `Unsafe process record filename ${runEntry.name}/attempts/${attemptEntry.name}/processes/${processEntry.name}: ${errorMessage(error)}`,
                )
                continue
              }
              const processLabel = `${runEntry.name}/attempts/${attemptEntry.name}/processes/${processEntry.name}`
              const processPath = await resolveExistingPathWithinRoot(processesDirectory, processEntry.name)
              await inspectProcess(processPath, processLabel, processId)
            }
          }
        } catch (error) {
          snapshot.errors.push(
            `Failed to inspect attempt directory ${runEntry.name}/attempts/${attemptEntry.name}: ${errorMessage(error)}`,
          )
        }
      }
    } catch (error) {
      snapshot.errors.push(`Failed to inspect run directory ${runEntry.name}: ${errorMessage(error)}`)
    }
  }

  for (const [attemptId, record] of snapshot.attempts) {
    if (snapshot.runs.has(record.workflow_run_id)) continue
    quarantineIdentity(snapshot.attempts, quarantinedAttempts, attemptId)
    snapshot.errors.push(
      `Attempt ${record.id} references invalid run ${record.workflow_run_id}`,
    )
  }

  for (const [processId, record] of snapshot.processes) {
    const owner = snapshot.attempts.get(record.attempt_id)
    if (owner?.workflow_run_id === record.workflow_run_id) continue
    quarantineIdentity(snapshot.processes, quarantinedProcesses, processId)
    snapshot.errors.push(
      `Process ${record.id} references invalid attempt ${record.attempt_id}`,
    )
  }
}

async function scanCommandReceipts(
  basePath: string,
  snapshot: RecoveryPhysicalSnapshot,
): Promise<void> {
  const root = await lookupCommandsRoot(basePath)
  if (!root) return
  const seen = new Set<string>()
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const path = await resolveExistingPathWithinRoot(root, entry.name)
      const parsed = RuntimeCommandReceiptSchema.safeParse(await readJson(path))
      if (!parsed.success) {
        snapshot.errors.push(`Malformed runtime command receipt ${entry.name}: ${parsed.error.message}`)
        continue
      }
      try {
        assertSafePathSegment(parsed.data.id, 'command id')
      } catch (error) {
        snapshot.errors.push(`Unsafe runtime command receipt identity at ${entry.name}: ${errorMessage(error)}`)
        continue
      }
      if (entry.name !== `${parsed.data.id}.json`) {
        snapshot.errors.push(
          `Runtime command receipt identity mismatch at ${entry.name}: received ${parsed.data.id}`,
        )
        continue
      }
      if (seen.has(parsed.data.id)) {
        snapshot.errors.push(`Duplicate runtime command receipt identity ${parsed.data.id}`)
        continue
      }
      seen.add(parsed.data.id)
      snapshot.receipts.push(parsed.data)
    } catch (error) {
      snapshot.errors.push(`Malformed runtime command receipt ${entry.name}: ${errorMessage(error)}`)
    }
  }
  snapshot.receipts.sort((left, right) => left.id.localeCompare(right.id))
}

export async function scanRecoveryPhysicalState(basePath: string): Promise<RecoveryPhysicalSnapshot> {
  const snapshot: RecoveryPhysicalSnapshot = {
    runs: new Map(),
    attempts: new Map(),
    processes: new Map(),
    receipts: [],
    errors: [],
  }
  try {
    await scanRuntimeRecords(basePath, snapshot)
  } catch (error) {
    snapshot.errors.push(`Failed to scan canonical runtime records: ${errorMessage(error)}`)
  }
  try {
    await scanCommandReceipts(basePath, snapshot)
  } catch (error) {
    snapshot.errors.push(`Failed to scan runtime command receipts: ${errorMessage(error)}`)
  }
  return snapshot
}
