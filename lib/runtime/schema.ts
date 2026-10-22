import { z } from 'zod'
import { RunSchema } from '../contracts/schemas'
import { AgentExecutionSnapshotSchema } from '../agents/execution'

export const WorkflowRunStatusSchema = z.enum([
  'pending',
  'provisioning',
  'running',
  'awaiting_review',
  'applying',
  'successful',
  'partially_successful',
  'failed',
  'cancelled',
  'interrupted',
])
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>

export const WorkflowRunTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step'), step_id: z.string().min(1) }),
  z.object({ kind: z.literal('group'), group_id: z.string().min(1) }),
  z.object({ kind: z.literal('runnable') }),
])
export type WorkflowRunTarget = z.infer<typeof WorkflowRunTargetSchema>

export const WorkflowRunStrategySchema = z.enum(['sequential', 'candidate', 'sharded', 'race'])
export type WorkflowRunStrategy = z.infer<typeof WorkflowRunStrategySchema>

export const WorkflowRunSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sequence_id: z.string().min(1),
  sequence_snapshot_hash: z.string().min(1),
  target: WorkflowRunTargetSchema,
  strategy: WorkflowRunStrategySchema,
  status: WorkflowRunStatusSchema,
  max_concurrency: z.number().int().positive(),
  policy_snapshot_hash: z.string().min(1),
  baseline_snapshot_id: z.string().nullable(),
  attempt_ids: z.array(z.string()),
  agent_registrations: z.record(z.string(), AgentExecutionSnapshotSchema).optional(),
  created_by: z.string().min(1),
  created_via: z.enum(['api', 'cli', 'chat', 'mcp', 'system']),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  cancellation_requested_at: z.string().datetime().nullable(),
  summary: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>

export const StepAttemptStatusSchema = z.enum([
  'pending',
  'provisioning',
  'running',
  'completed',
  'needs_review',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
])
export type StepAttemptStatus = z.infer<typeof StepAttemptStatusSchema>

export const StepAttemptSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  sequence_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  execution_index: z.number().int().positive(),
  attempt_number: z.number().int().positive(),
  retry_of_attempt_id: z.string().nullable(),
  status: StepAttemptStatusSchema,
  agent_ref: z.string().nullable(),
  agent_registration: AgentExecutionSnapshotSchema.optional(),
  model: z.string().min(1),
  side_effect_class: z.enum(['none', 'read', 'write', 'execute']),
  baseline_snapshot_id: z.string().nullable(),
  workspace_id: z.string().nullable(),
  process_id: z.string().nullable(),
  compiled_prompt_hash: z.string().min(1),
  input_manifest_ref: z.string().nullable(),
  output_manifest_ref: z.string().nullable(),
  artifact_manifest_ref: z.string().nullable(),
  change_set_id: z.string().nullable(),
  gate_decision_refs: z.array(z.string()),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  last_heartbeat_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
export type StepAttempt = z.infer<typeof StepAttemptSchema>

export const ProcessStatusSchema = z.enum([
  'planned',
  'starting',
  'running',
  'terminating',
  'exited',
  'lost',
])
export type ProcessStatus = z.infer<typeof ProcessStatusSchema>

export const ProcessRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  workspace_id: z.string().min(1).nullable().optional(),
  process_purpose: z.enum(['bootstrap', 'agent']).optional(),
  process_ordinal: z.number().int().nonnegative().optional(),
  provider: z.enum(['local-process', 'mprocs-legacy']),
  provider_handle: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  command: z.string().min(1),
  redacted_args: z.array(z.string()),
  environment_keys: z.array(z.string()).optional(),
  cwd: z.string().min(1),
  status: ProcessStatusSchema,
  launch_requested_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  last_output_at: z.string().datetime().nullable(),
  last_heartbeat_at: z.string().datetime().nullable().optional(),
  cancellation_requested_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
})
export type ProcessRecord = z.infer<typeof ProcessRecordSchema>

export const RuntimeCommandTypeSchema = z.enum([
  'start-run',
  'cancel-run',
  'cancel-attempt',
  'retry-attempt',
  'retain-workspace',
  'clean-workspace',
])
export type RuntimeCommandType = z.infer<typeof RuntimeCommandTypeSchema>

export const RuntimeCommandReceiptStatusSchema = z.enum(['accepted', 'completed', 'failed'])
export type RuntimeCommandReceiptStatus = z.infer<typeof RuntimeCommandReceiptStatusSchema>

export const RuntimeCommandReceiptSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  idempotency_key: z.string().min(1),
  command_type: RuntimeCommandTypeSchema,
  request_hash: z.string().min(1),
  status: RuntimeCommandReceiptStatusSchema,
  result_ref: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
})
export type RuntimeCommandReceipt = z.infer<typeof RuntimeCommandReceiptSchema>

export const LegacyRunRecordSchema = RunSchema
export type LegacyRunRecord = z.infer<typeof LegacyRunRecordSchema>

const legacyWorkflowStatus: Record<LegacyRunRecord['status'], WorkflowRunStatus> = {
  pending: 'pending',
  running: 'running',
  successful: 'successful',
  failed: 'failed',
  cancelled: 'cancelled',
}

const legacyAttemptStatus: Record<LegacyRunRecord['status'], StepAttemptStatus> = {
  pending: 'pending',
  running: 'running',
  successful: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
}

export interface LegacyRunProjection {
  workflowRun: WorkflowRun
  stepAttempt: StepAttempt
  processRecord: null
}

export function projectLegacyRunRecord(record: LegacyRunRecord): LegacyRunProjection {
  const attemptId = `${record.id}:attempt:${record.attempt}`
  const workflowRun = WorkflowRunSchema.parse({
    schema_version: 2,
    id: record.id,
    revision: 0,
    sequence_id: record.sequence_id,
    sequence_snapshot_hash: `legacy:${record.sequence_id}`,
    target: { kind: 'step', step_id: record.step_id },
    strategy: 'sequential',
    status: legacyWorkflowStatus[record.status],
    max_concurrency: 1,
    policy_snapshot_hash: record.policy_snapshot_hash,
    baseline_snapshot_id: null,
    attempt_ids: [attemptId],
    created_by: record.executor,
    created_via: 'system',
    created_at: record.started_at,
    started_at: record.started_at,
    ended_at: record.ended_at,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
  })
  const stepAttempt = StepAttemptSchema.parse({
    schema_version: 2,
    id: attemptId,
    revision: 0,
    workflow_run_id: workflowRun.id,
    sequence_id: record.sequence_id,
    step_id: record.step_id,
    surface_id: record.surface_id,
    execution_index: record.attempt,
    attempt_number: record.attempt,
    retry_of_attempt_id: null,
    status: legacyAttemptStatus[record.status],
    agent_ref: null,
    model: record.model,
    side_effect_class: 'execute',
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: null,
    compiled_prompt_hash: record.compiled_prompt_hash,
    input_manifest_ref: record.input_manifest_ref,
    output_manifest_ref: null,
    artifact_manifest_ref: record.artifact_manifest_ref,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: record.started_at,
    started_at: record.started_at,
    ended_at: record.ended_at,
    last_heartbeat_at: null,
    exit_code: null,
    signal: null,
    duration_ms: record.timing_summary?.duration_ms ?? null,
    error_code: null,
    error_message: null,
  })

  return { workflowRun, stepAttempt, processRecord: null }
}
