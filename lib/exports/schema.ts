import { z } from 'zod'
import { TraceEventSchema, GateDecisionSchema, ApprovalSchema, AgentRegistrationEvidenceSchema } from '@/lib/contracts/schemas'
import { StepAttemptSchema, WorkflowRunSchema } from '@/lib/runtime/schema'

export const ExportStepAttemptSchema = StepAttemptSchema.omit({ agent_registration: true }).extend({
  agent_registration: AgentRegistrationEvidenceSchema.optional(),
})

export const ExportWorkflowRunSchema = WorkflowRunSchema.omit({ agent_registrations: true }).extend({
  agent_registrations: z.record(z.string(), AgentRegistrationEvidenceSchema).optional(),
})

export const ExportBundleSchema = z.object({
  bundle_version: z.literal('1.0'),
  run_id: z.string().min(1),
  run_source: z.enum(['legacy', 'v2']).default('legacy'),
  run_schema_version: z.union([z.literal(1), z.literal(2)]).default(1),
  workflow_run: ExportWorkflowRunSchema.nullable().default(null),
  attempts: z.array(ExportStepAttemptSchema).default([]),
  pack: z.object({
    id: z.string().nullable(),
    version: z.string().nullable(),
  }),
  sequence_snapshot: z.string(),
  policy_snapshot: z.string().nullable(),
  surfaces: z.array(z.unknown()),
  trace_events: z.array(TraceEventSchema),
  gate_decisions: z.array(GateDecisionSchema),
  approvals: z.array(ApprovalSchema),
  artifact_manifests: z.array(z.string()),
  timing_summary: z.unknown().nullable(),
  cost_summary: z.unknown().nullable(),
  exported_at: z.string(),
})

export type ExportBundle = z.infer<typeof ExportBundleSchema>
