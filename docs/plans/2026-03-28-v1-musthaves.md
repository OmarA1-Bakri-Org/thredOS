# thredOS V.1 Must-Haves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six V.1 capabilities from musthaves.md — contracts, surface-scoped execution, deterministic gates, barriers, pack compiler, and export bundle — turning thredOS from an agentic workbench into a credible runtime substrate.

**Architecture:** Extend the existing `lib/` module structure with six new modules (`contracts/`, `gates/`, `barriers/`, `traces/`, `approvals/`, `exports/`) while upgrading existing modules (`thread-surfaces/`, `policy/`, `packs/`). All new state persists under `.threados/` using the existing patterns: Zod schemas, `writeFileAtomic`, NDJSON for append-only logs, JSON for state files. Five new API routes. Five new UI tabs/drawers.

**Tech Stack:** TypeScript, Zod, Next.js App Router, Zustand, React Query, Bun test runner

**Source of truth:** [musthaves.md](../../musthaves.md)

---

## Gap Analysis

What exists vs what musthaves.md requires:

| Subsystem | Exists | Status | Key Gaps |
|-----------|--------|--------|----------|
| **Sequence schema** | `lib/sequence/schema.ts` — Zod schemas for Step, Gate, Sequence | Partial | Missing `pack_id`, `pack_version`, `default_policy_ref`, `created_at`, `updated_at` on Sequence. Missing `phase`, `surface_ref`, `input_contract_ref`, `output_contract_ref`, `gate_set_ref`, `completion_contract`, `side_effect_class` on Step. |
| **Surface model** | `lib/thread-surfaces/types.ts` — TypeScript interface only | Partial | Missing `surface_class`, `visibility`, `allowed_read_scopes`, `allowed_write_scopes`, `reveal_policy`, `metadata_budget`, `isolation_label`. No Zod schema. |
| **Gate engine** | `app/api/gate/route.ts` — status-based (PENDING→APPROVED/BLOCKED) | Minimal | No reason codes, no deterministic decision engine, no `GateDecision` entity. |
| **Policy** | `lib/policy/schema.ts` — mode, allowlist, cwd, fanout, concurrent, forbidden | Basic | Missing `side_effect_mode`, `network_mode`, `allowed_domains`, `surface_default_visibility`, `cross_surface_reads`, `sealed_surface_projection`, `export_mode`. |
| **Barriers** | None | None | No surface classes, no access resolver, no barrier attestation, no reveal mechanism. |
| **Traces** | `lib/audit/logger.ts` + `lib/thread-surfaces/runtime-event-log.ts` | Partial | No formal `TraceEvent` schema. No unified trace NDJSON per run. No trace API. |
| **Approvals** | Gate-level approval only | Minimal | No `Approval` entity. No approval repository. No API. |
| **Packs** | `lib/packs/` — status tracking only (challenger/champion/hero) | Minimal | No loader, no compiler, no resolver. |
| **Export** | None | None | No run-bundle export. No export API. No `.threados/exports/` structure. |
| **UI** | Workbench, canvas, hierarchy, lanes, inspector | Exists | Missing Surface tab, Gate decisions tab, Trace tab, Approvals drawer, Export action. |
| **API routes** | 21+ routes covering sequence/step/gate/run/surfaces/agents/chat | Exists | Missing `/api/approvals`, `/api/exports/run-bundle`, `/api/surfaces/access`, `/api/surfaces/reveal`, `/api/traces`. |

---

## File Structure

### New files to create

```text
lib/contracts/
  schemas.ts                    # All V.1 Zod schemas: Surface, Run, GateDecision, Approval, TraceEvent, BarrierAttestation
  reason-codes.ts               # Gate reason code enum + helpers

lib/gates/
  engine.ts                     # Deterministic gate engine — evaluates rules, emits GateDecision
  rules.ts                      # Individual gate rule implementations (9 rule types)

lib/barriers/
  access-resolver.ts            # Resolves read/write access for a surface given policy + class
  barrier-attestation.ts        # Creates + persists BarrierAttestation on reveal
  reveal.ts                     # Reveal state machine: sealed → revealed

lib/traces/
  schema.ts                     # TraceEvent Zod schema (re-exported from contracts for convenience)
  writer.ts                     # Append TraceEvent to .threados/runs/<runId>/trace.ndjson
  reader.ts                     # Read + parse trace NDJSON

lib/approvals/
  repository.ts                 # Read/write .threados/runs/<runId>/approvals.ndjson
  engine.ts                     # Request + resolve approval workflow

lib/exports/
  bundler.ts                    # Assemble run-bundle JSON from run artifacts
  schema.ts                     # ExportBundle Zod schema

lib/packs/
  loader.ts                     # Load pack.yaml + validate
  compiler.ts                   # Compile pack into sequence.yaml + surfaces + gates
  pack-schema.ts                # Pack manifest Zod schema

app/api/approvals/route.ts      # GET (list), POST (request/resolve)
app/api/exports/run-bundle/route.ts  # POST (generate bundle)
app/api/surfaces/access/route.ts     # GET (resolve access for surface)
app/api/surfaces/reveal/route.ts     # POST (trigger reveal)
app/api/traces/route.ts              # GET (read trace events)
```

### Existing files to modify

```text
lib/sequence/schema.ts          # Extend SequenceSchema + StepSchema with V.1 fields
lib/thread-surfaces/types.ts    # Add surface_class, visibility, isolation_label, reveal fields
lib/thread-surfaces/repository.ts  # Persist new surface fields
lib/thread-surfaces/mutations.ts   # Surface creation respects class defaults
lib/policy/schema.ts            # Add V.1 policy extension fields
lib/policy/engine.ts            # Enforce surface visibility + cross-surface reads
lib/runner/artifacts.ts         # Write trace.ndjson alongside stdout/stderr
lib/runner/wrapper.ts           # Emit TraceEvents during step execution
lib/packs/types.ts              # Keep existing PackType but add PackManifest
app/api/gate/route.ts           # Integrate deterministic gate engine
app/api/thread-surfaces/route.ts  # Return new surface fields
lib/ui/api.ts                   # Add hooks: useTraces, useApprovals, useExportBundle, useSurfaceAccess, useRevealSurface
lib/ui/store.ts                 # Add activeInspectorTab state
components/workbench/AccordionPanel.tsx  # Add Surface, Gate decisions, Trace tabs
```

---

## Milestone 1 — Contracts & Filesystem

### Task 1.1: V.1 Domain Schemas

**Files:**
- Create: `lib/contracts/schemas.ts`
- Create: `lib/contracts/reason-codes.ts`
- Test: `lib/contracts/schemas.test.ts`

- [ ] **Step 1: Write failing tests for all V.1 schemas**

```typescript
// lib/contracts/schemas.test.ts
import { describe, expect, test } from 'bun:test'
import {
  SurfaceSchema,
  RunSchema,
  GateDecisionSchema,
  ApprovalSchema,
  TraceEventSchema,
  BarrierAttestationSchema,
} from './schemas'
import { GateReasonCode, GateDecisionStatus } from './reason-codes'

describe('SurfaceSchema', () => {
  test('validates a shared surface', () => {
    const result = SurfaceSchema.safeParse({
      id: 'thread-orch-worker-1',
      name: 'orch worker 1',
      surface_class: 'shared',
      parent_surface_id: 'thread-root',
      workspace_root: '.threados/surfaces/thread-orch-worker-1',
      artifact_root: '.threados/surfaces/thread-orch-worker-1/artifacts',
      visibility: 'dependency',
      allowed_read_scopes: ['thread-root'],
      allowed_write_scopes: [],
      reveal_policy: 'none',
      metadata_budget: null,
      isolation_label: 'NONE',
      status: 'active',
    })
    expect(result.success).toBe(true)
  })

  test('validates a sealed surface', () => {
    const result = SurfaceSchema.safeParse({
      id: 'thread-sealed-track-1',
      name: 'sealed track 1',
      surface_class: 'sealed',
      parent_surface_id: 'thread-root',
      workspace_root: '.threados/surfaces/thread-sealed-track-1',
      artifact_root: '.threados/surfaces/thread-sealed-track-1/artifacts',
      visibility: 'self_only',
      allowed_read_scopes: [],
      allowed_write_scopes: [],
      reveal_policy: 'explicit',
      metadata_budget: { max_file_count: 10, max_total_bytes: 102400 },
      isolation_label: 'THREADOS_SCOPED',
      status: 'active',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid surface_class', () => {
    const result = SurfaceSchema.safeParse({
      id: 'test',
      name: 'test',
      surface_class: 'invalid',
      parent_surface_id: null,
      workspace_root: '.',
      artifact_root: '.',
      visibility: 'dependency',
      allowed_read_scopes: [],
      allowed_write_scopes: [],
      reveal_policy: 'none',
      metadata_budget: null,
      isolation_label: 'NONE',
      status: 'active',
    })
    expect(result.success).toBe(false)
  })
})

describe('RunSchema', () => {
  test('validates a completed run', () => {
    const result = RunSchema.safeParse({
      id: 'run-001',
      sequence_id: 'seq-001',
      step_id: 'orch-worker-1',
      surface_id: 'thread-orch-worker-1',
      attempt: 1,
      status: 'successful',
      executor: 'claude-code',
      model: 'claude-code',
      policy_snapshot_hash: 'abc123',
      compiled_prompt_hash: 'def456',
      input_manifest_ref: null,
      artifact_manifest_ref: null,
      started_at: '2026-03-28T00:00:00Z',
      ended_at: '2026-03-28T00:05:00Z',
      timing_summary: { duration_ms: 300000 },
      cost_summary: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('GateDecisionSchema', () => {
  test('validates a PASS decision with reason codes', () => {
    const result = GateDecisionSchema.safeParse({
      id: 'gd-001',
      subject_type: 'step',
      subject_ref: 'orch-worker-1',
      gate_type: 'deps_satisfied',
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [],
      decided_by: 'threados',
      decided_at: '2026-03-28T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  test('validates a BLOCK decision with reason codes', () => {
    const result = GateDecisionSchema.safeParse({
      id: 'gd-002',
      subject_type: 'step',
      subject_ref: 'orch-worker-2',
      gate_type: 'deps_satisfied',
      status: 'BLOCK',
      reason_codes: ['DEP_MISSING'],
      evidence_refs: ['step:orch-worker-1:status=READY'],
      decided_by: 'threados',
      decided_at: '2026-03-28T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })
})

describe('ApprovalSchema', () => {
  test('validates a pending approval', () => {
    const result = ApprovalSchema.safeParse({
      id: 'apr-001',
      action_type: 'reveal',
      target_ref: 'thread-sealed-track-1',
      requested_by: 'threados',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('TraceEventSchema', () => {
  test('validates a step-started trace event', () => {
    const result = TraceEventSchema.safeParse({
      ts: '2026-03-28T00:00:00Z',
      run_id: 'run-001',
      surface_id: 'thread-orch-worker-1',
      actor: 'threados',
      event_type: 'step-started',
      payload_ref: null,
      policy_ref: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('BarrierAttestationSchema', () => {
  test('validates a clean attestation', () => {
    const result = BarrierAttestationSchema.safeParse({
      surface_id: 'thread-sealed-track-1',
      run_id: 'run-001',
      isolation_label: 'THREADOS_SCOPED',
      cross_surface_reads_denied: true,
      shared_semantic_projection: false,
      reveal_state: 'sealed',
      contamination_events: [],
    })
    expect(result.success).toBe(true)
  })
})

describe('GateReasonCode', () => {
  test('has all required codes', () => {
    expect(GateReasonCode.DEP_MISSING).toBe('DEP_MISSING')
    expect(GateReasonCode.SCHEMA_INVALID).toBe('SCHEMA_INVALID')
    expect(GateReasonCode.POLICY_BLOCKED).toBe('POLICY_BLOCKED')
    expect(GateReasonCode.REVEAL_LOCKED).toBe('REVEAL_LOCKED')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/contracts/schemas.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement reason-codes.ts**

```typescript
// lib/contracts/reason-codes.ts

