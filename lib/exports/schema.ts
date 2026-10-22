import { z } from 'zod'
import {
  ApprovalSchema,
  AgentRegistrationEvidenceSchema,
  GateDecisionSchema,
  Sha256DigestSchema,
  TraceEventSchema,
} from '@/lib/contracts/schemas'
import {
  ProcessRecordSchema,
  StepAttemptSchema,
  WorkflowRunSchema,
} from '@/lib/runtime/schema'
import { SurfaceWorkspaceSchema, WorkspaceSnapshotSchema } from '@/lib/workspaces/schema'

const RedactedAbsolutePathSchema = z.literal('[redacted]')

export const ExportProcessRecordSchema = ProcessRecordSchema.extend({
  cwd: RedactedAbsolutePathSchema,
})

export const ExportSnapshotRecordSchema = WorkspaceSnapshotSchema.safeExtend({
  source_root: RedactedAbsolutePathSchema,
  content_root: z.union([RedactedAbsolutePathSchema, z.null()]),
})

export const ExportSnapshotManifestEntrySchema = z.object({
  path_sha256: Sha256DigestSchema,
  kind: z.enum(['file', 'directory', 'symlink']),
  sha256: Sha256DigestSchema.nullable(),
  size_bytes: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative().nullable(),
  symlink_target_sha256: Sha256DigestSchema.nullable(),
})

export const ExportSnapshotManifestSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1),
  root_manifest_hash: Sha256DigestSchema,
  entries: z.array(ExportSnapshotManifestEntrySchema),
})

export const ExportSnapshotEvidenceSchema = z.object({
  record: ExportSnapshotRecordSchema,
  manifest: ExportSnapshotManifestSchema,
})

export const ExportWorkspaceRecordSchema = SurfaceWorkspaceSchema.safeExtend({
  root_path: RedactedAbsolutePathSchema,
})

export const ExportStepAttemptSchema = StepAttemptSchema.omit({ agent_registration: true }).extend({
  agent_registration: AgentRegistrationEvidenceSchema.optional(),
})

export const ExportWorkflowRunSchema = WorkflowRunSchema.omit({ agent_registrations: true }).extend({
  agent_registrations: z.record(z.string(), AgentRegistrationEvidenceSchema).optional(),
})

export const ExportSurfaceSchema = z.object({
  id: z.string().min(1),
  surfaceClass: z.enum(['shared', 'private', 'sealed', 'control']),
  visibility: z.enum(['public', 'dependency', 'self_only']),
  isolationLabel: z.enum(['NONE', 'THREADOS_SCOPED', 'HOST_ENFORCED']),
  revealState: z.enum(['sealed', 'revealed']).nullable(),
})

export const ExportBundleSchema = z.object({
  bundle_version: z.literal('1.0'),
  run_id: z.string().min(1),
  run_source: z.enum(['legacy', 'v2']).default('legacy'),
  run_schema_version: z.union([z.literal(1), z.literal(2)]).default(1),
  workflow_run: ExportWorkflowRunSchema.nullable().default(null),
  attempts: z.array(ExportStepAttemptSchema).default([]),
  processes: z.array(ExportProcessRecordSchema).default([]),
  snapshots: z.array(ExportSnapshotEvidenceSchema).default([]),
  workspaces: z.array(ExportWorkspaceRecordSchema).default([]),
  pack: z.object({
    id: z.string().nullable(),
    version: z.string().nullable(),
  }),
  sequence_snapshot: z.string(),
  policy_snapshot: z.string().nullable(),
  surfaces: z.array(ExportSurfaceSchema),
  trace_events: z.array(TraceEventSchema),
  gate_decisions: z.array(GateDecisionSchema),
  approvals: z.array(ApprovalSchema),
  // New bundles contain stable path digests; accept older path entries when reading.
  artifact_manifests: z.array(z.string()),
  timing_summary: z.unknown().nullable(),
  cost_summary: z.unknown().nullable(),
  exported_at: z.string(),
})

export type ExportBundle = z.infer<typeof ExportBundleSchema>
