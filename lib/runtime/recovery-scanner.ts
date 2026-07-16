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

          const processLabel = `${runEntry.name}/attempts/${attemptEntry.name}/process.json`
          const processPath = await resolveExistingPathWithinRoot(attemptDirectory, 'process.json').catch(() => null)
          if (!processPath) continue
          try {
            const parsed = ProcessRecordSchema.safeParse(await readJson(processPath))
            if (!parsed.success) {
              snapshot.errors.push(`Malformed process record at ${processLabel}: ${parsed.error.message}`)
              continue
            }
            if (
              parsed.data.workflow_run_id !== runEntry.name
              || parsed.data.attempt_id !== attemptEntry.name
            ) {
              quarantineIdentity(
                snapshot.processes,
                quarantinedProcesses,
                parsed.data.id,
              )
              snapshot.errors.push(
                `Process ownership mismatch at ${processLabel}: expected run ${runEntry.name} attempt ${attemptEntry.name}, received run ${parsed.data.workflow_run_id} attempt ${parsed.data.attempt_id}`,
              )
              continue
            }
            try {
              assertSafePathSegment(parsed.data.id, 'process id')
            } catch (error) {
              snapshot.errors.push(
                `Unsafe process record identity at ${processLabel}: ${errorMessage(error)}`,
              )
              continue
            }
            if (!validAttempt) {
              quarantineIdentity(
                snapshot.processes,
                quarantinedProcesses,
                parsed.data.id,
              )
              snapshot.errors.push(
                attemptPath
                  ? `Process ${parsed.data.id} references invalid attempt ${parsed.data.attempt_id}`
                  : `Process ${parsed.data.id} references missing attempt ${parsed.data.attempt_id}`,
              )
              continue
            }
            addUnique(
              snapshot.processes,
              quarantinedProcesses,
              parsed.data,
              'process',
              snapshot.errors,
            )
          } catch (error) {
            snapshot.errors.push(`Malformed process record at ${processLabel}: ${errorMessage(error)}`)
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