export const GateReasonCode = {
  DEP_MISSING: 'DEP_MISSING',
  DEP_FAILED: 'DEP_FAILED',
  INPUT_MISSING: 'INPUT_MISSING',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  APPROVAL_MISSING: 'APPROVAL_MISSING',
  ACCESS_DENIED: 'ACCESS_DENIED',
  REVEAL_LOCKED: 'REVEAL_LOCKED',
  CONTRACT_INCOMPLETE: 'CONTRACT_INCOMPLETE',
} as const

export type GateReasonCode = typeof GateReasonCode[keyof typeof GateReasonCode]

export const GateDecisionStatus = {
  PASS: 'PASS',
  BLOCK: 'BLOCK',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
} as const

export type GateDecisionStatus = typeof GateDecisionStatus[keyof typeof GateDecisionStatus]
```

- [ ] **Step 4: Implement schemas.ts**

```typescript
// lib/contracts/schemas.ts
import { z } from 'zod'

// ── Surface ─────────────────────────────────────────────────────────

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
}).nullable()

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
  metadata_budget: MetadataBudgetSchema,
  isolation_label: IsolationLabelSchema,
  status: SurfaceStatusSchema,
})
export type Surface = z.infer<typeof SurfaceSchema>

// ── Run ─────────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum(['pending', 'running', 'successful', 'failed', 'cancelled'])

export const TimingSummarySchema = z.object({
  duration_ms: z.number().nonnegative(),
}).nullable()

export const CostSummarySchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
}).nullable()

export const RunSchema = z.object({
  id: z.string().min(1),
  sequence_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  attempt: z.number().int().positive(),
  status: RunStatusSchema,
  executor: z.string().min(1),
  model: z.string().min(1),
  policy_snapshot_hash: z.string(),
  compiled_prompt_hash: z.string(),
  input_manifest_ref: z.string().nullable(),
  artifact_manifest_ref: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  timing_summary: TimingSummarySchema,
  cost_summary: CostSummarySchema,
})
export type Run = z.infer<typeof RunSchema>

// ── GateDecision ────────────────────────────────────────────────────

export const GateDecisionStatusSchema = z.enum(['PASS', 'BLOCK', 'NEEDS_APPROVAL'])
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

export const GateDecisionSchema = z.object({
  id: z.string().min(1),
  subject_type: z.enum(['step', 'gate', 'surface']),
  subject_ref: z.string().min(1),
  gate_type: GateTypeSchema,
  status: GateDecisionStatusSchema,
  reason_codes: z.array(z.string()),
  evidence_refs: z.array(z.string()),
  decided_by: z.literal('threados'),
  decided_at: z.string(),
})
export type GateDecision = z.infer<typeof GateDecisionSchema>

// ── Approval ────────────────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])

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

// ── TraceEvent ──────────────────────────────────────────────────────

export const TraceEventTypeSchema = z.enum([
  'step-started', 'step-completed', 'step-failed',
  'gate-evaluated', 'gate-approved', 'gate-blocked',
  'approval-requested', 'approval-resolved',
  'surface-created', 'surface-revealed',
  'policy-checked', 'policy-blocked',
  'spawn-child', 'merge-into',
  'barrier-attested',
])

export const TraceEventSchema = z.object({
  ts: z.string(),
  run_id: z.string(),
  surface_id: z.string(),
  actor: z.string(),
  event_type: TraceEventTypeSchema,
  payload_ref: z.string().nullable(),
  policy_ref: z.string().nullable(),
})
export type TraceEvent = z.infer<typeof TraceEventSchema>

// ── BarrierAttestation ──────────────────────────────────────────────

export const RevealStateSchema = z.enum(['sealed', 'revealed'])

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/contracts/schemas.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/contracts/schemas.ts lib/contracts/reason-codes.ts lib/contracts/schemas.test.ts
git commit -m "feat: add V.1 domain contracts — Surface, Run, GateDecision, Approval, TraceEvent, BarrierAttestation"
```

---

### Task 1.2: Extend Sequence Schema with V.1 Fields

**Files:**
- Modify: `lib/sequence/schema.ts`
- Modify: `lib/sequence/parser.ts` (if needed for defaults)
- Test: `lib/sequence/schema.test.ts` (create if missing)

- [ ] **Step 1: Write failing test for new Sequence fields**

```typescript
// lib/sequence/schema-v1.test.ts
import { describe, expect, test } from 'bun:test'
import { SequenceSchema, StepSchema } from './schema'

describe('V.1 Sequence extensions', () => {
  test('accepts pack_id and pack_version', () => {
    const result = SequenceSchema.safeParse({
      version: '1.0',
      name: 'test',
      pack_id: 'saas-factory',
      pack_version: '1.0.0',
      steps: [],
      gates: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_id).toBe('saas-factory')
    }
  })

  test('pack_id defaults to null', () => {
    const result = SequenceSchema.safeParse({
      version: '1.0',
      name: 'test',
      steps: [],
      gates: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_id).toBeNull()
    }
  })
})

