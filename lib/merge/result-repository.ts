import { lstat, mkdir } from 'fs/promises'
import { isAbsolute, relative, resolve, sep } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readTextFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolvePathWithinRoot } from '../security/safe-path'
import { canonicalizeProspectivePath } from '../workspaces/paths'
import { normalizeSnapshotRelativePath } from '../workspaces/schema'
import { findPortablePathAlias, MergeResultSchema } from './schema'

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const FileStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absent') }).strict(),
  z.object({ kind: z.literal('file'), sha256: Digest, size_bytes: z.number().int().nonnegative(),
    mode: z.number().int().nonnegative(), evidence_file: z.string().min(1) }).strict(),
])
export type MergeFileState = z.infer<typeof FileStateSchema>

export const MergeJournalEntrySchema = z.object({
  path: z.string().min(1).refine(value => {
    try { return normalizeSnapshotRelativePath(value) === value } catch { return false }
  }, 'Journal path must be safe and portable'),
  before: FileStateSchema,
  after: FileStateSchema,
  staged_file: z.string().nullable().refine(value => {
    if (value === null) return true
    try { return assertSafePathSegment(value, 'staged file') === value } catch { return false }
  }, 'Staged file name must be safe'),
  staged_identity: z.object({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/) }).strict().nullable(),
}).strict()
export type MergeJournalEntry = z.infer<typeof MergeJournalEntrySchema>

function sameJournalEntriesExceptStageIdentity(before: readonly MergeJournalEntry[],
  after: readonly MergeJournalEntry[], allowStageBinding: boolean): boolean {
  if (before.length !== after.length) return false
  return before.every((entry, index) => {
    const next = after[index]
    if (!next) return false
    const { staged_identity: priorIdentity, ...prior } = entry
    const { staged_identity: nextIdentity, ...updated } = next
    return JSON.stringify(prior) === JSON.stringify(updated)
      && (JSON.stringify(priorIdentity) === JSON.stringify(nextIdentity)
        || (allowStageBinding && priorIdentity === null && nextIdentity !== null))
  })
}

export const MergeTransactionRecordSchema = z.object({
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative(),
  plan_digest: Digest,
  preview_id: z.string().min(1),
  decision_hash: Digest,
  canonical_root_hash: Digest,
  canonical_precondition_hash: Digest,
  preview_manifest_hash: Digest,
  phase: z.enum(['prepared', 'applying', 'applied', 'rolled_back', 'rollback_failed']),
  entries: z.array(MergeJournalEntrySchema),
  result: MergeResultSchema,
}).strict().superRefine((record, context) => {
  const expected = record.phase === 'applied' ? 'applied'
    : record.phase === 'rolled_back' ? 'rolled_back'
      : record.phase === 'rollback_failed' ? 'rollback_failed' : 'pending'
  if (record.result.filesystem_apply.status !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'filesystem_apply', 'status'],
      message: 'Result status must match transaction phase' })
  }
  if (record.result.filesystem_apply.status !== 'pending'
    && record.result.filesystem_apply.rollback_ref !== record.result.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'filesystem_apply', 'rollback_ref'],
      message: 'Rollback reference must be this result ID' })
  }
  const paths = record.entries.map(entry => entry.path)
  if (new Set(paths).size !== paths.length || findPortablePathAlias(paths)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries'],
      message: 'Journal paths must not duplicate or alias one another' })
  }
})
export type MergeTransactionRecord = z.infer<typeof MergeTransactionRecordSchema>

const allowedPhaseTransitions = new Map<MergeTransactionRecord['phase'], readonly MergeTransactionRecord['phase'][]>([
  ['prepared', ['prepared', 'applying', 'rolled_back', 'rollback_failed']],
  ['applying', ['applying', 'applied', 'rolled_back', 'rollback_failed']],
  ['applied', ['applied', 'rolled_back', 'rollback_failed']],
  ['rolled_back', ['rolled_back', 'rollback_failed']],
  ['rollback_failed', ['rollback_failed', 'rolled_back']],
])

function transactionIdentity(record: MergeTransactionRecord): readonly (string | number)[] {
  return [record.schema_version, record.plan_digest, record.preview_id, record.decision_hash,
    record.canonical_root_hash, record.canonical_precondition_hash, record.preview_manifest_hash,
    record.result.id, record.result.merge_plan_id, record.result.workflow_run_id, record.result.created_at]
}

function assertUpdateBinding(current: MergeTransactionRecord, next: MergeTransactionRecord): void {
  const mayBindStage = current.phase === 'prepared' && next.phase === 'prepared'
  if (JSON.stringify(transactionIdentity(current)) !== JSON.stringify(transactionIdentity(next))
    || !sameJournalEntriesExceptStageIdentity(current.entries, next.entries, mayBindStage)) {
    throw new Error('MERGE_RESULT_IDENTITY_CHANGED')
  }
  if (!allowedPhaseTransitions.get(current.phase)?.includes(next.phase)) {
    throw new Error('MERGE_INVALID_RESULT_TRANSITION')
  }
}

