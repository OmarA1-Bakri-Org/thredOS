import { lstat, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readTextFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolvePathWithinRoot } from '../security/safe-path'
import { canonicalizeProspectivePath } from '../workspaces/paths'
import { MergePlanSchema, type MergePlan } from './schema'

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const MergePlanBindingSchema = z.object({
  candidate_manifest_hash: Digest,
  selected_change_sets: z.array(z.object({
    id: z.string().min(1),
    change_set_root_hash: Digest,
  }).strict()).min(1),
}).strict()
export type MergePlanBinding = z.infer<typeof MergePlanBindingSchema>

const MergePlanRecordSchema = z.object({
  schema_version: z.literal(1),
  plan: MergePlanSchema,
  binding: MergePlanBindingSchema,
}).strict().superRefine((record, context) => {
  const planIds = [...record.plan.change_set_ids].sort()
  const bindingIds = record.binding.selected_change_sets.map(item => item.id).sort()
  if (new Set(bindingIds).size !== bindingIds.length || JSON.stringify(planIds) !== JSON.stringify(bindingIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['binding', 'selected_change_sets'],
      message: 'Selection binding must match the exact plan Change Set IDs' })
  }
})

export const MergePreviewRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  merge_plan_id: z.string().min(1),
  workflow_run_id: z.string().min(1),
  canonical_precondition_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidate_manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decision_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.enum(['creating', 'ready', 'failed']),
  root_path: z.string().min(1),
  manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  error_code: z.string().nullable(),
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable(),
}).strict().superRefine((record, context) => {
  if (record.status === 'ready' && (record.manifest_hash === null || record.ready_at === null || record.error_code !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Ready preview requires manifest and timestamp', path: ['status'] })
  }
  if (record.status === 'failed' && (record.error_code === null || record.manifest_hash !== null || record.ready_at !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Failed preview requires an error code only', path: ['status'] })
  }
  if (record.status === 'creating' && (record.error_code !== null || record.manifest_hash !== null || record.ready_at !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Creating preview must not carry result evidence', path: ['status'] })
  }
})
export type MergePreviewRecord = z.infer<typeof MergePreviewRecordSchema>

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function sameAbsolutePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

async function ensurePlainDirectory(root: string, segment: string): Promise<string> {
  const lexical = resolve(root)
  if (!sameAbsolutePath(await canonicalizeProspectivePath(lexical), lexical)) throw new Error('MERGE_UNSAFE_STORAGE')
  await mkdir(lexical, { recursive: true })
  const rootStat = await lstat(lexical)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
  const path = await resolvePathWithinRoot(lexical, segment)
  await mkdir(path, { recursive: true })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('MERGE_UNSAFE_STORAGE')
  return path
}

async function readRecord<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('MERGE_RECORD_CORRUPT')
    return schema.parse(JSON.parse(await readTextFileNoFollow(path)))
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

export class MergeRecordRepository {
  constructor(private readonly runtimeDataRoot: string) {}

  private async path(kind: 'merge-plans' | 'merge-previews', id: string): Promise<string> {
    const directory = await ensurePlainDirectory(this.runtimeDataRoot, kind)
    return resolvePathWithinRoot(directory, `${assertSafePathSegment(id, 'merge record id')}.json`)
  }

  private async planEnvelope(id: string): Promise<z.infer<typeof MergePlanRecordSchema> | null> {
    const envelope = await readRecord(await this.path('merge-plans', id), MergePlanRecordSchema)
    if (envelope && envelope.plan.id !== id) throw new Error('MERGE_RECORD_CORRUPT')
    return envelope
  }

  async getPlan(id: string): Promise<MergePlan | null> {
    return (await this.planEnvelope(id))?.plan ?? null
  }

  async getPlanBinding(id: string): Promise<MergePlanBinding | null> {
    return (await this.planEnvelope(id))?.binding ?? null
  }

  async createPlan(value: MergePlan, rawBinding: MergePlanBinding): Promise<MergePlan> {
    const plan = MergePlanSchema.parse(value)
    const binding = MergePlanBindingSchema.parse(rawBinding)
    if (plan.change_set_ids.length !== 1 || binding.selected_change_sets.length !== 1) {
      throw new Error('MERGE_COMPOSITION_UNAVAILABLE')
    }
    const envelope = MergePlanRecordSchema.parse({ schema_version: 1, plan, binding })
    if (plan.revision !== 0) throw new Error('MERGE_REVISION_CONFLICT')
    const path = await this.path('merge-plans', plan.id)
    await withExclusiveFileLock(`${path}.lock`, async () => {
      if (await readRecord(path, MergePlanRecordSchema)) throw new Error('MERGE_RECORD_EXISTS')
      await writeFileAtomic(path, JSON.stringify(envelope), { allowedRoot: this.runtimeDataRoot })
    }, { allowedRoot: this.runtimeDataRoot })
    return plan
  }

  async updatePlan(id: string, expectedRevision: number, mutate: (current: MergePlan) => MergePlan): Promise<MergePlan> {
    const path = await this.path('merge-plans', id)
    return withExclusiveFileLock(`${path}.lock`, async () => {
      const envelope = await readRecord(path, MergePlanRecordSchema)
      if (!envelope) throw new Error('MERGE_PLAN_NOT_FOUND')
      const current = envelope.plan
      if (current.revision !== expectedRevision) throw new Error('MERGE_REVISION_CONFLICT')
      const next = MergePlanSchema.parse({ ...mutate(structuredClone(current)), revision: current.revision + 1 })
      if (next.id !== id || next.workflow_run_id !== current.workflow_run_id
        || next.baseline_snapshot_id !== current.baseline_snapshot_id
        || next.canonical_precondition_hash !== current.canonical_precondition_hash
        || next.created_at !== current.created_at
        || JSON.stringify(next.change_set_ids) !== JSON.stringify(current.change_set_ids)) {
        throw new Error('MERGE_RECORD_IDENTITY_CHANGED')
      }
      await writeFileAtomic(path, JSON.stringify({ ...envelope, plan: next }), { allowedRoot: this.runtimeDataRoot })
      return next
    }, { allowedRoot: this.runtimeDataRoot })
  }

  async getPreview(id: string): Promise<MergePreviewRecord | null> {
    const record = await readRecord(await this.path('merge-previews', id), MergePreviewRecordSchema)
    if (record && record.id !== id) throw new Error('MERGE_RECORD_CORRUPT')
    return record
  }

  async createPreview(value: MergePreviewRecord): Promise<MergePreviewRecord> {
    const record = MergePreviewRecordSchema.parse(value)
    if (record.revision !== 0 || record.status !== 'creating') throw new Error('MERGE_INVALID_PREVIEW_STATE')
    const path = await this.path('merge-previews', record.id)
    await withExclusiveFileLock(`${path}.lock`, async () => {
      if (await readRecord(path, MergePreviewRecordSchema)) throw new Error('MERGE_RECORD_EXISTS')
      await writeFileAtomic(path, JSON.stringify(record), { allowedRoot: this.runtimeDataRoot })
    }, { allowedRoot: this.runtimeDataRoot })
    return record
  }

  async updatePreview(id: string, expectedRevision: number, mutate: (current: MergePreviewRecord) => MergePreviewRecord): Promise<MergePreviewRecord> {
    const path = await this.path('merge-previews', id)
    return withExclusiveFileLock(`${path}.lock`, async () => {
      const current = await readRecord(path, MergePreviewRecordSchema)
      if (!current) throw new Error('MERGE_PREVIEW_NOT_FOUND')
      if (current.revision !== expectedRevision) throw new Error('MERGE_REVISION_CONFLICT')
      if (current.status !== 'creating' && current.status !== 'ready') throw new Error('MERGE_INVALID_PREVIEW_STATE')
      const next = MergePreviewRecordSchema.parse({ ...mutate(structuredClone(current)), revision: current.revision + 1 })
      if (next.id !== id || next.merge_plan_id !== current.merge_plan_id || next.root_path !== current.root_path
        || next.workflow_run_id !== current.workflow_run_id
        || next.canonical_precondition_hash !== current.canonical_precondition_hash
        || next.candidate_manifest_hash !== current.candidate_manifest_hash
        || next.decision_hash !== current.decision_hash || next.created_at !== current.created_at
        || next.status === 'creating' || (current.status === 'ready' && next.status !== 'failed')) {
        throw new Error('MERGE_INVALID_PREVIEW_STATE')
      }
      await writeFileAtomic(path, JSON.stringify(next), { allowedRoot: this.runtimeDataRoot })
      return next
    }, { allowedRoot: this.runtimeDataRoot })
  }
}
