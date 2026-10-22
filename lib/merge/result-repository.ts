import { lstat, mkdir, readdir } from 'fs/promises'
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
    mode: z.number().int().nonnegative(), evidence_file: z.string().min(1).refine(value => { try { return assertSafePathSegment(value, 'evidence file') === value } catch { return false } }) }).strict(),
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

const applyStatusForPhase = {
  prepared: 'pending', applying: 'pending', rolling_back: 'pending', applied: 'applied',
  rolled_back: 'rolled_back', rollback_failed: 'rollback_failed',
} as const

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

export const MergeMutationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  kind: z.enum(['stage', 'rename', 'delete']), source: z.string(), destination: z.string(),
  expected_sha256: Digest, size_bytes: z.number().int().nonnegative(), mode: z.number().int().nonnegative(),
  status: z.enum(['planned', 'succeeded', 'failed', 'indeterminate']),
  helper_journal: z.string().nullable(), pid: z.number().int().positive().nullable(), code: z.string().nullable(),
}).strict().superRefine((operation, context) => {
  const valid = (path: string, empty: boolean) => {
    if (!path) return empty
    try { return normalizeSnapshotRelativePath(path) === path } catch { return false }
  }
  if (!valid(operation.source, operation.kind === 'stage') || !valid(operation.destination, operation.kind === 'delete')
    || (operation.kind === 'stage' && operation.source !== '') || (operation.kind === 'delete' && operation.destination !== '')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Mutation paths must be portable and match operation kind' })
  }
})
export type MergeMutation = z.infer<typeof MergeMutationSchema>
const AuthoritySchema = z.object({ approval_id: z.string().min(1), operator_actor: z.string().min(1),
  idempotency_key: z.string().min(1), policy_hash: Digest, root_identity: z.string().min(1), validation_commands_hash: Digest }).strict()

export const MergeTransactionRecordSchema = z.object({
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative(),
  plan_digest: Digest,
  preview_id: z.string().min(1),
  decision_hash: Digest,
  canonical_root_hash: Digest,
  canonical_precondition_hash: Digest,
  preview_manifest_hash: Digest,
  phase: z.enum(['prepared', 'applying', 'rolling_back', 'applied', 'rolled_back', 'rollback_failed']),
  entries: z.array(MergeJournalEntrySchema),
  authority: AuthoritySchema.nullable().default(null),
  operations: z.array(MergeMutationSchema).default([]),
  post_checks: z.array(z.object({ id: z.string().min(1), attempt_id: z.string().min(1), ordinal: z.number().int().nonnegative(),
    status: z.enum(['planned', 'passed', 'failed']) }).strict()).default([]),
  rollback_authorities: z.array(z.object({ approval_id: z.string().min(1), operator_actor: z.string().min(1),
    plan_digest: Digest, policy_hash: Digest, idempotency_key: z.string().min(1) }).strict()).default([]),
  result: MergeResultSchema,
}).strict().superRefine((record, context) => {
  if (record.result.filesystem_apply.status !== applyStatusForPhase[record.phase]) {
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
  ['prepared', ['prepared', 'applying', 'rolling_back', 'rolled_back', 'rollback_failed']],
  ['applying', ['applying', 'rolling_back', 'applied', 'rolled_back', 'rollback_failed']],
  ['rolling_back', ['rolling_back', 'rolled_back', 'rollback_failed']],
  ['applied', ['applied', 'rolling_back', 'rolled_back', 'rollback_failed']],
  ['rolled_back', ['rolled_back', 'rollback_failed']],
  ['rollback_failed', ['rollback_failed', 'rolling_back', 'rolled_back']],
])

function transactionIdentity(record: MergeTransactionRecord): readonly (string | number)[] {
  return [record.schema_version, record.plan_digest, record.preview_id, record.decision_hash,
    record.canonical_root_hash, record.canonical_precondition_hash, record.preview_manifest_hash,
    JSON.stringify(record.authority), record.result.id, record.result.merge_plan_id, record.result.workflow_run_id, record.result.created_at]
}

function assertUpdateBinding(current: MergeTransactionRecord, next: MergeTransactionRecord): void {
  const mayBindStage = current.phase === 'prepared' && next.phase === 'prepared'
  if (JSON.stringify(transactionIdentity(current)) !== JSON.stringify(transactionIdentity(next))
    || !sameJournalEntriesExceptStageIdentity(current.entries, next.entries, mayBindStage)) {
    throw new Error('MERGE_RESULT_IDENTITY_CHANGED')
  }
  if (next.post_checks.length < current.post_checks.length || next.post_checks.length > current.post_checks.length + 1
    || current.post_checks.some((prior, index) => {
      const updated = next.post_checks[index]
      return !updated || prior.id !== updated.id || prior.attempt_id !== updated.attempt_id || prior.ordinal !== updated.ordinal
        || (prior.status !== 'planned' && prior.status !== updated.status)
    }) || (next.post_checks.length > current.post_checks.length && next.post_checks.at(-1)?.status !== 'planned')) {
    throw new Error('MERGE_OPERATION_HISTORY_CHANGED')
  }
  if (next.rollback_authorities.length < current.rollback_authorities.length
    || next.rollback_authorities.length > current.rollback_authorities.length + 1
    || current.rollback_authorities.some((authority, index) => JSON.stringify(authority) !== JSON.stringify(next.rollback_authorities[index]))) {
    throw new Error('MERGE_OPERATION_HISTORY_CHANGED')
  }
  if (next.operations.length > current.operations.length && current.operations.some(item => ['planned', 'indeterminate'].includes(item.status))) {
    throw new Error('MERGE_RECOVERY_REQUIRED')
  }
  if (next.operations.length < current.operations.length || next.operations.length > current.operations.length + 1) {
    throw new Error('MERGE_OPERATION_HISTORY_CHANGED')
  }
  current.operations.forEach((prior, index) => {
    const updated = next.operations[index]!
    const { status: oldStatus, helper_journal: oldJournal, pid: oldPid, code: oldCode, ...oldBinding } = prior
    const { status: newStatus, helper_journal: newJournal, pid: newPid, code: newCode, ...newBinding } = updated
    if (JSON.stringify(oldBinding) !== JSON.stringify(newBinding)
      || (oldStatus !== 'planned' && (oldStatus !== newStatus || oldJournal !== newJournal || oldPid !== newPid || oldCode !== newCode))) {
      throw new Error('MERGE_OPERATION_HISTORY_CHANGED')
    }
  })
  if (next.operations.length > current.operations.length && next.operations.at(-1)?.status !== 'planned') {
    throw new Error('MERGE_OPERATION_NOT_PLANNED')
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

function sameLocation(left: string, right: string): boolean {
  return sameOrWithin(left, right) && sameOrWithin(right, left)
}

async function ensurePlainRoot(runtimeDataRoot: string, canonicalRoot: string): Promise<string> {
  if (!isAbsolute(runtimeDataRoot) || !isAbsolute(canonicalRoot)) throw new Error('MERGE_UNSAFE_STORAGE')
  const root = resolve(runtimeDataRoot)
  const canonical = await canonicalizeProspectivePath(canonicalRoot)
  const prospective = await canonicalizeProspectivePath(root)
  if (!sameLocation(prospective, root)
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

  async list(): Promise<MergeTransactionRecord[]> {
    const names = await readdir(await this.root())
    const records = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => this.get(name.slice(0, -5))))
    return records.filter((item): item is MergeTransactionRecord => item !== null)
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
