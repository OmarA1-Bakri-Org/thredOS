import { describe, expect, test } from 'bun:test'
import {
  LegacyRunRecordSchema,
  ProcessRecordSchema,
  ProcessStatusSchema,
  RuntimeCommandReceiptSchema,
  RuntimeCommandReceiptStatusSchema,
  StepAttemptSchema,
  StepAttemptStatusSchema,
  WorkflowRunSchema,
  WorkflowRunStatusSchema,
  projectLegacyRunRecord,
} from './schema'
import {
  RuntimeCommandContextSchema,
  RuntimeCommandSchema,
} from './command-schema'
import { RuntimeErrorCode, RuntimeErrorCodeSchema } from './error-codes'

const timestamp = '2026-07-16T00:00:00.000Z'

const workflowRun = {
  schema_version: 2 as const,
  id: 'run-01',
  revision: 0,
  sequence_id: 'sequence-01',
  sequence_snapshot_hash: 'sha256:sequence',
  target: { kind: 'step' as const, step_id: 'step-01' },
  strategy: 'sequential' as const,
  status: 'running' as const,
  max_concurrency: 1,
  policy_snapshot_hash: 'sha256:policy',
  baseline_snapshot_id: null,
  attempt_ids: ['attempt-01'],
  created_by: 'operator',
  created_via: 'cli' as const,
  created_at: timestamp,
  started_at: timestamp,
  ended_at: null,
  cancellation_requested_at: null,
  summary: null,
  error_code: null,
  error_message: null,
}

const stepAttempt = {
  schema_version: 2 as const,
  id: 'attempt-01',
  revision: 0,
  workflow_run_id: workflowRun.id,
  sequence_id: workflowRun.sequence_id,
  step_id: 'step-01',
  surface_id: 'surface-01',
  execution_index: 1,
  attempt_number: 1,
  retry_of_attempt_id: null,
  status: 'running' as const,
  agent_ref: null,
  model: 'codex',
  side_effect_class: 'write' as const,
  baseline_snapshot_id: null,
  workspace_id: null,
  process_id: 'process-01',
  compiled_prompt_hash: 'sha256:prompt',
  input_manifest_ref: null,
  output_manifest_ref: null,
  artifact_manifest_ref: null,
  change_set_id: null,
  gate_decision_refs: [],
  created_at: timestamp,
  started_at: timestamp,
  ended_at: null,
  last_heartbeat_at: timestamp,
  exit_code: null,
  signal: null,
  duration_ms: null,
  error_code: null,
  error_message: null,
}