describe('V.1 Step extensions', () => {
  test('accepts phase and surface_ref', () => {
    const result = StepSchema.safeParse({
      id: 'step-1',
      name: 'step one',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/step-1.md',
      phase: 'build',
      surface_ref: 'thread-step-1',
    })
    expect(result.success).toBe(true)
  })

  test('accepts side_effect_class', () => {
    const result = StepSchema.safeParse({
      id: 'step-1',
      name: 'step one',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/step-1.md',
      side_effect_class: 'write',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/sequence/schema-v1.test.ts`
Expected: FAIL — `pack_id` not recognized

- [ ] **Step 3: Add V.1 fields to SequenceSchema and StepSchema**

In `lib/sequence/schema.ts`, add to `StepSchema`:
```typescript
  // V.1 extensions
  phase: z.string().optional(),
  surface_ref: z.string().optional(),
  input_contract_ref: z.string().optional(),
  output_contract_ref: z.string().optional(),
  gate_set_ref: z.string().optional(),
  completion_contract: z.string().optional(),
  side_effect_class: z.enum(['none', 'read', 'write', 'execute']).optional(),
```

In `lib/sequence/schema.ts`, add to `SequenceSchema`:
```typescript
  pack_id: z.string().nullable().default(null),
  pack_version: z.string().nullable().default(null),
  default_policy_ref: z.string().nullable().default(null),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/sequence/schema-v1.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run existing sequence tests to check no regressions**

Run: `bun test lib/sequence/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/sequence/schema.ts lib/sequence/schema-v1.test.ts
git commit -m "feat: extend Sequence and Step schemas with V.1 fields (pack_id, phase, surface_ref, side_effect_class)"
```

---

### Task 1.3: Extend Policy Schema with V.1 Fields

**Files:**
- Modify: `lib/policy/schema.ts`
- Modify: `lib/policy/engine.ts`
- Test: `lib/policy/policy-v1.test.ts`

- [ ] **Step 1: Write failing test for new policy fields**

```typescript
// lib/policy/policy-v1.test.ts
import { describe, expect, test } from 'bun:test'
import { PolicyConfigSchema } from './schema'

describe('V.1 Policy extensions', () => {
  test('accepts side_effect_mode', () => {
    const result = PolicyConfigSchema.safeParse({
      mode: 'SAFE',
      side_effect_mode: 'approved_only',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.side_effect_mode).toBe('approved_only')
    }
  })

  test('defaults new fields', () => {
    const result = PolicyConfigSchema.safeParse({ mode: 'SAFE' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.side_effect_mode).toBe('manual_only')
      expect(result.data.network_mode).toBe('off')
      expect(result.data.cross_surface_reads).toBe('dependency_only')
      expect(result.data.sealed_surface_projection).toBe('manifest_only')
      expect(result.data.export_mode).toBe('local_bundle')
    }
  })

  test('accepts allowed_domains', () => {
    const result = PolicyConfigSchema.safeParse({
      mode: 'POWER',
      network_mode: 'allowlist',
      allowed_domains: ['api.example.com'],
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/policy/policy-v1.test.ts`
Expected: FAIL — `side_effect_mode` not recognized

- [ ] **Step 3: Add V.1 fields to PolicyConfigSchema**

In `lib/policy/schema.ts`, add to `PolicyConfigSchema`:
```typescript
  // V.1 extensions
  side_effect_mode: z.enum(['manual_only', 'approved_only', 'free']).default('manual_only'),
  network_mode: z.enum(['off', 'allowlist', 'open']).default('off'),
  allowed_domains: z.array(z.string()).default([]),
  surface_default_visibility: z.enum(['public', 'dependency', 'self_only']).default('dependency'),
  cross_surface_reads: z.enum(['deny', 'dependency_only']).default('dependency_only'),
  sealed_surface_projection: z.enum(['manifest_only', 'full']).default('manifest_only'),
  export_mode: z.enum(['off', 'local_bundle']).default('local_bundle'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/policy/policy-v1.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run existing policy tests**

Run: `bun test lib/policy/`
Expected: ALL PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add lib/policy/schema.ts lib/policy/policy-v1.test.ts
git commit -m "feat: extend PolicyConfig with V.1 fields (side_effect_mode, network_mode, cross_surface_reads, sealed_surface_projection)"
```

---

### Task 1.4: Extend ThreadSurface with V.1 Fields

**Files:**
- Modify: `lib/thread-surfaces/types.ts`
- Modify: `lib/thread-surfaces/repository.ts`
- Modify: `lib/thread-surfaces/mutations.ts`
- Test: `lib/thread-surfaces/surface-v1.test.ts`

- [ ] **Step 1: Write failing test for new ThreadSurface fields**

```typescript
// lib/thread-surfaces/surface-v1.test.ts
import { describe, expect, test } from 'bun:test'
import type { ThreadSurface } from './types'

describe('V.1 ThreadSurface fields', () => {
  test('surface has surface_class field', () => {
    const surface: ThreadSurface = {
      id: 'thread-test',
      parentSurfaceId: null,
      parentAgentNodeId: null,
      depth: 0,
      surfaceLabel: 'test',
      role: 'worker',
      createdAt: new Date().toISOString(),
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'shared',
      visibility: 'dependency',
      isolationLabel: 'NONE',
      revealState: null,
      allowedReadScopes: [],
      allowedWriteScopes: [],
    }
    expect(surface.surfaceClass).toBe('shared')
    expect(surface.visibility).toBe('dependency')
    expect(surface.isolationLabel).toBe('NONE')
  })

  test('sealed surface has revealState', () => {
    const surface: ThreadSurface = {
      id: 'thread-sealed',
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: null,
      depth: 1,
      surfaceLabel: 'sealed track',
      role: 'worker',
      createdAt: new Date().toISOString(),
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'sealed',
      visibility: 'self_only',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'sealed',
      allowedReadScopes: [],
      allowedWriteScopes: [],
    }
    expect(surface.surfaceClass).toBe('sealed')
    expect(surface.revealState).toBe('sealed')
    expect(surface.isolationLabel).toBe('THREADOS_SCOPED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/surface-v1.test.ts`
Expected: FAIL — `surfaceClass` does not exist on type `ThreadSurface`

- [ ] **Step 3: Add V.1 fields to ThreadSurface interface**

In `lib/thread-surfaces/types.ts`, add to `ThreadSurface`:
```typescript
  // V.1 surface model
  surfaceClass: 'shared' | 'private' | 'sealed' | 'control'
  visibility: 'public' | 'dependency' | 'self_only'
  isolationLabel: 'NONE' | 'THREADOS_SCOPED' | 'HOST_ENFORCED'
  revealState: 'sealed' | 'revealed' | null
  allowedReadScopes: string[]
  allowedWriteScopes: string[]
```

- [ ] **Step 4: Update repository.ts to handle new fields with defaults for migration**

In `lib/thread-surfaces/repository.ts`, update `readThreadSurfaceState` to add defaults to surfaces missing V.1 fields:
```typescript
// Inside readThreadSurfaceState, after building the threadSurfaces array:
threadSurfaces: (Array.isArray(raw.threadSurfaces) ? raw.threadSurfaces : []).map(s => ({
  surfaceClass: 'shared' as const,
  visibility: 'dependency' as const,
  isolationLabel: 'NONE' as const,
  revealState: null,
  allowedReadScopes: [],
  allowedWriteScopes: [],
  ...s,
})),
```

- [ ] **Step 5: Update mutations.ts — createRootThreadSurfaceRun and createChildThreadSurfaceRun to set defaults**

In `lib/thread-surfaces/mutations.ts`, add default V.1 fields to new surface creation:
```typescript
surfaceClass: 'shared',
visibility: 'dependency',
isolationLabel: 'NONE',
revealState: null,
allowedReadScopes: [],
allowedWriteScopes: [],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test lib/thread-surfaces/surface-v1.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run all thread-surfaces tests**

Run: `bun test lib/thread-surfaces/`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add lib/thread-surfaces/types.ts lib/thread-surfaces/repository.ts lib/thread-surfaces/mutations.ts lib/thread-surfaces/surface-v1.test.ts
git commit -m "feat: extend ThreadSurface with V.1 fields (surfaceClass, visibility, isolationLabel, revealState)"
```

---

## Milestone 2 — Surface-Scoped Execution

### Task 2.1: Trace Writer

**Files:**
- Create: `lib/traces/writer.ts`
- Create: `lib/traces/reader.ts`
- Test: `lib/traces/writer.test.ts`

- [ ] **Step 1: Write failing tests for trace writer**

```typescript
// lib/traces/writer.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendTraceEvent } from './writer'
import { readTraceEvents } from './reader'
import type { TraceEvent } from '@/lib/contracts/schemas'

describe('trace writer', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trace-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('appends a trace event to NDJSON file', async () => {
    const runId = 'run-001'
    const event: TraceEvent = {
      ts: new Date().toISOString(),
      run_id: runId,
      surface_id: 'thread-worker-1',
      actor: 'threados',
      event_type: 'step-started',
      payload_ref: null,
      policy_ref: null,
    }

    await appendTraceEvent(tempDir, runId, event)
    const content = await readFile(join(tempDir, '.threados/runs', runId, 'trace.ndjson'), 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed.event_type).toBe('step-started')
  })

  test('appends multiple events', async () => {
    const runId = 'run-002'
    const base = { run_id: runId, surface_id: 's1', actor: 'threados', payload_ref: null, policy_ref: null }

    await appendTraceEvent(tempDir, runId, { ...base, ts: '2026-01-01T00:00:00Z', event_type: 'step-started' })
    await appendTraceEvent(tempDir, runId, { ...base, ts: '2026-01-01T00:01:00Z', event_type: 'step-completed' })

    const events = await readTraceEvents(tempDir, runId)
    expect(events).toHaveLength(2)
    expect(events[0].event_type).toBe('step-started')
    expect(events[1].event_type).toBe('step-completed')
  })

  test('readTraceEvents returns empty array for missing file', async () => {
    const events = await readTraceEvents(tempDir, 'nonexistent')
    expect(events).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/traces/writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement writer.ts**

```typescript
// lib/traces/writer.ts
import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function appendTraceEvent(
  basePath: string,
  runId: string,
  event: TraceEvent,
): Promise<void> {
  const validated = TraceEventSchema.parse(event)
  const dirPath = join(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'trace.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}
```

- [ ] **Step 4: Implement reader.ts**

```typescript
// lib/traces/reader.ts
import { readFile } from 'fs/promises'
import { join } from 'path'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function readTraceEvents(
  basePath: string,
  runId: string,
): Promise<TraceEvent[]> {
  const filePath = join(basePath, RUNS_PATH, runId, 'trace.ndjson')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => TraceEventSchema.parse(JSON.parse(line)))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/traces/writer.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/traces/writer.ts lib/traces/reader.ts lib/traces/writer.test.ts
git commit -m "feat: add trace writer and reader — append-only NDJSON per run"
```

---

### Task 2.2: Approval Repository

**Files:**
- Create: `lib/approvals/repository.ts`
- Test: `lib/approvals/repository.test.ts`

- [ ] **Step 1: Write failing tests for approval repository**

```typescript
// lib/approvals/repository.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendApproval, readApprovals } from './repository'
import type { Approval } from '@/lib/contracts/schemas'

describe('approval repository', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'approval-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('appends and reads an approval', async () => {
    const runId = 'run-001'
    const approval: Approval = {
      id: 'apr-001',
      action_type: 'reveal',
      target_ref: 'thread-sealed-1',
      requested_by: 'threados',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: null,
    }

    await appendApproval(tempDir, runId, approval)
    const approvals = await readApprovals(tempDir, runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0].id).toBe('apr-001')
    expect(approvals[0].status).toBe('pending')
  })

  test('returns empty array for missing file', async () => {
    const approvals = await readApprovals(tempDir, 'nonexistent')
    expect(approvals).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/approvals/repository.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement repository.ts**

```typescript
// lib/approvals/repository.ts
import { appendFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function appendApproval(
  basePath: string,
  runId: string,
  approval: Approval,
): Promise<void> {
  const validated = ApprovalSchema.parse(approval)
  const dirPath = join(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'approvals.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}

export async function readApprovals(
  basePath: string,
  runId: string,
): Promise<Approval[]> {
  const filePath = join(basePath, RUNS_PATH, runId, 'approvals.ndjson')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => ApprovalSchema.parse(JSON.parse(line)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/approvals/repository.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/approvals/repository.ts lib/approvals/repository.test.ts
git commit -m "feat: add approval repository — append-only NDJSON per run"
```

---

## Milestone 3 — Deterministic Gates

### Task 3.1: Gate Rule Implementations

**Files:**
- Create: `lib/gates/rules.ts`
- Test: `lib/gates/rules.test.ts`

- [ ] **Step 1: Write failing tests for gate rules**

```typescript
// lib/gates/rules.test.ts
import { describe, expect, test } from 'bun:test'
import {
  checkDepsSatisfied,
  checkPolicyPass,
  checkSurfaceAccessPass,
  checkRevealAllowed,
} from './rules'
import type { Step, Gate } from '@/lib/sequence/schema'

describe('checkDepsSatisfied', () => {
  test('PASS when all deps are DONE', () => {
    const step = { id: 'worker-1', depends_on: ['orchestrator'] } as Step
    const allSteps = [
      { id: 'orchestrator', status: 'DONE' } as Step,
      step,
    ]
    const allGates: Gate[] = []
    const result = checkDepsSatisfied(step, allSteps, allGates)
    expect(result.status).toBe('PASS')
    expect(result.reason_codes).toEqual([])
  })

  test('BLOCK when dep is not DONE', () => {
    const step = { id: 'worker-1', depends_on: ['orchestrator'] } as Step
    const allSteps = [
      { id: 'orchestrator', status: 'READY' } as Step,
      step,
    ]
    const allGates: Gate[] = []
    const result = checkDepsSatisfied(step, allSteps, allGates)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain('DEP_MISSING')
  })

  test('BLOCK when dep is FAILED', () => {
    const step = { id: 'worker-1', depends_on: ['orchestrator'] } as Step
    const allSteps = [
      { id: 'orchestrator', status: 'FAILED' } as Step,
      step,
    ]
    const allGates: Gate[] = []
    const result = checkDepsSatisfied(step, allSteps, allGates)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain('DEP_FAILED')
  })

  test('checks gate deps too', () => {
    const step = { id: 'worker-1', depends_on: ['gate-review'] } as Step
    const allSteps = [step]
    const allGates = [{ id: 'gate-review', status: 'PENDING' } as Gate]
    const result = checkDepsSatisfied(step, allSteps, allGates)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain('DEP_MISSING')
  })
})

describe('checkPolicyPass', () => {
  test('PASS when side_effect_class is none', () => {
    const result = checkPolicyPass('none', 'SAFE', 'manual_only')
    expect(result.status).toBe('PASS')
  })

  test('NEEDS_APPROVAL when side_effect_class is write and mode is SAFE', () => {
    const result = checkPolicyPass('write', 'SAFE', 'approved_only')
    expect(result.status).toBe('NEEDS_APPROVAL')
  })

  test('PASS when mode is POWER and side_effect_mode is free', () => {
    const result = checkPolicyPass('write', 'POWER', 'free')
    expect(result.status).toBe('PASS')
  })
})

describe('checkRevealAllowed', () => {
  test('BLOCK when surface is sealed', () => {
    const result = checkRevealAllowed('sealed', 'sealed')
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain('REVEAL_LOCKED')
  })

  test('PASS when surface is not sealed', () => {
    const result = checkRevealAllowed('shared', null)
    expect(result.status).toBe('PASS')
  })

  test('PASS when surface was already revealed', () => {
    const result = checkRevealAllowed('sealed', 'revealed')
    expect(result.status).toBe('PASS')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/gates/rules.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement rules.ts**

```typescript
// lib/gates/rules.ts
import type { Step, Gate } from '@/lib/sequence/schema'
import { GateReasonCode, type GateDecisionStatus } from '@/lib/contracts/reason-codes'

export interface RuleResult {
  status: GateDecisionStatus
  reason_codes: string[]
  evidence_refs: string[]
}

const PASS: RuleResult = { status: 'PASS', reason_codes: [], evidence_refs: [] }

export function checkDepsSatisfied(
  step: Pick<Step, 'id' | 'depends_on'>,
  allSteps: Pick<Step, 'id' | 'status'>[],
  allGates: Pick<Gate, 'id' | 'status'>[],
): RuleResult {
  const reasons: string[] = []
  const evidence: string[] = []

  for (const depId of step.depends_on) {
    const depStep = allSteps.find(s => s.id === depId)
    const depGate = allGates.find(g => g.id === depId)

    if (depStep) {
      if (depStep.status === 'FAILED') {
        reasons.push(GateReasonCode.DEP_FAILED)
        evidence.push(`step:${depId}:status=${depStep.status}`)
      } else if (depStep.status !== 'DONE') {
        reasons.push(GateReasonCode.DEP_MISSING)
        evidence.push(`step:${depId}:status=${depStep.status}`)
      }
    } else if (depGate) {
      if (depGate.status === 'BLOCKED') {
        reasons.push(GateReasonCode.DEP_FAILED)
        evidence.push(`gate:${depId}:status=${depGate.status}`)
      } else if (depGate.status !== 'APPROVED') {
        reasons.push(GateReasonCode.DEP_MISSING)
        evidence.push(`gate:${depId}:status=${depGate.status}`)
      }
    } else {
      reasons.push(GateReasonCode.DEP_MISSING)
      evidence.push(`dep:${depId}:not_found`)
    }
  }

  if (reasons.length > 0) {
    return { status: 'BLOCK', reason_codes: reasons, evidence_refs: evidence }
  }
  return PASS
}

export function checkPolicyPass(
  sideEffectClass: string | undefined,
  policyMode: string,
  sideEffectMode: string,
): RuleResult {
  if (!sideEffectClass || sideEffectClass === 'none') return PASS

  if (policyMode === 'POWER' && sideEffectMode === 'free') return PASS

  if (sideEffectClass === 'write' || sideEffectClass === 'execute') {
    if (sideEffectMode === 'manual_only' || sideEffectMode === 'approved_only') {
      return {
        status: 'NEEDS_APPROVAL',
        reason_codes: [GateReasonCode.POLICY_BLOCKED],
        evidence_refs: [`side_effect_class:${sideEffectClass}`, `mode:${policyMode}`],
      }
    }
  }

  return PASS
}

export function checkSurfaceAccessPass(
  surfaceClass: string,
  crossSurfaceReads: string,
  isDependency: boolean,
): RuleResult {
  if (surfaceClass === 'sealed' && !isDependency) {
    return {
      status: 'BLOCK',
      reason_codes: [GateReasonCode.ACCESS_DENIED],
      evidence_refs: [`surface_class:${surfaceClass}`, `cross_surface_reads:${crossSurfaceReads}`],
    }
  }

  if (crossSurfaceReads === 'deny' && !isDependency) {
    return {
      status: 'BLOCK',
      reason_codes: [GateReasonCode.ACCESS_DENIED],
      evidence_refs: [`cross_surface_reads:deny`],
    }
  }

  return PASS
}

export function checkRevealAllowed(
  surfaceClass: string,
  revealState: string | null,
): RuleResult {
  if (surfaceClass !== 'sealed') return PASS
  if (revealState === 'revealed') return PASS

  return {
    status: 'BLOCK',
    reason_codes: [GateReasonCode.REVEAL_LOCKED],
    evidence_refs: [`surface_class:${surfaceClass}`, `reveal_state:${revealState}`],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/gates/rules.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/gates/rules.ts lib/gates/rules.test.ts
git commit -m "feat: add deterministic gate rules — deps_satisfied, policy_pass, surface_access, reveal_allowed"
```

---

### Task 3.2: Gate Engine

**Files:**
- Create: `lib/gates/engine.ts`
- Test: `lib/gates/engine.test.ts`

- [ ] **Step 1: Write failing tests for gate engine**

```typescript
// lib/gates/engine.test.ts
import { describe, expect, test } from 'bun:test'
import { evaluateStepGates } from './engine'
import type { Step, Gate } from '@/lib/sequence/schema'

describe('evaluateStepGates', () => {
  test('returns PASS when all deps satisfied and no special conditions', () => {
    const step = {
      id: 'worker-1',
      name: 'worker 1',
      type: 'b',
      model: 'claude-code',
      prompt_file: '.threados/prompts/worker-1.md',
      depends_on: ['orchestrator'],
      status: 'READY',
    } as Step

    const allSteps = [
      { id: 'orchestrator', status: 'DONE' } as Step,
      step,
    ]

    const decisions = evaluateStepGates(step, allSteps, [], {
      policyMode: 'SAFE',
      sideEffectMode: 'manual_only',
      crossSurfaceReads: 'dependency_only',
      surfaceClass: 'shared',
      revealState: null,
      isDependency: true,
    })

    expect(decisions).toHaveLength(3) // deps, policy, surface_access
    expect(decisions.every(d => d.status === 'PASS')).toBe(true)
  })

  test('returns BLOCK when deps not satisfied', () => {
    const step = {
      id: 'worker-1',
      depends_on: ['orchestrator'],
      status: 'READY',
    } as Step

    const allSteps = [
      { id: 'orchestrator', status: 'RUNNING' } as Step,
      step,
    ]

    const decisions = evaluateStepGates(step, allSteps, [], {
      policyMode: 'SAFE',
      sideEffectMode: 'manual_only',
      crossSurfaceReads: 'dependency_only',
      surfaceClass: 'shared',
      revealState: null,
      isDependency: true,
    })

    const depDecision = decisions.find(d => d.gate_type === 'deps_satisfied')
    expect(depDecision?.status).toBe('BLOCK')
    expect(depDecision?.reason_codes).toContain('DEP_MISSING')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/gates/engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement engine.ts**

```typescript
// lib/gates/engine.ts
import { randomUUID } from 'crypto'
import type { Step, Gate } from '@/lib/sequence/schema'
import type { GateDecision } from '@/lib/contracts/schemas'
import {
  checkDepsSatisfied,
  checkPolicyPass,
  checkSurfaceAccessPass,
  checkRevealAllowed,
} from './rules'

export interface GateContext {
  policyMode: string
  sideEffectMode: string
  crossSurfaceReads: string
  surfaceClass: string
  revealState: string | null
  isDependency: boolean
}

function toDecision(
  subjectRef: string,
  gateType: GateDecision['gate_type'],
  result: { status: string; reason_codes: string[]; evidence_refs: string[] },
): GateDecision {
  return {
    id: `gd-${randomUUID()}`,
    subject_type: 'step',
    subject_ref: subjectRef,
    gate_type: gateType,
    status: result.status as GateDecision['status'],
    reason_codes: result.reason_codes,
    evidence_refs: result.evidence_refs,
    decided_by: 'threados',
    decided_at: new Date().toISOString(),
  }
}

export function evaluateStepGates(
  step: Step,
  allSteps: Step[],
  allGates: Gate[],
  ctx: GateContext,
): GateDecision[] {
  const decisions: GateDecision[] = []

  decisions.push(toDecision(
    step.id,
    'deps_satisfied',
    checkDepsSatisfied(step, allSteps, allGates),
  ))

  decisions.push(toDecision(
    step.id,
    'policy_pass',
    checkPolicyPass(step.side_effect_class, ctx.policyMode, ctx.sideEffectMode),
  ))

  decisions.push(toDecision(
    step.id,
    'surface_access_pass',
    checkSurfaceAccessPass(ctx.surfaceClass, ctx.crossSurfaceReads, ctx.isDependency),
  ))

  if (ctx.surfaceClass === 'sealed') {
    decisions.push(toDecision(
      step.id,
      'reveal_allowed',
      checkRevealAllowed(ctx.surfaceClass, ctx.revealState),
    ))
  }

  return decisions
}

export function isStepRunnable(decisions: GateDecision[]): boolean {
  return decisions.every(d => d.status === 'PASS')
}

export function getBlockReasons(decisions: GateDecision[]): string[] {
  return decisions
    .filter(d => d.status !== 'PASS')
    .flatMap(d => d.reason_codes)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/gates/engine.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/gates/engine.ts lib/gates/engine.test.ts
git commit -m "feat: add deterministic gate engine — evaluates rules per step, emits GateDecision[]"
```

---

### Task 3.3: Gate Decision Persistence

**Files:**
- Create: `lib/gates/repository.ts`
- Test: `lib/gates/repository.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/gates/repository.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendGateDecision, readGateDecisions } from './repository'
import type { GateDecision } from '@/lib/contracts/schemas'

describe('gate decision repository', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gate-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('appends and reads gate decisions', async () => {
    const runId = 'run-001'
    const decision: GateDecision = {
      id: 'gd-001',
      subject_type: 'step',
      subject_ref: 'worker-1',
      gate_type: 'deps_satisfied',
      status: 'PASS',
      reason_codes: [],
      evidence_refs: [],
      decided_by: 'threados',
      decided_at: '2026-03-28T00:00:00Z',
    }

    await appendGateDecision(tempDir, runId, decision)
    const decisions = await readGateDecisions(tempDir, runId)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].gate_type).toBe('deps_satisfied')
  })

  test('returns empty for missing file', async () => {
    const decisions = await readGateDecisions(tempDir, 'nonexistent')
    expect(decisions).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/gates/repository.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement repository.ts**

```typescript
// lib/gates/repository.ts
import { appendFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { GateDecisionSchema, type GateDecision } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

export async function appendGateDecision(
  basePath: string,
  runId: string,
  decision: GateDecision,
): Promise<void> {
  const validated = GateDecisionSchema.parse(decision)
  const dirPath = join(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'gate-decisions.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}

export async function readGateDecisions(
  basePath: string,
  runId: string,
): Promise<GateDecision[]> {
  const filePath = join(basePath, RUNS_PATH, runId, 'gate-decisions.ndjson')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => GateDecisionSchema.parse(JSON.parse(line)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/gates/repository.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/gates/repository.ts lib/gates/repository.test.ts
git commit -m "feat: add gate decision persistence — NDJSON per run"
```

---

## Milestone 4 — Barrier/Reveal Model

### Task 4.1: Barrier Attestation

**Files:**
- Create: `lib/barriers/barrier-attestation.ts`
- Test: `lib/barriers/barrier-attestation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/barriers/barrier-attestation.test.ts
import { describe, expect, test } from 'bun:test'
import { createBarrierAttestation } from './barrier-attestation'

describe('createBarrierAttestation', () => {
  test('creates attestation for sealed surface', () => {
    const attestation = createBarrierAttestation({
      surfaceId: 'thread-sealed-1',
      runId: 'run-001',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'sealed',
    })

    expect(attestation.surface_id).toBe('thread-sealed-1')
    expect(attestation.isolation_label).toBe('THREADOS_SCOPED')
    expect(attestation.cross_surface_reads_denied).toBe(true)
    expect(attestation.shared_semantic_projection).toBe(false)
    expect(attestation.reveal_state).toBe('sealed')
    expect(attestation.contamination_events).toEqual([])
  })

  test('creates attestation for revealed surface', () => {
    const attestation = createBarrierAttestation({
      surfaceId: 'thread-sealed-1',
      runId: 'run-001',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'revealed',
    })

    expect(attestation.reveal_state).toBe('revealed')
    expect(attestation.cross_surface_reads_denied).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/barriers/barrier-attestation.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement barrier-attestation.ts**

```typescript
// lib/barriers/barrier-attestation.ts
import type { BarrierAttestation } from '@/lib/contracts/schemas'

interface CreateAttestationInput {
  surfaceId: string
  runId: string
  isolationLabel: 'NONE' | 'THREADOS_SCOPED' | 'HOST_ENFORCED'
  revealState: 'sealed' | 'revealed'
  contaminationEvents?: string[]
}

export function createBarrierAttestation(input: CreateAttestationInput): BarrierAttestation {
  const isSealed = input.revealState === 'sealed'

  return {
    surface_id: input.surfaceId,
    run_id: input.runId,
    isolation_label: input.isolationLabel,
    cross_surface_reads_denied: isSealed,
    shared_semantic_projection: !isSealed,
    reveal_state: input.revealState,
    contamination_events: input.contaminationEvents ?? [],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/barriers/barrier-attestation.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/barriers/barrier-attestation.ts lib/barriers/barrier-attestation.test.ts
git commit -m "feat: add barrier attestation — honest isolation records for sealed surfaces"
```

---

### Task 4.2: Reveal State Machine

**Files:**
- Create: `lib/barriers/reveal.ts`
- Test: `lib/barriers/reveal.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/barriers/reveal.test.ts
import { describe, expect, test } from 'bun:test'
import { canReveal, revealSurface } from './reveal'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

const makeSealedSurface = (overrides?: Partial<ThreadSurface>): ThreadSurface => ({
  id: 'thread-sealed-1',
  parentSurfaceId: 'thread-root',
  parentAgentNodeId: null,
  depth: 1,
  surfaceLabel: 'sealed track 1',
  role: 'worker',
  createdAt: new Date().toISOString(),
  childSurfaceIds: [],
  sequenceRef: null,
  spawnedByAgentId: null,
  surfaceClass: 'sealed',
  visibility: 'self_only',
  isolationLabel: 'THREADOS_SCOPED',
  revealState: 'sealed',
  allowedReadScopes: [],
  allowedWriteScopes: [],
  ...overrides,
})

describe('canReveal', () => {
  test('returns true for sealed surface in sealed state', () => {
    expect(canReveal(makeSealedSurface())).toBe(true)
  })

  test('returns false for already-revealed surface', () => {
    expect(canReveal(makeSealedSurface({ revealState: 'revealed' }))).toBe(false)
  })

  test('returns false for non-sealed surface', () => {
    expect(canReveal(makeSealedSurface({ surfaceClass: 'shared' }))).toBe(false)
  })
})

describe('revealSurface', () => {
  test('transitions sealed → revealed', () => {
    const surface = makeSealedSurface()
    const revealed = revealSurface(surface)
    expect(revealed.revealState).toBe('revealed')
    expect(revealed.visibility).toBe('dependency')
    // Original unchanged (immutability)
    expect(surface.revealState).toBe('sealed')
  })

  test('throws if surface cannot be revealed', () => {
    const surface = makeSealedSurface({ revealState: 'revealed' })
    expect(() => revealSurface(surface)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/barriers/reveal.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement reveal.ts**

```typescript
// lib/barriers/reveal.ts
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

export function canReveal(surface: ThreadSurface): boolean {
  return surface.surfaceClass === 'sealed' && surface.revealState === 'sealed'
}

export function revealSurface(surface: ThreadSurface): ThreadSurface {
  if (!canReveal(surface)) {
    throw new Error(`Cannot reveal surface ${surface.id}: surfaceClass=${surface.surfaceClass}, revealState=${surface.revealState}`)
  }

  return {
    ...surface,
    revealState: 'revealed',
    visibility: 'dependency',
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/barriers/reveal.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/barriers/reveal.ts lib/barriers/reveal.test.ts
git commit -m "feat: add reveal state machine — sealed → revealed transition with immutability"
```

---

### Task 4.3: Access Resolver

**Files:**
- Create: `lib/barriers/access-resolver.ts`
- Test: `lib/barriers/access-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/barriers/access-resolver.test.ts
import { describe, expect, test } from 'bun:test'
import { resolveAccess, type AccessQuery } from './access-resolver'

describe('resolveAccess', () => {
  test('shared surface allows dependency reads', () => {
    const result = resolveAccess({
      surfaceClass: 'shared',
      visibility: 'dependency',
      revealState: null,
      requestorSurfaceId: 'thread-worker-2',
      allowedReadScopes: ['thread-worker-2'],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
  })

  test('sealed surface denies all reads pre-reveal', () => {
    const result = resolveAccess({
      surfaceClass: 'sealed',
      visibility: 'self_only',
      revealState: 'sealed',
      requestorSurfaceId: 'thread-worker-2',
      allowedReadScopes: [],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(false)
    expect(result.canReadSemantics).toBe(false)
    expect(result.canReadManifest).toBe(true)
  })

  test('sealed surface allows reads after reveal', () => {
    const result = resolveAccess({
      surfaceClass: 'sealed',
      visibility: 'dependency',
      revealState: 'revealed',
      requestorSurfaceId: 'thread-worker-2',
      allowedReadScopes: ['thread-worker-2'],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
  })

  test('private surface allows self reads only', () => {
    const result = resolveAccess({
      surfaceClass: 'private',
      visibility: 'self_only',
      revealState: null,
      requestorSurfaceId: 'thread-worker-1',
      allowedReadScopes: ['thread-worker-1'],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(true)
  })

  test('private surface denies other surface reads', () => {
    const result = resolveAccess({
      surfaceClass: 'private',
      visibility: 'self_only',
      revealState: null,
      requestorSurfaceId: 'thread-worker-2',
      allowedReadScopes: ['thread-worker-1'],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(false)
  })

  test('cross_surface_reads deny blocks all cross reads', () => {
    const result = resolveAccess({
      surfaceClass: 'shared',
      visibility: 'dependency',
      revealState: null,
      requestorSurfaceId: 'thread-worker-2',
      allowedReadScopes: [],
      crossSurfaceReads: 'deny',
    })
    expect(result.canRead).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/barriers/access-resolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement access-resolver.ts**

```typescript
// lib/barriers/access-resolver.ts

export interface AccessQuery {
  surfaceClass: string
  visibility: string
  revealState: string | null
  requestorSurfaceId: string
  allowedReadScopes: string[]
  crossSurfaceReads: string
}

export interface AccessResult {
  canRead: boolean
  canReadSemantics: boolean
  canReadManifest: boolean
  reason: string
}

export function resolveAccess(query: AccessQuery): AccessResult {
  const {
    surfaceClass,
    visibility,
    revealState,
    requestorSurfaceId,
    allowedReadScopes,
    crossSurfaceReads,
  } = query

  // Sealed + not revealed: manifest only
  if (surfaceClass === 'sealed' && revealState !== 'revealed') {
    return {
      canRead: false,
      canReadSemantics: false,
      canReadManifest: true,
      reason: 'sealed surface pre-reveal: manifest only',
    }
  }

  // Cross-surface deny
  if (crossSurfaceReads === 'deny') {
    const inScope = allowedReadScopes.includes(requestorSurfaceId)
    if (!inScope) {
      return {
        canRead: false,
        canReadSemantics: false,
        canReadManifest: false,
        reason: 'cross_surface_reads=deny and requestor not in scope',
      }
    }
  }

  // Private: self only
  if (surfaceClass === 'private' && visibility === 'self_only') {
    const inScope = allowedReadScopes.includes(requestorSurfaceId)
    return {
      canRead: inScope,
      canReadSemantics: inScope,
      canReadManifest: true,
      reason: inScope ? 'private surface: requestor in scope' : 'private surface: requestor not in scope',
    }
  }

  // Dependency-scoped
  if (crossSurfaceReads === 'dependency_only') {
    const inScope = allowedReadScopes.length === 0 || allowedReadScopes.includes(requestorSurfaceId)
    return {
      canRead: inScope,
      canReadSemantics: inScope,
      canReadManifest: true,
      reason: inScope ? 'dependency access granted' : 'requestor not in dependency scope',
    }
  }

  // Default: allow
  return {
    canRead: true,
    canReadSemantics: true,
    canReadManifest: true,
    reason: 'default access',
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/barriers/access-resolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/barriers/access-resolver.ts lib/barriers/access-resolver.test.ts
git commit -m "feat: add access resolver — enforces surface class, visibility, and cross-surface read policies"
```

---

## Milestone 5 — Pack Compiler

### Task 5.1: Pack Schema and Loader

**Files:**
- Create: `lib/packs/pack-schema.ts`
- Create: `lib/packs/loader.ts`
- Test: `lib/packs/loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/packs/loader.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadPack } from './loader'
import YAML from 'yaml'

describe('loadPack', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pack-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('loads a valid pack.yaml', async () => {
    const packDir = join(tempDir, '.threados/packs/test-pack/1.0.0')
    await mkdir(packDir, { recursive: true })

    const manifest = {
      id: 'test-pack',
      version: '1.0.0',
      name: 'Test Pack',
      thread_types: ['b'],
      default_policy: 'SAFE',
      agents: ['orchestrator', 'worker-1'],
      surface_classes: ['shared', 'control'],
      phases: [
        { id: 'phase-1', label: 'Setup', order: 0 },
        { id: 'phase-2', label: 'Execute', order: 1 },
      ],
      steps: [
        {
          id: 'orch',
          name: 'orchestrator',
          type: 'b',
          model: 'claude-code',
          phase: 'phase-1',
          surface_class: 'control',
          depends_on: [],
        },
        {
          id: 'worker-1',
          name: 'worker 1',
          type: 'b',
          model: 'claude-code',
          phase: 'phase-2',
          surface_class: 'shared',
          depends_on: ['orch'],
        },
      ],
    }

    await writeFile(join(packDir, 'pack.yaml'), YAML.stringify(manifest), 'utf-8')

    const pack = await loadPack(tempDir, 'test-pack', '1.0.0')
    expect(pack.id).toBe('test-pack')
    expect(pack.steps).toHaveLength(2)
    expect(pack.phases).toHaveLength(2)
  })

  test('throws for missing pack', async () => {
    await expect(loadPack(tempDir, 'missing', '1.0.0')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/packs/loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pack-schema.ts**

```typescript
// lib/packs/pack-schema.ts
import { z } from 'zod'

export const PackPhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().nonnegative(),
})

export const PackStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['base', 'p', 'c', 'f', 'b', 'l']),
  model: z.string().min(1),
  phase: z.string().min(1),
  surface_class: z.enum(['shared', 'private', 'sealed', 'control']).default('shared'),
  depends_on: z.array(z.string()).default([]),
  prompt_file: z.string().optional(),
  orchestrator: z.string().optional(),
  fusion_candidates: z.boolean().optional(),
  fusion_synth: z.boolean().optional(),
  watchdog_for: z.string().optional(),
})

export const PackManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  thread_types: z.array(z.enum(['base', 'p', 'c', 'f', 'b', 'l'])),
  default_policy: z.enum(['SAFE', 'POWER']).default('SAFE'),
  agents: z.array(z.string()).default([]),
  surface_classes: z.array(z.enum(['shared', 'private', 'sealed', 'control'])).default(['shared']),
  phases: z.array(PackPhaseSchema),
  steps: z.array(PackStepSchema),
  gate_sets: z.array(z.string()).default([]),
  export_bundle_schema: z.string().optional(),
})

export type PackManifest = z.infer<typeof PackManifestSchema>
export type PackPhase = z.infer<typeof PackPhaseSchema>
export type PackStep = z.infer<typeof PackStepSchema>
```

- [ ] **Step 4: Implement loader.ts**

```typescript
// lib/packs/loader.ts
import { readFile } from 'fs/promises'
import { join } from 'path'
import YAML from 'yaml'
import { PackManifestSchema, type PackManifest } from './pack-schema'

const PACKS_PATH = '.threados/packs'

export async function loadPack(
  basePath: string,
  packId: string,
  version: string,
): Promise<PackManifest> {
  const packDir = join(basePath, PACKS_PATH, packId, version)
  const filePath = join(packDir, 'pack.yaml')

  const content = await readFile(filePath, 'utf-8')
  const raw = YAML.parse(content)
  return PackManifestSchema.parse(raw)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/packs/loader.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/packs/pack-schema.ts lib/packs/loader.ts lib/packs/loader.test.ts
git commit -m "feat: add pack schema and loader — validates pack.yaml with Zod"
```

---

### Task 5.2: Pack Compiler

**Files:**
- Create: `lib/packs/compiler.ts`
- Test: `lib/packs/compiler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/packs/compiler.test.ts
import { describe, expect, test } from 'bun:test'
import { compilePack } from './compiler'
import type { PackManifest } from './pack-schema'

describe('compilePack', () => {
  const manifest: PackManifest = {
    id: 'test-pack',
    version: '1.0.0',
    name: 'Test Pack',
    thread_types: ['b'],
    default_policy: 'SAFE',
    agents: [],
    surface_classes: ['shared', 'control'],
    phases: [
      { id: 'setup', label: 'Setup', order: 0 },
      { id: 'execute', label: 'Execute', order: 1 },
    ],
    steps: [
      { id: 'orch', name: 'orchestrator', type: 'b', model: 'claude-code', phase: 'setup', surface_class: 'control', depends_on: [] },
      { id: 'w1', name: 'worker 1', type: 'b', model: 'claude-code', phase: 'execute', surface_class: 'shared', depends_on: ['orch'] },
      { id: 'w2', name: 'worker 2', type: 'b', model: 'claude-code', phase: 'execute', surface_class: 'shared', depends_on: ['orch'] },
    ],
    gate_sets: [],
  }

  test('produces a valid sequence', () => {
    const result = compilePack(manifest)
    expect(result.sequence.name).toBe('Test Pack')
    expect(result.sequence.pack_id).toBe('test-pack')
    expect(result.sequence.pack_version).toBe('1.0.0')
    expect(result.sequence.steps).toHaveLength(3)
  })

  test('produces surfaces for each step', () => {
    const result = compilePack(manifest)
    // root + 3 step surfaces
    expect(result.surfaces).toHaveLength(4)
    const controlSurface = result.surfaces.find(s => s.id === 'thread-orch')
    expect(controlSurface?.surfaceClass).toBe('control')
  })

  test('sets dependencies correctly', () => {
    const result = compilePack(manifest)
    const w1 = result.sequence.steps.find(s => s.id === 'w1')
    expect(w1?.depends_on).toEqual(['orch'])
  })

  test('sets prompt_file paths', () => {
    const result = compilePack(manifest)
    const orch = result.sequence.steps.find(s => s.id === 'orch')
    expect(orch?.prompt_file).toBe('.threados/prompts/orch.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/packs/compiler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement compiler.ts**

```typescript
// lib/packs/compiler.ts
import type { PackManifest } from './pack-schema'
import type { Sequence, Step } from '@/lib/sequence/schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

export interface CompileResult {
  sequence: Sequence
  surfaces: ThreadSurface[]
}

export function compilePack(manifest: PackManifest): CompileResult {
  const now = new Date().toISOString()

  const steps: Step[] = manifest.steps.map(ps => ({
    id: ps.id,
    name: ps.name,
    type: ps.type,
    model: ps.model,
    prompt_file: ps.prompt_file ?? `.threados/prompts/${ps.id}.md`,
    depends_on: ps.depends_on,
    status: 'READY',
    phase: ps.phase,
    surface_ref: `thread-${ps.id}`,
    orchestrator: ps.orchestrator,
    fusion_candidates: ps.fusion_candidates,
    fusion_synth: ps.fusion_synth,
    watchdog_for: ps.watchdog_for,
  }))

  const sequence: Sequence = {
    version: '1.0',
    name: manifest.name,
    thread_type: manifest.thread_types[0],
    steps,
    gates: [],
    pack_id: manifest.id,
    pack_version: manifest.version,
    default_policy_ref: null,
  }

  const rootSurface: ThreadSurface = {
    id: 'thread-root',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: manifest.name,
    role: 'orchestrator',
    createdAt: now,
    childSurfaceIds: manifest.steps.map(s => `thread-${s.id}`),
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: 'control',
    visibility: 'dependency',
    isolationLabel: 'NONE',
    revealState: null,
    allowedReadScopes: [],
    allowedWriteScopes: [],
  }

  const stepSurfaces: ThreadSurface[] = manifest.steps.map(ps => ({
    id: `thread-${ps.id}`,
    parentSurfaceId: 'thread-root',
    parentAgentNodeId: ps.id,
    depth: 1,
    surfaceLabel: ps.name,
    role: 'worker',
    createdAt: now,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: ps.surface_class,
    visibility: ps.surface_class === 'sealed' ? 'self_only' : 'dependency',
    isolationLabel: ps.surface_class === 'sealed' ? 'THREADOS_SCOPED' : 'NONE',
    revealState: ps.surface_class === 'sealed' ? 'sealed' : null,
    allowedReadScopes: [],
    allowedWriteScopes: [],
  }))

  return {
    sequence,
    surfaces: [rootSurface, ...stepSurfaces],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/packs/compiler.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/packs/compiler.ts lib/packs/compiler.test.ts
git commit -m "feat: add pack compiler — transforms pack.yaml into sequence + surfaces"
```

---

## Milestone 6 — Export Bundle

### Task 6.1: Export Bundler

**Files:**
- Create: `lib/exports/schema.ts`
- Create: `lib/exports/bundler.ts`
- Test: `lib/exports/bundler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/exports/bundler.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { generateExportBundle } from './bundler'

describe('generateExportBundle', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('generates a bundle from run artifacts', async () => {
    // Setup sequence
    const seqDir = join(tempDir, '.threados')
    await mkdir(seqDir, { recursive: true })
    await writeFile(join(seqDir, 'sequence.yaml'), 'version: "1.0"\nname: test\nsteps: []\ngates: []', 'utf-8')

    // Setup run artifacts
    const runId = 'run-001'
    const runDir = join(seqDir, 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await appendFile(join(runDir, 'trace.ndjson'), '{"ts":"2026-01-01","run_id":"run-001","surface_id":"s1","actor":"threados","event_type":"step-started","payload_ref":null,"policy_ref":null}\n')
    await appendFile(join(runDir, 'gate-decisions.ndjson'), '{"id":"gd1","subject_type":"step","subject_ref":"s1","gate_type":"deps_satisfied","status":"PASS","reason_codes":[],"evidence_refs":[],"decided_by":"threados","decided_at":"2026-01-01"}\n')

    const bundle = await generateExportBundle(tempDir, runId)

    expect(bundle.bundle_version).toBe('1.0')
    expect(bundle.run_id).toBe('run-001')
    expect(bundle.trace_events).toHaveLength(1)
    expect(bundle.gate_decisions).toHaveLength(1)
  })

  test('handles missing trace file gracefully', async () => {
    const seqDir = join(tempDir, '.threados')
    await mkdir(seqDir, { recursive: true })
    await writeFile(join(seqDir, 'sequence.yaml'), 'version: "1.0"\nname: test\nsteps: []\ngates: []', 'utf-8')

    const runDir = join(seqDir, 'runs', 'run-002')
    await mkdir(runDir, { recursive: true })

    const bundle = await generateExportBundle(tempDir, 'run-002')
    expect(bundle.trace_events).toEqual([])
    expect(bundle.gate_decisions).toEqual([])
    expect(bundle.approvals).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/exports/bundler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement schema.ts**

```typescript
// lib/exports/schema.ts
import { z } from 'zod'
import { TraceEventSchema } from '@/lib/contracts/schemas'
import { GateDecisionSchema } from '@/lib/contracts/schemas'
import { ApprovalSchema } from '@/lib/contracts/schemas'

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
```

- [ ] **Step 4: Implement bundler.ts**

```typescript
// lib/exports/bundler.ts
import { readFile } from 'fs/promises'
import { join } from 'path'
import { readTraceEvents } from '@/lib/traces/reader'
import { readGateDecisions } from '@/lib/gates/repository'
import { readApprovals } from '@/lib/approvals/repository'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { ExportBundle } from './schema'

export async function generateExportBundle(
  basePath: string,
  runId: string,
): Promise<ExportBundle> {
  // Read sequence snapshot
  let sequenceSnapshot = ''
  try {
    sequenceSnapshot = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf-8')
  } catch { /* empty */ }

  // Read policy snapshot
  let policySnapshot: string | null = null
  try {
    policySnapshot = await readFile(join(basePath, '.threados/policy.yaml'), 'utf-8')
  } catch { /* empty */ }

  // Read surfaces
  let surfaces: unknown[] = []
  try {
    const state = await readThreadSurfaceState(basePath)
    surfaces = state.threadSurfaces
  } catch { /* empty */ }

  // Read run artifacts
  const traceEvents = await readTraceEvents(basePath, runId)
  const gateDecisions = await readGateDecisions(basePath, runId)
  const approvals = await readApprovals(basePath, runId)

  return {
    bundle_version: '1.0',
    run_id: runId,
    pack: { id: null, version: null },
    sequence_snapshot: sequenceSnapshot,
    policy_snapshot: policySnapshot,
    surfaces,
    trace_events: traceEvents,
    gate_decisions: gateDecisions,
    approvals,
    artifact_manifests: [],
    timing_summary: null,
    cost_summary: null,
    exported_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/exports/bundler.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/exports/schema.ts lib/exports/bundler.ts lib/exports/bundler.test.ts
git commit -m "feat: add export bundler — assembles run artifacts into third-party eval bundle"
```

---

## Milestone 7 — API Routes & UI

### Task 7.1: Traces API Route

**Files:**
- Create: `app/api/traces/route.ts`

- [ ] **Step 1: Implement traces API**

```typescript
// app/api/traces/route.ts
import { NextResponse } from 'next/server'
import { readTraceEvents } from '@/lib/traces/reader'

function getBasePath(): string {
  return process.env.THREADOS_BASE_PATH || process.cwd()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return NextResponse.json({ error: 'runId query parameter required' }, { status: 400 })
  }

  const events = await readTraceEvents(getBasePath(), runId)
  return NextResponse.json({ events })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/traces/route.ts
git commit -m "feat: add /api/traces GET route — reads trace events by runId"
```

---

### Task 7.2: Approvals API Route

**Files:**
- Create: `app/api/approvals/route.ts`

- [ ] **Step 1: Implement approvals API**

```typescript
// app/api/approvals/route.ts
import { NextResponse } from 'next/server'
import { readApprovals, appendApproval } from '@/lib/approvals/repository'
import { randomUUID } from 'crypto'

function getBasePath(): string {
  return process.env.THREADOS_BASE_PATH || process.cwd()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return NextResponse.json({ error: 'runId query parameter required' }, { status: 400 })
  }

  const approvals = await readApprovals(getBasePath(), runId)
  return NextResponse.json({ approvals })
}

export async function POST(request: Request) {
  const body = await request.json()
  const { action, runId } = body

  if (action === 'request') {
    const approval = {
      id: `apr-${randomUUID()}`,
      action_type: body.action_type ?? 'run',
      target_ref: body.target_ref,
      requested_by: body.requested_by ?? 'threados',
      status: 'pending' as const,
      approved_by: null,
      approved_at: null,
      notes: body.notes ?? null,
    }
    await appendApproval(getBasePath(), runId, approval)
    return NextResponse.json({ approval })
  }

  if (action === 'resolve') {
    const approval = {
      id: body.approval_id,
      action_type: body.action_type,
      target_ref: body.target_ref,
      requested_by: body.requested_by ?? 'threados',
      status: body.status,
      approved_by: body.approved_by ?? 'user',
      approved_at: new Date().toISOString(),
      notes: body.notes ?? null,
    }
    await appendApproval(getBasePath(), runId, approval)
    return NextResponse.json({ approval })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/approvals/route.ts
git commit -m "feat: add /api/approvals route — request and resolve approvals per run"
```

---

### Task 7.3: Reveal API Route

**Files:**
- Create: `app/api/surfaces/reveal/route.ts`

- [ ] **Step 1: Implement reveal API**

```typescript
// app/api/surfaces/reveal/route.ts
import { NextResponse } from 'next/server'
import { readThreadSurfaceState, updateThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { canReveal, revealSurface } from '@/lib/barriers/reveal'
import { createBarrierAttestation } from '@/lib/barriers/barrier-attestation'
import { appendTraceEvent } from '@/lib/traces/writer'

function getBasePath(): string {
  return process.env.THREADOS_BASE_PATH || process.cwd()
}

export async function POST(request: Request) {
  const body = await request.json()
  const { surfaceId, runId } = body

  if (!surfaceId) {
    return NextResponse.json({ error: 'surfaceId required' }, { status: 400 })
  }

  const bp = getBasePath()
  const state = await readThreadSurfaceState(bp)
  const surface = state.threadSurfaces.find(s => s.id === surfaceId)

  if (!surface) {
    return NextResponse.json({ error: `Surface not found: ${surfaceId}` }, { status: 404 })
  }

  if (!canReveal(surface)) {
    return NextResponse.json({
      error: `Cannot reveal surface: surfaceClass=${surface.surfaceClass}, revealState=${surface.revealState}`,
    }, { status: 400 })
  }

  const revealed = revealSurface(surface)

  await updateThreadSurfaceState(bp, (current) => ({
    ...current,
    threadSurfaces: current.threadSurfaces.map(s =>
      s.id === surfaceId ? revealed : s
    ),
  }))

  const attestation = createBarrierAttestation({
    surfaceId,
    runId: runId ?? 'manual',
    isolationLabel: revealed.isolationLabel as 'NONE' | 'THREADOS_SCOPED' | 'HOST_ENFORCED',
    revealState: 'revealed',
  })

  if (runId) {
    await appendTraceEvent(bp, runId, {
      ts: new Date().toISOString(),
      run_id: runId,
      surface_id: surfaceId,
      actor: 'threados',
      event_type: 'surface-revealed',
      payload_ref: null,
      policy_ref: null,
    })
  }

  return NextResponse.json({ surface: revealed, attestation })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/surfaces/reveal/route.ts
git commit -m "feat: add /api/surfaces/reveal route — reveal sealed surfaces with barrier attestation"
```

---

### Task 7.4: Export Bundle API Route

**Files:**
- Create: `app/api/exports/run-bundle/route.ts`

- [ ] **Step 1: Implement export API**

```typescript
// app/api/exports/run-bundle/route.ts
import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { generateExportBundle } from '@/lib/exports/bundler'

function getBasePath(): string {
  return process.env.THREADOS_BASE_PATH || process.cwd()
}

export async function POST(request: Request) {
  const body = await request.json()
  const { runId } = body

  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 })
  }

  const bp = getBasePath()
  const bundle = await generateExportBundle(bp, runId)

  // Persist to exports directory
  const exportDir = join(bp, '.threados/exports', runId)
  await mkdir(exportDir, { recursive: true })
  await writeFile(join(exportDir, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf-8')

  return NextResponse.json({ bundle, exportPath: `.threados/exports/${runId}/bundle.json` })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/exports/run-bundle/route.ts
git commit -m "feat: add /api/exports/run-bundle route — generates and persists export bundles"
```

---

### Task 7.5: Surface Access API Route

**Files:**
- Create: `app/api/surfaces/access/route.ts`

- [ ] **Step 1: Implement surface access API**

```typescript
// app/api/surfaces/access/route.ts
import { NextResponse } from 'next/server'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { resolveAccess } from '@/lib/barriers/access-resolver'
import { PolicyEngine } from '@/lib/policy/engine'

function getBasePath(): string {
  return process.env.THREADOS_BASE_PATH || process.cwd()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const surfaceId = searchParams.get('surfaceId')
  const requestorSurfaceId = searchParams.get('requestorSurfaceId')

  if (!surfaceId || !requestorSurfaceId) {
    return NextResponse.json({ error: 'surfaceId and requestorSurfaceId required' }, { status: 400 })
  }

  const bp = getBasePath()
  const state = await readThreadSurfaceState(bp)
  const surface = state.threadSurfaces.find(s => s.id === surfaceId)

  if (!surface) {
    return NextResponse.json({ error: `Surface not found: ${surfaceId}` }, { status: 404 })
  }

  const policy = await PolicyEngine.load(bp)
  const config = policy.getConfig()

  const access = resolveAccess({
    surfaceClass: surface.surfaceClass ?? 'shared',
    visibility: surface.visibility ?? 'dependency',
    revealState: surface.revealState ?? null,
    requestorSurfaceId,
    allowedReadScopes: surface.allowedReadScopes ?? [],
    crossSurfaceReads: config.cross_surface_reads ?? 'dependency_only',
  })

  return NextResponse.json({ access })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/surfaces/access/route.ts
git commit -m "feat: add /api/surfaces/access route — resolves read/write access per surface"
```

---

### Task 7.6: UI Hooks for New API Routes

**Files:**
- Modify: `lib/ui/api.ts`

- [ ] **Step 1: Add React Query hooks for new routes**

Add to `lib/ui/api.ts`:

```typescript
// ── Traces ──────────────────────────────────────────────────────────

export function useTraces(runId: string | null) {
  return useQuery({
    queryKey: ['traces', runId],
    queryFn: () => fetchJson<{ events: unknown[] }>(`/api/traces?runId=${runId}`).then(r => r.events),
    enabled: !!runId,
  })
}

// ── Approvals ───────────────────────────────────────────────────────

export function useApprovals(runId: string | null) {
  return useQuery({
    queryKey: ['approvals', runId],
    queryFn: () => fetchJson<{ approvals: unknown[] }>(`/api/approvals?runId=${runId}`).then(r => r.approvals),
    enabled: !!runId,
  })
}

export function useRequestApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { runId: string; action_type: string; target_ref: string }) =>
      fetchJson('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', ...params }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })
}

export function useResolveApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      fetchJson('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', ...params }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })
}

// ── Surface Reveal ──────────────────────────────────────────────────

export function useRevealSurface() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { surfaceId: string; runId?: string }) =>
      fetchJson('/api/surfaces/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-surfaces'] })
      qc.invalidateQueries({ queryKey: ['traces'] })
    },
  })
}

// ── Export Bundle ────────────────────────────────────────────────────

export function useExportBundle() {
  return useMutation({
    mutationFn: (params: { runId: string }) =>
      fetchJson('/api/exports/run-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
  })
}

// ── Surface Access ──────────────────────────────────────────────────

export function useSurfaceAccess(surfaceId: string | null, requestorSurfaceId: string | null) {
  return useQuery({
    queryKey: ['surface-access', surfaceId, requestorSurfaceId],
    queryFn: () => fetchJson<{ access: unknown }>(`/api/surfaces/access?surfaceId=${surfaceId}&requestorSurfaceId=${requestorSurfaceId}`).then(r => r.access),
    enabled: !!surfaceId && !!requestorSurfaceId,
  })
}
```

- [ ] **Step 2: Update all test mocks that mock lib/ui/api.ts**

Per CLAUDE.md testing gotchas, run:
```bash
grep -rl "mock.module('@/lib/ui/api'" components/
```
Then add the new hooks (`useTraces`, `useApprovals`, `useRequestApproval`, `useResolveApproval`, `useRevealSurface`, `useExportBundle`, `useSurfaceAccess`) to every mock that is found.

- [ ] **Step 3: Commit**

```bash
git add lib/ui/api.ts
git commit -m "feat: add React Query hooks for traces, approvals, reveal, export, surface access"
```

---

### Task 7.7: Verification — Full Test Suite

- [ ] **Step 1: Run the complete test suite**

```bash
bun test
```
Expected: ALL PASS with no regressions

- [ ] **Step 2: Run type check**

```bash
bun run check
```
Expected: PASS

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and type-check regressions from V.1 implementation"
```

---

## Appendix: V.1 Capability Coverage

| V.1 Capability | Tasks | Deliverables |
|----------------|-------|-------------|
| **1. Install and run a pack** | 5.1, 5.2 | `lib/packs/loader.ts`, `lib/packs/compiler.ts` |
| **2. Compile pack into sequence + surfaces** | 5.2 | `compilePack()` produces Sequence + ThreadSurface[] |
| **3. Execute inside surface-scoped runs** | 1.4, 2.1, 4.3 | Extended ThreadSurface, trace writer, access resolver |
| **4. Enforce deterministic gates** | 3.1, 3.2, 3.3 | Gate rules, engine, decision persistence |
| **5. Append-only traces and audit** | 2.1, 2.2 | `lib/traces/`, `lib/approvals/` |
| **6. Export run bundle** | 6.1 | `lib/exports/bundler.ts` |

### Non-goals (explicitly excluded per musthaves.md §10)
- Internal benchmark scoring
- Reliability dashboards
- Cryptographic sealing
- Multi-tenant cloud orchestration
- Autonomous outbound side effects
- Semantic grading by the orchestrator
