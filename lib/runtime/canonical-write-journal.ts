import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertPortableRelativePath, assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { hashCanonicalJson } from '../workspaces/hash'
import type { SnapshotEntry } from '../workspaces/schema'

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const CanonicalPreconditionSchema = z.object({
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  workflow_run_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  pre_hash: DigestSchema,
  captured_at: z.string().datetime(),
  threados_project_write_refs: z.array(z.string()),
})
export type CanonicalPrecondition = z.infer<typeof CanonicalPreconditionSchema>

export const CanonicalProjectWriteSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  owner: z.enum(['merge-apply', 'rollback', 'runtime-test']),
  operation: z.enum(['add', 'modify', 'delete', 'chmod', 'symlink']),
  path: z.string().min(1),
  before_entry_hash: DigestSchema,
  after_entry_hash: DigestSchema.nullable(),
  status: z.enum(['planned', 'committed', 'failed']),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
}).superRefine((record, context) => {
  try {
    assertSafePathSegment(record.id, 'canonical write id')
    assertSafePathSegment(record.workflow_run_id, 'workflow run id')
    assertPortableRelativePath(record.path, 'canonical write path')
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'invalid canonical write record',
    })
  }
  if (record.status === 'committed' && (record.after_entry_hash == null || record.completed_at == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'committed canonical writes require after evidence' })
  }
})
export type CanonicalProjectWrite = z.infer<typeof CanonicalProjectWriteSchema>

export class CanonicalWriteAttributionError extends Error {
  readonly code = 'CANONICAL_WORKSPACE_MUTATED' as const

  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'CanonicalWriteAttributionError'
  }
}

export function snapshotEntryDigest(entry: SnapshotEntry | null): string {
  return hashCanonicalJson(entry == null ? { missing: true } : {
    path: entry.path,
    kind: entry.kind,
    sha256: entry.sha256,
    size_bytes: entry.size_bytes,
    mode: entry.mode,
    symlink_target: entry.symlink_target,
  })
}

async function runRoot(basePath: string, runId: string): Promise<string> {
  assertSafePathSegment(runId, 'workflow run id')
  return await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', runId)
}

async function preconditionPath(basePath: string, runId: string): Promise<string> {
  return await resolveExistingPathWithinRoot(await runRoot(basePath, runId), 'canonical-precondition.json')
}

export async function readCanonicalPrecondition(basePath: string, runId: string): Promise<CanonicalPrecondition> {
  try {
    const parsed = CanonicalPreconditionSchema.parse(JSON.parse(
      await readTextFileNoFollow(await preconditionPath(basePath, runId)),
    ))
    if (parsed.workflow_run_id !== runId) throw new Error('canonical precondition ownership mismatch')
    return parsed
  } catch (error) {
    throw new CanonicalWriteAttributionError(`Canonical pre-dispatch evidence is invalid for run ${runId}`, error)
  }
}

export async function beginCanonicalProjectWrite(input: {
  basePath: string
  workflowRunId: string
  owner: CanonicalProjectWrite['owner']
  operation: CanonicalProjectWrite['operation']
  path: string
  beforeEntry: SnapshotEntry | null
  now?: () => string
  createId?: () => string
}): Promise<CanonicalProjectWrite> {
  const now = input.now ?? (() => new Date().toISOString())
  const id = assertSafePathSegment(`canonical-write-${(input.createId ?? randomUUID)()}`, 'canonical write id')
  const relativePath = assertPortableRelativePath(input.path, 'canonical write path')
  const root = await runRoot(input.basePath, input.workflowRunId)
  const journalRoot = await resolvePathWithinRoot(root, 'canonical-writes')
  await mkdir(journalRoot, { recursive: true })
  await resolveExistingPathWithinRoot(root, 'canonical-writes')
  const recordPath = await resolvePathWithinRoot(journalRoot, `${id}.json`)
  const record = CanonicalProjectWriteSchema.parse({
    schema_version: 1,
    id,
    revision: 0,
    workflow_run_id: input.workflowRunId,
    owner: input.owner,
    operation: input.operation,
    path: relativePath,
    before_entry_hash: snapshotEntryDigest(input.beforeEntry),
    after_entry_hash: null,
    status: 'planned',
    created_at: now(),
    completed_at: null,
  })
  await writeFileAtomic(recordPath, `${JSON.stringify(record, null, 2)}\n`, { allowedRoot: input.basePath })

  const ref = `.threados/runs/${input.workflowRunId}/canonical-writes/${id}.json`
  const conditionPath = await preconditionPath(input.basePath, input.workflowRunId)
  await withExclusiveFileLock(`${conditionPath}.lock`, async () => {
    const current = await readCanonicalPrecondition(input.basePath, input.workflowRunId)
    if (current.threados_project_write_refs.includes(ref)) return
    const updated = CanonicalPreconditionSchema.parse({
      ...current,
      revision: current.revision + 1,
      threados_project_write_refs: [...current.threados_project_write_refs, ref],
    })
    await writeFileAtomic(conditionPath, `${JSON.stringify(updated, null, 2)}\n`, { allowedRoot: input.basePath })
  }, { allowedRoot: input.basePath })
  return record
}

