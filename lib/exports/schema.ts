import { z } from 'zod'
import { TraceEventSchema, GateDecisionSchema, ApprovalSchema } from '@/lib/contracts/schemas'

export const ExportBundleSchema = z.object({
  bundle_version: z.literal('1.0'),
  run_id: z.string().min(1),
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
