import { z } from 'zod'

// Schema naming convention: use Schema suffix to avoid name collision with types

// --- Surface sub-schemas ---

export const SurfaceClassSchema = z.enum(['shared', 'private', 'sealed', 'control'])
export type SurfaceClass = z.infer<typeof SurfaceClassSchema>

export const IsolationLabelSchema = z.enum(['NONE', 'THREADOS_SCOPED', 'HOST_ENFORCED'])
export type IsolationLabel = z.infer<typeof IsolationLabelSchema>

export const RevealPolicySchema = z.enum(['none', 'explicit', 'on_completion'])
export type RevealPolicy = z.infer<typeof RevealPolicySchema>

export const SurfaceStatusSchema = z.enum(['active', 'sealed', 'revealed', 'archived'])
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>

export const MetadataBudgetSchema = z.object({
  max_file_count: z.number().int().nonnegative(),
  max_total_bytes: z.number().int().nonnegative(),
})
export type MetadataBudget = z.infer<typeof MetadataBudgetSchema>

export const SurfaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  surface_class: SurfaceClassSchema,
  parent_surface_id: z.string().nullable(),
  workspace_root: z.string().min(1),
  artifact_root: z.string().min(1),
  visibility: z.enum(['public', 'dependency', 'self_only']),
  allowed_read_scopes: z.array(z.string()),
  allowed_write_scopes: z.array(z.string()),
  reveal_policy: RevealPolicySchema,
  metadata_budget: MetadataBudgetSchema.nullable(),
  isolation_label: IsolationLabelSchema,
  status: SurfaceStatusSchema,
})
export type Surface = z.infer<typeof SurfaceSchema>

// --- Run sub-schemas ---

export const RunStatusSchema = z.enum(['pending', 'running', 'successful', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const TimingSummarySchema = z.object({
  duration_ms: z.number(),
})
export type TimingSummary = z.infer<typeof TimingSummarySchema>

export const CostSummarySchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
})
export type CostSummary = z.infer<typeof CostSummarySchema>

export const RunSchema = z.object({
  id: z.string().min(1),
  sequence_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  attempt: z.number().int().positive(),
  status: RunStatusSchema,
  executor: z.string().min(1),
  model: z.string().min(1),
  policy_snapshot_hash: z.string().min(1),
  compiled_prompt_hash: z.string().min(1),
  input_manifest_ref: z.string().nullable(),
  artifact_manifest_ref: z.string().nullable(),
  started_at: z.string().min(1),
  ended_at: z.string().nullable(),
  timing_summary: TimingSummarySchema.nullable(),
  cost_summary: CostSummarySchema.nullable(),
})
export type Run = z.infer<typeof RunSchema>

// --- GateDecision sub-schemas ---

export const GateDecisionStatusSchema = z.enum(['PASS', 'BLOCK', 'NEEDS_APPROVAL'])
export type GateDecisionStatus = z.infer<typeof GateDecisionStatusSchema>

export const GateTypeSchema = z.enum([
  'deps_satisfied',
  'required_inputs_present',
  'policy_pass',
  'output_schema_pass',
  'artifact_manifest_pass',
  'approval_present',
  'surface_access_pass',
  'reveal_allowed',
  'completion_contract_pass',
])
export type GateType = z.infer<typeof GateTypeSchema>

export const GateDecisionSchema = z.object({
  id: z.string().min(1),
  subject_type: z.enum(['step', 'gate', 'surface']),
  subject_ref: z.string().min(1),
  gate_type: GateTypeSchema,
  status: GateDecisionStatusSchema,
  reason_codes: z.array(z.string()),
  evidence_refs: z.array(z.string()),
  decided_by: z.literal('threados'),
  decided_at: z.string().min(1),
})
export type GateDecision = z.infer<typeof GateDecisionSchema>

// --- Approval sub-schemas ---

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const ApprovalSchema = z.object({
  id: z.string().min(1),
  action_type: z.enum(['run', 'reveal', 'side_effect', 'gate_override']),
  target_ref: z.string().min(1),
  requested_by: z.string().min(1),
  status: ApprovalStatusSchema,
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  notes: z.string().nullable(),
})
export type Approval = z.infer<typeof ApprovalSchema>

// --- TraceEvent sub-schemas ---

export const TraceEventTypeSchema = z.enum([
  'step-started',
  'step-completed',
  'step-failed',
  'gate-evaluated',
  'gate-approved',
  'gate-blocked',
  'approval-requested',
  'approval-resolved',
  'surface-created',
  'surface-revealed',
  'policy-checked',
  'policy-blocked',
  'spawn-child',
  'merge-into',
  'barrier-attested',
])
export type TraceEventType = z.infer<typeof TraceEventTypeSchema>

export const TraceEventSchema = z.object({
  ts: z.string().min(1),
  run_id: z.string().min(1),
  surface_id: z.string().min(1),
  actor: z.string().min(1),
  event_type: TraceEventTypeSchema,
  payload_ref: z.string().nullable(),
  policy_ref: z.string().nullable(),
})
export type TraceEvent = z.infer<typeof TraceEventSchema>

// --- BarrierAttestation sub-schemas ---

export const RevealStateSchema = z.enum(['sealed', 'revealed'])
export type RevealState = z.infer<typeof RevealStateSchema>

export const BarrierAttestationSchema = z.object({
  surface_id: z.string().min(1),
  run_id: z.string().min(1),
  isolation_label: IsolationLabelSchema,
  cross_surface_reads_denied: z.boolean(),
  shared_semantic_projection: z.boolean(),
  reveal_state: RevealStateSchema,
  contamination_events: z.array(z.string()),
})
export type BarrierAttestation = z.infer<typeof BarrierAttestationSchema>
