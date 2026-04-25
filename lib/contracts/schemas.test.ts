import { describe, it, expect } from 'bun:test'
import {
  SurfaceSchema,
  RunSchema,
  GateDecisionSchema,
  ApprovalSchema,
  TraceEventSchema,
  BarrierAttestationSchema,
} from './schemas'
import { GateReasonCode } from './reason-codes'

describe('SurfaceSchema', () => {
  const sharedSurfaceBase = {
    id: 'surface-001',
    name: 'Main Surface',
    parent_surface_id: null,
    workspace_root: '/workspace',
    artifact_root: '/artifacts',
    visibility: 'public' as const,
    allowed_read_scopes: ['all'],
    allowed_write_scopes: ['owner'],
    reveal_policy: 'none' as const,
    metadata_budget: null,
    isolation_label: 'NONE' as const,
    status: 'active' as const,
  }

  it('validates a shared surface', () => {
    const result = SurfaceSchema.safeParse({
      ...sharedSurfaceBase,
      surface_class: 'shared',
    })
    expect(result.success).toBe(true)
  })

  it('validates a sealed surface', () => {
    const result = SurfaceSchema.safeParse({
      ...sharedSurfaceBase,
      surface_class: 'sealed',
      visibility: 'self_only',
      reveal_policy: 'explicit',
      isolation_label: 'HOST_ENFORCED',
      status: 'sealed',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid surface_class', () => {
    const result = SurfaceSchema.safeParse({
      ...sharedSurfaceBase,
      surface_class: 'unknown-class',
    })
    expect(result.success).toBe(false)
  })

  it('validates a surface with a metadata_budget', () => {
    const result = SurfaceSchema.safeParse({
      ...sharedSurfaceBase,
      surface_class: 'private',
      metadata_budget: { max_file_count: 100, max_total_bytes: 1048576 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata_budget?.max_file_count).toBe(100)
    }
  })
})

describe('RunSchema', () => {
  it('validates a completed run', () => {
    const result = RunSchema.safeParse({
      id: 'run-abc123',
      sequence_id: 'seq-001',
      step_id: 'step-build',
      surface_id: 'surface-001',
      attempt: 1,
      status: 'successful',
      executor: 'claude-code',
      model: 'claude-sonnet-4-20250514',
      policy_snapshot_hash: 'sha256:aabbcc',
      compiled_prompt_hash: 'sha256:ddeeff',
      input_manifest_ref: 'manifests/input-001.json',
      artifact_manifest_ref: 'manifests/artifact-001.json',
      started_at: '2026-03-28T10:00:00Z',
      ended_at: '2026-03-28T10:05:00Z',
      timing_summary: { duration_ms: 300000 },
      cost_summary: { input_tokens: 1000, output_tokens: 500, total_cost_usd: 0.05 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('successful')
      expect(result.data.attempt).toBe(1)
    }
  })

  it('rejects a run with attempt = 0 (not positive)', () => {
    const result = RunSchema.safeParse({
      id: 'run-001',
      sequence_id: 'seq-001',
      step_id: 'step-build',
      surface_id: 'surface-001',
      attempt: 0,
      status: 'pending',
      executor: 'claude-code',
      model: 'gpt-4o',
      policy_snapshot_hash: 'sha256:aabb',
      compiled_prompt_hash: 'sha256:ccdd',
      input_manifest_ref: null,
      artifact_manifest_ref: null,
      started_at: '2026-03-28T10:00:00Z',
      ended_at: null,
      timing_summary: null,
      cost_summary: null,
    })
    expect(result.success).toBe(false)
  })
})

describe('GateDecisionSchema', () => {
  it('validates a PASS decision', () => {
    const result = GateDecisionSchema.safeParse({
      id: 'gate-decision-001',
      subject_type: 'step',
      subject_ref: 'step-build',
      gate_type: 'deps_satisfied',
      status: 'PASS',
      reason_codes: [],
      evidence_refs: ['evidence/deps-check.json'],
      decided_by: 'threados',
      decided_at: '2026-03-28T10:00:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('PASS')
      expect(result.data.decided_by).toBe('threados')
    }
  })

  it('validates a BLOCK decision with reason codes', () => {
    const result = GateDecisionSchema.safeParse({
      id: 'gate-decision-002',
      subject_type: 'gate',
      subject_ref: 'gate-review',
      gate_type: 'policy_pass',
      status: 'BLOCK',
      reason_codes: [GateReasonCode.POLICY_BLOCKED, GateReasonCode.APPROVAL_MISSING],
      evidence_refs: [],
      decided_by: 'threados',
      decided_at: '2026-03-28T10:01:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('BLOCK')
      expect(result.data.reason_codes).toContain('POLICY_BLOCKED')
    }
  })

  it('rejects a decision with invalid decided_by', () => {
    const result = GateDecisionSchema.safeParse({
      id: 'gate-decision-003',
      subject_type: 'step',
      subject_ref: 'step-test',
      gate_type: 'deps_satisfied',
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [],
      decided_by: 'human',
      decided_at: '2026-03-28T10:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('ApprovalSchema', () => {
  it('validates a pending Approval', () => {
    const result = ApprovalSchema.safeParse({
      id: 'approval-001',
      action_type: 'run',
      target_ref: 'step-deploy',
      requested_by: 'system',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('pending')
      expect(result.data.approved_by).toBeNull()
    }
  })

  it('validates an approved Approval', () => {
    const result = ApprovalSchema.safeParse({
      id: 'approval-002',
      action_type: 'reveal',
      target_ref: 'surface-001',
      requested_by: 'orchestrator',
      status: 'approved',
      approved_by: 'reviewer',
      approved_at: '2026-03-10T10:00:00Z',
      notes: 'Looks safe',
    })

    expect(result.success).toBe(true)
  })

  it('validates a plan revision Approval', () => {
    const result = ApprovalSchema.safeParse({
      id: 'approval-003',
      action_type: 'plan_revision',
      target_ref: 'plan_revision:seq-1:none:broaden-discovery:rev-001',
      requested_by: 'orchestrator',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: 'Revise strategy',
    })

    expect(result.success).toBe(true)
  })
})

describe('TraceEventSchema', () => {
  it('validates a step-started TraceEvent', () => {
    const result = TraceEventSchema.safeParse({
      ts: '2026-03-28T10:00:00Z',
      run_id: 'run-abc123',
      surface_id: 'surface-001',
      actor: 'threados',
      event_type: 'step-started',
      payload_ref: null,
      policy_ref: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.event_type).toBe('step-started')
    }
  })

  it('validates a barrier-attested TraceEvent with refs', () => {
    const result = TraceEventSchema.safeParse({
      ts: '2026-03-28T10:10:00Z',
      run_id: 'run-abc123',
      surface_id: 'surface-001',
      actor: 'threados',
      event_type: 'barrier-attested',
      payload_ref: 'payloads/barrier-001.json',
      policy_ref: 'policies/current.json',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a TraceEvent with an invalid event_type', () => {
    const result = TraceEventSchema.safeParse({
      ts: '2026-03-28T10:00:00Z',
      run_id: 'run-abc123',
      surface_id: 'surface-001',
      actor: 'threados',
      event_type: 'unknown-event',
      payload_ref: null,
      policy_ref: null,
    })
    expect(result.success).toBe(false)
  })
})

describe('BarrierAttestationSchema', () => {
  it('validates a clean BarrierAttestation', () => {
    const result = BarrierAttestationSchema.safeParse({
      surface_id: 'surface-001',
      run_id: 'run-abc123',
      isolation_label: 'THREADOS_SCOPED',
      cross_surface_reads_denied: true,
      shared_semantic_projection: false,
      reveal_state: 'sealed',
      contamination_events: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cross_surface_reads_denied).toBe(true)
      expect(result.data.contamination_events).toHaveLength(0)
    }
  })

  it('validates a BarrierAttestation with contamination events', () => {
    const result = BarrierAttestationSchema.safeParse({
      surface_id: 'surface-002',
      run_id: 'run-xyz789',
      isolation_label: 'HOST_ENFORCED',
      cross_surface_reads_denied: false,
      shared_semantic_projection: true,
      reveal_state: 'revealed',
      contamination_events: ['event-001', 'event-002'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.contamination_events).toHaveLength(2)
    }
  })
})

describe('GateReasonCode', () => {
  it('has DEP_MISSING', () => {
    expect(GateReasonCode.DEP_MISSING).toBe('DEP_MISSING')
  })

  it('has SCHEMA_INVALID', () => {
    expect(GateReasonCode.SCHEMA_INVALID).toBe('SCHEMA_INVALID')
  })

  it('has POLICY_BLOCKED', () => {
    expect(GateReasonCode.POLICY_BLOCKED).toBe('POLICY_BLOCKED')
  })

  it('has REVEAL_LOCKED', () => {
    expect(GateReasonCode.REVEAL_LOCKED).toBe('REVEAL_LOCKED')
  })

  it('covers all ten reason codes', () => {
    const codes = Object.keys(GateReasonCode)
    expect(codes).toHaveLength(10)
  })
})