export async function commitCanonicalProjectWrite(input: {
  basePath: string
  record: CanonicalProjectWrite
  afterEntry: SnapshotEntry | null
  now?: () => string
}): Promise<CanonicalProjectWrite> {
  const now = input.now ?? (() => new Date().toISOString())
  const root = await runRoot(input.basePath, input.record.workflow_run_id)
  const recordPath = await resolveExistingPathWithinRoot(root, 'canonical-writes', `${input.record.id}.json`)
  return await withExclusiveFileLock(`${recordPath}.lock`, async () => {
    const current = CanonicalProjectWriteSchema.parse(JSON.parse(await readTextFileNoFollow(recordPath)))
    if (current.id !== input.record.id || current.workflow_run_id !== input.record.workflow_run_id) {
      throw new CanonicalWriteAttributionError('Canonical write journal ownership mismatch')
    }
    if (current.status !== 'planned' || current.revision !== input.record.revision) {
      throw new CanonicalWriteAttributionError('Canonical write journal revision or lifecycle mismatch')
    }
    const committed = CanonicalProjectWriteSchema.parse({
      ...current,
      revision: current.revision + 1,
      after_entry_hash: snapshotEntryDigest(input.afterEntry),
      status: 'committed',
      completed_at: now(),
    })
    await writeFileAtomic(recordPath, `${JSON.stringify(committed, null, 2)}\n`, { allowedRoot: input.basePath })
    return committed
  }, { allowedRoot: input.basePath })
}

export async function readCanonicalProjectWrites(
  basePath: string,
  runId: string,
  refs: string[],
): Promise<CanonicalProjectWrite[]> {
  const expectedPrefix = `.threados/runs/${runId}/canonical-writes/`
  try {
    return await Promise.all(refs.map(async ref => {
      if (!ref.startsWith(expectedPrefix) || !ref.endsWith('.json')) {
        throw new Error('canonical write reference is outside the run journal')
      }
      const path = await resolveExistingPathWithinRoot(basePath, ...ref.split('/'))
      const record = CanonicalProjectWriteSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
      if (record.workflow_run_id !== runId || ref !== `${expectedPrefix}${record.id}.json`) {
        throw new Error('canonical write reference identity mismatch')
      }
      return record
    }))
  } catch (error) {
    throw new CanonicalWriteAttributionError(`Canonical write attribution is invalid for run ${runId}`, error)
  }
}

export function classifyCanonicalManifestChange(input: {
  before: SnapshotEntry[]
  after: SnapshotEntry[]
  writes: CanonicalProjectWrite[]
}): 'unchanged' | 'external_user_edit' | 'threados_mutation' {
  const before = new Map(input.before.map(entry => [entry.path, entry]))
  const after = new Map(input.after.map(entry => [entry.path, entry]))
  const paths = new Set([...before.keys(), ...after.keys()])
  const changed = new Set([...paths].filter(path =>
    snapshotEntryDigest(before.get(path) ?? null) !== snapshotEntryDigest(after.get(path) ?? null),
  ))
  if (changed.size === 0) return 'unchanged'

  let attributed = false
  for (const write of input.writes) {
    if (write.status !== 'committed' || write.after_entry_hash == null) {
      throw new CanonicalWriteAttributionError(`Canonical write ${write.id} lacks committed evidence`)
    }
    const beforeHash = snapshotEntryDigest(before.get(write.path) ?? null)
    const afterHash = snapshotEntryDigest(after.get(write.path) ?? null)
    if (write.before_entry_hash !== beforeHash || write.after_entry_hash !== afterHash || !changed.has(write.path)) {
      throw new CanonicalWriteAttributionError(`Canonical write ${write.id} does not match observed manifest evidence`)
    }
    attributed = true
  }
  return attributed ? 'threados_mutation' : 'external_user_edit'
}
