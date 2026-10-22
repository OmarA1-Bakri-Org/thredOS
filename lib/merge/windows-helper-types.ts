import { z } from 'zod'

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const Identity = z.string().regex(/^[a-fA-F0-9]{48}$/)

export const WindowsHelperRequestSchema = z.object({
  schema_version: z.literal(1),
  operation_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  root: z.string().min(1).max(4096),
  expected_root_id: Identity,
  source: z.string().min(1).max(4096),
  expected_source_id: Identity,
  destination: z.string().max(4096),
  expected_destination_parent_id: z.string(),
  kind: z.enum(['rename', 'delete']),
  plan_id: z.string().min(1).max(256),
  plan_hash: Digest,
  preview_hash: Digest,
  approval_hash: Digest,
  root_hash: Digest,
}).strict().superRefine((request, context) => {
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
