import { z } from 'zod'
import { normalizeSnapshotRelativePath } from '../workspaces/schema'

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const PortablePath = z.string().min(1).max(4096).refine(value => {
  try { return normalizeSnapshotRelativePath(value) === value } catch { return false }
}, 'Expected a portable contained relative path')
const Identity = z.string().regex(/^[a-fA-F0-9]{48}$/)

export const WindowsHelperRequestSchema = z.object({
  schema_version: z.literal(1),
  operation_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  root: z.string().min(1).max(4096),
  expected_root_id: Identity,
  source: PortablePath,
  expected_source_id: Identity,
  destination: z.union([z.literal(''), PortablePath]),
  expected_destination_parent_id: z.string(),
  kind: z.enum(['rename', 'delete', 'stage']),
  content_file: z.string().min(1).max(4096).optional(),
  expected_sha256: Digest.optional(),
  expected_size: z.number().int().nonnegative().optional(),
  expected_mode: z.number().int().min(0).max(0o777).optional(),
  plan_id: z.string().min(1).max(256),
  plan_hash: Digest,
  preview_hash: Digest,
  approval_hash: Digest,
  root_hash: Digest,
}).strict().superRefine((request, context) => {
  if (request.kind === 'stage' && (!request.content_file || !request.expected_sha256
    || request.expected_size === undefined || request.expected_mode === undefined)) {
    context.addIssue({ code: 'custom', message: 'Stage requires exact external content evidence' })
  }
  if (request.kind === 'rename' || request.kind === 'stage') {
    if (!request.destination || !Identity.safeParse(request.expected_destination_parent_id).success) {
      context.addIssue({ code: 'custom', message: 'Stage/rename requires pinned destination parent' })
    }
  }
  if (request.kind === 'rename' && (!request.destination || !Identity.safeParse(request.expected_destination_parent_id).success)) {
    context.addIssue({ code: 'custom', message: 'Rename requires destination and pinned destination parent' })
  }
  if (request.kind === 'delete' && (request.destination || request.expected_destination_parent_id)) {
    context.addIssue({ code: 'custom', message: 'Delete cannot name a destination' })
  }
})
export type WindowsHelperRequest = z.infer<typeof WindowsHelperRequestSchema>

export const WindowsHelperJournalSchema = z.object({
  schema_version: z.literal(1),
  operation_id: z.string(),
  request_hash: Digest,
  plan_id: z.string(),
  plan_hash: Digest,
  preview_hash: Digest,
  approval_hash: Digest,
  root_hash: Digest,
  phase: z.enum(['launch', 'prepared', 'started', 'terminal', 'indeterminate']),
  pid: z.number().int().positive().nullable(),
  exit_code: z.number().int().nullable(),
  result: z.enum(['succeeded', 'failed']).nullable(),
  error_code: z.string().nullable(),
  source_identity_after: z.string().nullable(),
  destination_identity_after: z.string().nullable(),
  updated_at: z.string().datetime(),
}).strict()
export type WindowsHelperJournal = z.infer<typeof WindowsHelperJournalSchema>

export interface WindowsHelperResult {
  status: 'succeeded' | 'failed' | 'indeterminate'
  operationId: string
  journalPath: string
  pid: number | null
  exitCode: number | null
  code: string
}
