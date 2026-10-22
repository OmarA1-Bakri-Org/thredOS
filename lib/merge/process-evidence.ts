import { lstat } from 'fs/promises'
import { readTextFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { ProcessRecordSchema, type ProcessRecord } from '../runtime/schema'

/** Read an expected physical owner path; an index omission cannot establish quiescence. */
export async function readMergeValidationProcess(basePath: string, input: {
  id: string; runId: string; attemptId: string; workspaceId: string | null; ordinal: number
}): Promise<ProcessRecord | null> {
  try {
    for (const id of [input.id, input.runId, input.attemptId]) assertSafePathSegment(id, 'validation identity')
    const path = await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', input.runId,
      'attempts', input.attemptId, 'processes', `${input.id}.json`)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64 * 1024) return null
    const record = ProcessRecordSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
    return record.id === input.id && record.workflow_run_id === input.runId && record.attempt_id === input.attemptId
      && record.workspace_id === input.workspaceId && record.process_purpose === 'validation'
      && record.process_ordinal === input.ordinal && record.provider === 'local-process' ? record : null
  } catch { return null }
}