describe('canonical runtime schemas', () => {
  test('validate distinct workflow-run and attempt identities', () => {
    expect(WorkflowRunSchema.parse(workflowRun).id).toBe('run-01')
    expect(StepAttemptSchema.parse(stepAttempt).id).toBe('attempt-01')
    expect(stepAttempt.id).not.toBe(workflowRun.id)
    expect(WorkflowRunSchema.safeParse({ ...workflowRun, id: undefined }).success).toBe(false)
    expect(StepAttemptSchema.safeParse({ ...stepAttempt, id: undefined }).success).toBe(false)
  })

  test('accept only canonical workflow-run statuses', () => {
    expect(WorkflowRunStatusSchema.options).toEqual([
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
    expect(WorkflowRunStatusSchema.safeParse('completed').success).toBe(false)
  })

  test('accept only canonical attempt statuses and legacy-nullable workspace links', () => {
    expect(StepAttemptStatusSchema.options).toEqual([
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
    expect(StepAttemptStatusSchema.safeParse('successful').success).toBe(false)
    expect(StepAttemptSchema.parse(stepAttempt)).toMatchObject({
      baseline_snapshot_id: null,
      workspace_id: null,
    })
  })

  test('validates canonical process evidence and rejects noncanonical status', () => {
    const process = ProcessRecordSchema.parse({
      schema_version: 1,
      id: 'process-01',
      revision: 0,
      workflow_run_id: 'run-01',
      attempt_id: 'attempt-01',
      provider: 'local-process',
      provider_handle: 'pid:101',
      pid: 101,
      command: 'codex',
      redacted_args: ['exec', '[REDACTED]'],
      environment_keys: ['PATH', 'THREADOS_ATTEMPT_ID'],
      cwd: 'C:\\workspaces\\surface-01',
      status: 'running',
      launch_requested_at: timestamp,
      started_at: timestamp,
      ended_at: null,
      last_output_at: timestamp,
      last_heartbeat_at: timestamp,
      cancellation_requested_at: null,
      exit_code: null,
      signal: null,
    })
    expect(process.attempt_id).not.toBe(process.workflow_run_id)
    expect(process.environment_keys).toEqual(['PATH', 'THREADOS_ATTEMPT_ID'])
    expect(ProcessStatusSchema.safeParse('successful').success).toBe(false)
  })

  test('reads process records written before environment and heartbeat evidence existed', () => {
    const legacyProcess = ProcessRecordSchema.parse({
      schema_version: 1,
      id: 'process-legacy',
      revision: 0,
      workflow_run_id: 'run-01',
      attempt_id: 'attempt-01',
      provider: 'local-process',
      provider_handle: null,
      pid: null,
      command: 'codex',
      redacted_args: [],
      cwd: 'C:\\workspaces\\surface-01',
      status: 'planned',
      launch_requested_at: timestamp,
      started_at: null,
      ended_at: null,
      last_output_at: null,
      cancellation_requested_at: null,
      exit_code: null,
      signal: null,
    })
    expect(legacyProcess.environment_keys).toBeUndefined()
    expect(legacyProcess.last_heartbeat_at).toBeUndefined()
  })

  test('validates command receipts and rejects noncanonical status', () => {
    expect(RuntimeCommandReceiptSchema.safeParse({
      schema_version: 1,
      id: 'receipt-01',
      idempotency_key: 'idem-01',
      command_type: 'cancel-run',
      request_hash: 'sha256:request',
      status: 'accepted',
      result_ref: null,
      error_code: null,
      error_message: null,
      created_at: timestamp,
      completed_at: null,
    }).success).toBe(true)
    expect(RuntimeCommandReceiptStatusSchema.safeParse('pending').success).toBe(false)
  })
})

describe('legacy run projection', () => {
  const legacyRun = {
    id: 'legacy-run-01',
    sequence_id: 'sequence-01',
    step_id: 'step-01',
    surface_id: 'surface-01',
    attempt: 2,
    status: 'successful' as const,
    executor: 'threados',
    model: 'codex',
    policy_snapshot_hash: 'sha256:policy',
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null,
    artifact_manifest_ref: null,
    started_at: timestamp,
    ended_at: timestamp,
    timing_summary: { duration_ms: 25 },
    cost_summary: null,
  }

  test('parses the existing run.json shape and projects it without mutation', () => {
    const source = LegacyRunRecordSchema.parse(legacyRun)
    const before = structuredClone(source)
    const projection = projectLegacyRunRecord(source)

    expect(source).toEqual(before)
    expect(projection.workflowRun).toMatchObject({
      id: 'legacy-run-01',
      strategy: 'sequential',
      status: 'successful',
      target: { kind: 'step', step_id: 'step-01' },
      baseline_snapshot_id: null,
    })
    expect(projection.stepAttempt).toMatchObject({
      workflow_run_id: 'legacy-run-01',
      status: 'completed',
      baseline_snapshot_id: null,
      workspace_id: null,
    })
    expect(projection.stepAttempt.id).not.toBe(projection.workflowRun.id)
    expect(projection.stepAttempt.exit_code).toBeNull()
    expect(projection.processRecord).toBeNull()
  })
})

describe('runtime commands and errors', () => {
  const context = {
    actor: 'operator',
    interface: 'api' as const,
    idempotencyKey: 'idem-01',
    policyConfirmed: true,
    requestId: 'request-01',
  }

  test('validates the shared command context', () => {
    expect(RuntimeCommandContextSchema.parse(context)).toEqual(context)
  })

  test.each([
    { command_type: 'start-run', context, sequence_id: 'sequence-01', target: { kind: 'runnable' }, strategy: 'sequential', max_concurrency: 1 },
    { command_type: 'cancel-run', context, workflow_run_id: 'run-01' },
    { command_type: 'cancel-attempt', context, attempt_id: 'attempt-01' },
    { command_type: 'retry-attempt', context, attempt_id: 'attempt-01' },
    { command_type: 'retain-workspace', context, workspace_id: 'workspace-01' },
    { command_type: 'clean-workspace', context, workspace_id: 'workspace-01' },
  ])('validates $command_type command', command => {
    expect(RuntimeCommandSchema.safeParse(command).success).toBe(true)
  })

  test('exports every locked runtime error code through a schema', () => {
    expect(Object.values(RuntimeErrorCode)).toEqual([
      'VALIDATION_ERROR',
      'POLICY_DENIED',
      'POLICY_CONFIRMATION_REQUIRED',
      'INVALID_RUNTIME_TRANSITION',
      'PARALLEL_RUNTIME_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT',
      'RUN_NOT_FOUND',
      'RUNTIME_TARGET_NOT_FOUND',
      'ATTEMPT_NOT_FOUND',
      'ATTEMPT_NOT_RUNNING',
      'RUN_ATTEMPT_FAILED',
      'RUN_PARTIALLY_SUCCESSFUL',
      'RUN_REVIEW_REQUIRED',
      'RUN_INTERRUPTED',
      'RUNTIME_EXECUTION_FAILED',
      'PROCESS_CONTROL_FAILED',
      'PROCESS_CONTROL_DISABLED',
      'PROCESS_LOST',
      'SNAPSHOT_REQUIRED',
      'SNAPSHOT_SOURCE_CHANGED',
      'SNAPSHOT_SOURCE_BUSY',
      'WORKSPACE_REQUIRED',
      'WORKSPACE_PROVISION_FAILED',
      'WORKSPACE_MANIFEST_INVALID',
      'WORKSPACE_QUOTA_EXCEEDED',
      'WORKSPACE_NOT_FOUND',
      'WORKSPACE_NOT_CLEANABLE',
      'RUNTIME_REVISION_CONFLICT',
      'MERGE_CONFLICT',
      'MERGE_PRECONDITION_FAILED',
      'AGENT_UNAVAILABLE',
      'INTERNAL_ERROR',
    ])
    expect(RuntimeErrorCodeSchema.safeParse('UNKNOWN_ERROR').success).toBe(false)
  })
})