function sameOrWithin(root: string, path: string): boolean {
  const left = process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root
  const right = process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
  const from = relative(left, right)
  return from === '' || (!isAbsolute(from) && from !== '..' && !from.startsWith(`..${sep}`))
}

async function ensurePlainRoot(runtimeDataRoot: string, canonicalRoot: string): Promise<string> {
  if (!isAbsolute(runtimeDataRoot) || !isAbsolute(canonicalRoot)) throw new Error('MERGE_UNSAFE_STORAGE')
  const root = resolve(runtimeDataRoot)
  const canonical = await canonicalizeProspectivePath(canonicalRoot)
  const prospective = await canonicalizeProspectivePath(root)
  if (!sameOrWithin(prospective, root) || !sameOrWithin(root, prospective)
    || sameOrWithin(root, canonical) || sameOrWithin(canonical, root)) {
    throw new Error('MERGE_UNSAFE_STORAGE')
  }
  await mkdir(root, { recursive: true })
  const item = await lstat(root)
  if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
  return root
}

/** Revisioned result and rollback metadata. Evidence bytes use a sibling plain directory. */
export class MergeResultRepository {
  constructor(private readonly runtimeDataRoot: string, private readonly canonicalRoot: string) {}

  async root(): Promise<string> {
    const runtime = await ensurePlainRoot(this.runtimeDataRoot, this.canonicalRoot)
    const directory = await resolvePathWithinRoot(runtime, 'merge-results')
    await mkdir(directory, { recursive: true })
    const item = await lstat(directory)
    if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
    return directory
  }

  async evidenceDirectory(id: string): Promise<string> {
    const root = await this.root()
    const path = await resolvePathWithinRoot(root, assertSafePathSegment(id, 'merge result id'))
    await mkdir(path, { recursive: true })
    const item = await lstat(path)
    if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
    return path
  }

  async hasEvidenceDirectory(id: string): Promise<boolean> {
    const root = await this.root()
    const path = await resolvePathWithinRoot(root, assertSafePathSegment(id, 'merge result id'))
    try {
      const item = await lstat(path)
      if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
      return true
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
  }

  async evidencePath(id: string, name: string): Promise<string> {
    const directory = await this.evidenceDirectory(id)
    return resolvePathWithinRoot(directory, assertSafePathSegment(name, 'merge evidence name'))
  }

  private async recordPath(id: string): Promise<string> {
    const root = await this.root()
    return resolvePathWithinRoot(root, `${assertSafePathSegment(id, 'merge result id')}.json`)
  }

  async get(id: string): Promise<MergeTransactionRecord | null> {
    const path = await this.recordPath(id)
    try {
      const item = await lstat(path)
      if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1) throw new Error('MERGE_RESULT_CORRUPT')
      try {
        const record = MergeTransactionRecordSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
        if (record.result.id !== id) throw new Error('MERGE_RESULT_CORRUPT')
        return record
      } catch {
        throw new Error('MERGE_RESULT_CORRUPT')
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async create(value: MergeTransactionRecord): Promise<MergeTransactionRecord> {
    const record = MergeTransactionRecordSchema.parse(value)
    if (record.revision !== 0 || record.phase !== 'prepared' || record.result.filesystem_apply.status !== 'pending') {
      throw new Error('MERGE_INVALID_RESULT_STATE')
    }
    const path = await this.recordPath(record.result.id)
    await withExclusiveFileLock(`${path}.lock`, async () => {
      if (await this.get(record.result.id)) throw new Error('MERGE_RESULT_EXISTS')
      await writeFileAtomic(path, JSON.stringify(record), { allowedRoot: this.runtimeDataRoot })
    }, { allowedRoot: this.runtimeDataRoot })
    return record
  }

  async update(id: string, expectedRevision: number,
    mutate: (current: MergeTransactionRecord) => MergeTransactionRecord): Promise<MergeTransactionRecord> {
    const path = await this.recordPath(id)
    return withExclusiveFileLock(`${path}.lock`, async () => {
      const current = await this.get(id)
      if (!current) throw new Error('MERGE_RESULT_NOT_FOUND')
      if (current.revision !== expectedRevision) throw new Error('MERGE_REVISION_CONFLICT')
      const next = MergeTransactionRecordSchema.parse({
        ...mutate(structuredClone(current)), revision: current.revision + 1,
      })
      assertUpdateBinding(current, next)
      await writeFileAtomic(path, JSON.stringify(next), { allowedRoot: this.runtimeDataRoot })
      return next
    }, { allowedRoot: this.runtimeDataRoot })
  }
}
