# thredOS Desktop 1.0
## Canonical Repository-Mapped Implementation Plan — Milestones 0 and 1

**Document status:** Final canonical delivery plan subordinate to the canonical PRD  
**Version:** 1.1  
**Date:** 2026-07-15  
**Product:** thredOS Desktop  
**Repository:** `OmarA1-Bakri-Org/thredOS`  
**Parent specification:** `docs/product/canonical-prd-worktree-free-parallel-runtime.md`  
**Supersedes:** All earlier Milestones 0–1 implementation-plan drafts in this project  
**Scope:** Milestone 0 — Contract and Runtime Convergence; Milestone 1 — Portable Surface Workspace Engine

---

## 0. Authority, scope, and implementation boundary

This document converts the canonical worktree-free parallel-runtime PRD into an executable repository plan. It defines the merge order, contracts, file layout, migration strategy, tests, and acceptance evidence for the first two milestones.

Authority order for implementation is:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md`;
2. `AGENTS.md`;
3. this implementation plan;
4. `docs/plans/m0-m1-pr-manifest.yaml`.

Where this implementation plan conflicts with the canonical PRD, the PRD wins. Where it conflicts with `AGENTS.md` on repository conduct, safety, validation, or contribution mechanics, the stricter compatible rule applies. Where a repository path has moved since the reviewed baseline, preserve the contract and update the path mapping in the affected pull request and manifest.

### 0.1 Outcomes covered

Milestone 0 must establish one truthful runtime path shared by the desktop app, local API, CLI, chat/apply layer, and future MCP integrations.

Milestone 1 must establish independent writable Surface Workspaces created from one immutable baseline snapshot without using Git worktrees.

### 0.2 Outcomes deliberately deferred

The following are designed by the contracts in this plan but implemented after Milestone 1:

- filesystem Change Set capture and review — Milestone 2;
- three-way merge, preview, transactional apply, and rollback — Milestone 2;
- real bounded multi-process concurrency — Milestone 3;
- candidate/race scheduling and first-passing policies — Milestone 3;
- OverlayFS and container providers — P1;
- host-enforced isolation — P1.

Milestones 0 and 1 are not a customer-facing completion point. The combined implementation proves that multiple attempts can receive independent, identical baseline workspaces while the canonical project remains unchanged. Those attempts may still be scheduled one at a time during this tranche. Milestone 3 turns the same run, attempt, process, snapshot, and workspace contracts into bounded concurrent execution without another migration.

### 0.3 Non-negotiable engineering invariants

1. No production runtime code may invoke `git worktree`.
2. Route handlers and CLI handlers may parse, authorize, invoke, and render; they may not own execution lifecycle logic.
3. A workflow run and a step attempt are separate persisted entities.
4. Every mutating command is idempotent.
5. No process is spawned before its attempt and launch request are persisted.
6. Stop and cancel succeed only after actual process-control success or an explicitly truthful terminal state.
7. Restart creates a new attempt linked to the previous attempt.
8. No write-capable isolated attempt runs without an immutable snapshot and verified Surface Workspace.
9. The canonical workspace is never used as the `cwd` of an isolated write-capable attempt.
10. Directory-scoped isolation is labelled `THREADOS_SCOPED`, never `HOST_ENFORCED`.
11. Existing `.threados/sequence.yaml`, thread-surface projections, gates, approvals, traces, and export behavior remain compatible.
12. No destructive rewrite of legacy runtime artifacts occurs automatically.

---

# 1. Reviewed repository baseline

The implementation plan maps to the following current product areas.

| Existing area | Current responsibility | Planned treatment |
|---|---|---|
| `app/api/run/route.ts` | Full app-side execution lifecycle | Extract lifecycle into shared runtime service; retain compatibility route |
| `app/api/stop/route.ts` | App-side process stop | Delegate to process controller through runtime service |
| `app/api/restart/route.ts` | App-side restart | Delegate; create new attempt lineage |
| `app/api/status/route.ts` | Reconciled sequence status | Add canonical run/attempt projection while retaining sequence summary |
| `lib/seqctl/commands/run.ts` | Separate CLI execution lifecycle | Replace with shared runtime-service calls |
| `lib/seqctl/commands/control.ts` | CLI stop/restart, including permissive state flips | Replace with truthful shared controls |
| `lib/seqctl/commands/status.ts` | Sequence and mprocs status | Consume canonical runtime projections |
| `lib/runner/dispatch.ts` | Provider-specific launch configuration | Retain; accept attempt/workspace context |
| `lib/runner/wrapper.ts` | Spawn, timeout, stdout/stderr collection | Retain; expose cancellable process handle |
| `lib/runner/artifacts.ts` | Run logs and canonical surface artifacts | Extend for workflow-run/attempt identity |
| `lib/thread-surfaces/` | Surfaces, run scopes, events, spawn and merge projections | Retain; add attempt/workspace/snapshot references |
| `lib/contracts/schemas.ts` | V1 contracts for surfaces, runs, gates, approvals, traces | Extend through focused runtime/workspace schemas and re-exports |
| `lib/gates/` | Deterministic pre-run and completion gates | Retain; add snapshot/workspace gates in Milestone 1 |
| `lib/approvals/` | Append-only approval lifecycle | Retain; runtime service remains the only consumer for execution authority |
| `lib/traces/` | Per-run append-only trace | Extend event vocabulary |
| `lib/reconciliation/reconciler.ts` | mprocs-oriented orphan reconciliation | Generalize to canonical process records; retain legacy mprocs reconciliation |
| `lib/mprocs/` | Optional process manager and status map | Retain as observer/legacy adapter, not source of truth |
| `lib/ui/api.ts` | App hooks for local APIs | Add runs, attempts, process controls, and workspaces |
| `components/workbench/sections/RunSection.tsx` | Run controls and evidence summaries | Enable real stop/retry and add workspace inspection |
| `lib/local-first/` | Local workspace identity and residency | Reuse workspace ID and base path for external runtime roots |

### 1.1 Preflight drift audit

Before coding the first PR:

```bash
git fetch origin
git checkout main
git pull --ff-only
bun install
bun run check

rg -n "executeSingleStep|runStep\(|saveRunArtifacts|createRootRunScope|finalizeRootRunScope" app lib
rg -n "spawn\(|Bun\.spawn|MprocsClient|updateStepProcess" app lib desktop
rg -n "thread-surfaces|run\.json|approvals\.ndjson|gate-decisions\.ndjson|trace\.ndjson" app lib test
```

Record moved paths in the first PR description. Do not change the contracts in this plan merely because a file moved.

---

# 2. Delivery strategy

## 2.1 Merge discipline

- Merge PRs in the order specified below.
- Every PR must leave `main` deployable and all existing compatibility routes operational.
- A PR may introduce an unused contract or implementation behind the shared service, but it may not create a second public execution path.
- Use additive schemas first, then migrate callers.
- Delete old lifecycle helpers only after API and CLI parity tests prove the cutover.
- No long-lived feature flag is required. Test dependency injection and compatibility adapters provide rollback safety.

## 2.2 Pull-request sequence

| PR | Milestone | Branch | Size | Primary outcome |
|---:|---|---|---|---|
| 01 | M0 | `feat/runtime-contracts-v2` | M | Canonical run, attempt, process, workspace, change, and merge schemas |
| 02 | M0 | `feat/runtime-repositories-v2` | M | Atomic repositories, revisions, idempotency, and legacy projections |
| 03 | M0 | `feat/runtime-service-v2` | L | One sequential runtime service and attempt executor |
| 04 | M0 | `refactor/api-runtime-service` | M | Local API routes delegate to the service |
| 05 | M0 | `refactor/cli-runtime-service` | M | CLI delegates to the same service with stable JSON |
| 06 | M0 | `feat/truthful-process-control` | L | Cancellable process handles, retry lineage, and recovery |
| 07 | M0 | `feat/runtime-operator-projections` | M | Run/attempt APIs, app controls, parity and architecture proofs |
| 08 | M1 | `feat/workspace-config-paths` | M | Workspace policy, paths, exclusions, and external runtime root |
| 09 | M1 | `feat/immutable-snapshot-engine` | L | Dirty/non-Git-safe immutable baseline snapshots |
| 10 | M1 | `feat/copy-workspace-provider` | L | Portable verified copy workspaces, quotas, retention, cleanup |
| 11 | M1 | `feat/isolated-attempt-dispatch` | L | Runtime binds write attempts to verified workspace `cwd` |
| 12 | M1 | `feat/workspace-operator-surface` | M | Workspace API/CLI/UI, doctor, release proof, no-worktree guard |

Dependency graph:

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07
                                                    │
                                                    ▼
PR-08 → PR-09 → PR-10 ───────────────────────────→ PR-11 → PR-12
```

PR-08 may be developed after PR-02, but it must not merge ahead of PR-07 unless all shared-service interfaces have stabilized.

---

# 3. Canonical persistence model

## 3.1 New generated layout

```text
.threados/
├── runs/
│   └── <workflowRunId>/
│       ├── run.json
│       ├── trace.ndjson
│       ├── approvals.ndjson
│       ├── gate-decisions.ndjson
│       ├── attempts/
│       │   └── <attemptId>/
│       │       ├── attempt.json
│       │       ├── process.json
│       │       ├── input.manifest.json
│       │       ├── output.manifest.json
│       │       ├── workspace.ref.json
│       │       ├── stdout.log
│       │       └── stderr.log
│       └── surfaces/
│           └── <surfaceId>/
│               └── existing canonical surface-run artifacts
├── snapshots/
│   └── <snapshotId>/
│       ├── current.json
│       ├── manifest.json
│       └── generations/<generationId>/
│           ├── metadata.json
│           └── manifest.json
├── workspaces/
│   └── index.json
└── state/
    ├── runtime-index.json
    ├── runtime-commands/
    │   └── <commandId>.json
    └── existing compatibility state
```

Actual snapshot trees and attempt workspaces live outside the canonical project:

```text
<runtimeDataRoot>/
├── snapshots/<localWorkspaceId>/<snapshotId>/tree/
└── workspaces/<localWorkspaceId>/<workflowRunId>/<workspaceId>/tree/
```

## 3.2 Compatibility rules

- Existing `.threados/runs/<runId>/<stepId>/` artifacts remain readable.
- Existing `.threados/runs/<runId>/run.json` is parsed through `LegacyRunRecordSchema` when it does not carry `schema_version: 2`.
- Existing `thread-surfaces.json` remains a compatibility projection.
- Existing per-surface canonical records remain authoritative for surface metadata.
- New attempts write only the V2 run/attempt layout plus existing surface projections needed by the current UI.
- No automatic deletion or in-place rewrite of legacy runs.

---

# 4. Canonical contracts

The exact Zod implementations may be split across modules, but field names and state semantics are locked.

## 4.1 `WorkflowRun`

```ts
const WorkflowRunStatusSchema = z.enum([
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

const WorkflowRunSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sequence_id: z.string().min(1),
  sequence_snapshot_hash: z.string().min(1),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('step'), step_id: z.string().min(1) }),
    z.object({ kind: z.literal('group'), group_id: z.string().min(1) }),
    z.object({ kind: z.literal('runnable') }),
  ]),
  strategy: z.enum(['sequential', 'candidate', 'sharded', 'race']),
  status: WorkflowRunStatusSchema,
  max_concurrency: z.number().int().positive(),
  policy_snapshot_hash: z.string().min(1),
  baseline_snapshot_id: z.string().nullable(),
  attempt_ids: z.array(z.string()),
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
```

## 4.2 `StepAttempt`

```ts
const StepAttemptStatusSchema = z.enum([
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

const StepAttemptSchema = z.object({
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
```

## 4.3 `ProcessRecord`

```ts
const ProcessStatusSchema = z.enum([
  'planned',
  'starting',
  'running',
  'terminating',
  'exited',
  'lost',
])

const ProcessRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  provider: z.enum(['local-process', 'mprocs-legacy']),
  provider_handle: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  command: z.string().min(1),
  redacted_args: z.array(z.string()),
  cwd: z.string().min(1),
  status: ProcessStatusSchema,
  launch_requested_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  last_output_at: z.string().datetime().nullable(),
  cancellation_requested_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
})
```

## 4.4 `RuntimeCommandReceipt`

```ts
const RuntimeCommandReceiptSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  idempotency_key: z.string().min(1),
  command_type: z.enum([
    'start-run',
    'cancel-run',
    'cancel-attempt',
    'retry-attempt',
    'retain-workspace',
    'clean-workspace',
  ]),
  request_hash: z.string().min(1),
  status: z.enum(['accepted', 'completed', 'failed']),
  result_ref: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
})
```

A reused idempotency key with a different request hash fails with `IDEMPOTENCY_CONFLICT`.

## 4.5 `WorkspaceSnapshot`

```ts
const SnapshotEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['file', 'directory', 'symlink']),
  sha256: z.string().nullable(),
  size_bytes: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative().nullable(),
  symlink_target: z.string().nullable(),
})

const SnapshotManifestSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1),
  root_manifest_hash: z.string().min(1),
  entries: z.array(SnapshotEntrySchema),
})

const WorkspaceSnapshotSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  local_workspace_id: z.string().min(1),
  source_root: z.string().min(1),
  content_root: z.string().nullable(),
  manifest_ref: z.string().nullable(),
  status: z.enum(['creating', 'ready', 'failed', 'deleted']),
  root_manifest_hash: z.string().nullable(),
  exclusion_policy_hash: z.string().min(1),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  git_head: z.string().nullable(),
  git_dirty: z.boolean().nullable(),
  created_at: z.string().datetime(),
  verified_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
```

## 4.6 `SurfaceWorkspace`

```ts
const SurfaceWorkspaceSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  surface_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  provider: z.enum(['copy', 'overlayfs', 'container']),
  isolation_label: z.enum(['THREADOS_SCOPED', 'HOST_ENFORCED']),
  root_path: z.string().min(1),
  status: z.enum([
    'planned',
    'materializing',
    'ready',
    'active',
    'frozen',
    'retained',
    'cleaning',
    'cleaned',
    'failed',
  ]),
  retention_policy: z.enum([
    'cleanup_on_success',
    'retain_until_applied',
    'retain_on_failure',
    'retain_always',
  ]),
  manifest_hash: z.string().nullable(),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable(),
  cleaned_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
```

## 4.7 Forward contracts created in M0 but implemented later

Create and validate minimal canonical schemas for:

- `ChangeSet`;
- `MergePlan`;
- `MergeConflict`;
- `MergeResult`.

They remain unused until Milestone 2. This prevents attempt/workspace records from needing another breaking migration when `change_set_id` and merge references become active.

---

# 5. Runtime service boundary

## 5.1 Public service contract

```ts
interface ThreadOSRuntimeService {
  startRun(request: StartRunRequest, context: RuntimeCommandContext): Promise<WorkflowRun>
  runAndWait(request: StartRunRequest, context: RuntimeCommandContext): Promise<RunProjection>
  inspectRun(runId: string): Promise<RunProjection>
  listRuns(query?: RunQuery): Promise<RunProjection[]>
  inspectAttempt(attemptId: string): Promise<AttemptProjection>
  cancelRun(runId: string, context: RuntimeCommandContext): Promise<WorkflowRun>
  cancelAttempt(attemptId: string, context: RuntimeCommandContext): Promise<StepAttempt>
  retryAttempt(attemptId: string, context: RuntimeCommandContext): Promise<StepAttempt>
  reconcile(): Promise<ReconciliationReport>
}
```

Milestone 1 extends the service with:

```ts
interface ThreadOSWorkspaceService {
  listWorkspaces(query?: WorkspaceQuery): Promise<SurfaceWorkspace[]>
  inspectWorkspace(workspaceId: string): Promise<WorkspaceProjection>
  retainWorkspace(workspaceId: string, context: RuntimeCommandContext): Promise<SurfaceWorkspace>
  cleanWorkspace(workspaceId: string, context: RuntimeCommandContext): Promise<SurfaceWorkspace>
  doctor(): Promise<WorkspaceDoctorReport>
}
```

## 5.2 Command context

```ts
interface RuntimeCommandContext {
  actor: string
  interface: 'api' | 'cli' | 'chat' | 'mcp' | 'system'
  idempotencyKey: string
  policyConfirmed: boolean
  requestId?: string
}
```

## 5.3 Service factory and lifecycle

Create a base-path-keyed singleton factory:

```ts
getThreadOSRuntimeService(basePath: string): ThreadOSRuntimeService
```

Requirements:

- one service instance per canonical workspace within the local Next.js process;
- dependency injection for tests;
- no global mutable state beyond the explicit service registry;
- repositories remain file-backed, so service recreation is safe;
- `reconcile()` runs once when a service is first created and may be called explicitly.

## 5.4 Layering rule

Allowed direction:

```text
app/api/* ─┐
seqctl/*  ─┼→ runtime/service → scheduler/executor → runner/workspaces/gates
chat/*    ─┘
```

Forbidden imports after M0:

- `app/api/run|stop|restart` importing `lib/runner/*` directly;
- `lib/seqctl/commands/run|control` importing `lib/runner/*` directly;
- route or CLI code mutating step status as a substitute for process control;
- route or CLI code creating run IDs independently of the runtime service.

---

# 6. Migration and cutover strategy

## 6.1 Migration principles

- New state is additive.
- New reads understand legacy and V2 records.
- New writes use V2 records.
- Surface-state compatibility projections continue to be updated.
- No automatic bulk migration is required for Desktop 1.0.
- Export logic includes both legacy and V2 runs with an explicit source/version field.

## 6.2 Legacy run projection

Create `LegacyRunRecordSchema` for the existing `run.json` shape and project it into:

```text
WorkflowRun.status       ← legacy status
WorkflowRun.target       ← step:<legacy step_id>
WorkflowRun.strategy     ← sequential
StepAttempt.workspace_id ← null
StepAttempt.snapshot_id  ← null
StepAttempt.status       ← mapped legacy status
ProcessRecord.provider   ← mprocs-legacy or absent
```

Projected legacy records are read-only. Any retry creates a new V2 run/attempt.

## 6.3 Thread-surface linkage

Extend existing surface/run-event types additively with optional references:

```ts
workflowRunId?: string
attemptId?: string
workspaceId?: string
snapshotId?: string
changeSetId?: string
```

During M0, new attempts write these references. Existing projections without them remain valid.

## 6.4 Cutover order

1. Land schemas.
2. Land repositories and projections.
3. Build and test the service without public callers.
4. Cut API to the service.
5. Cut CLI to the service.
6. Delete duplicated lifecycle code.
7. Introduce process-control/recovery changes.
8. Update UI and status projections.
9. Add workspace contracts and engines.
10. Bind execution to isolated workspaces.

---

# 7. Detailed pull-request specifications

## PR-01 — Canonical runtime and workspace contracts

**Branch:** `feat/runtime-contracts-v2`  
**Milestone:** 0  
**Risk:** Low  
**Purpose:** Establish the stable domain model before moving behavior.

### Create

```text
lib/runtime/schema.ts
lib/runtime/command-schema.ts
lib/runtime/error-codes.ts
lib/runtime/schema.test.ts
lib/workspaces/schema.ts
lib/workspaces/schema.test.ts
lib/changesets/schema.ts
lib/changesets/schema.test.ts
lib/merge/schema.ts
lib/merge/schema.test.ts
```

### Modify

```text
lib/contracts/schemas.ts
lib/thread-surfaces/types.ts
```

### Required changes

- Implement the contracts in Section 4.
- Re-export the new schemas from a stable barrel without replacing existing public types.
- Add optional V2 references to thread-surface run/event types.
- Add runtime error codes in `lib/runtime/error-codes.ts`:

```text
IDEMPOTENCY_CONFLICT
RUN_NOT_FOUND
ATTEMPT_NOT_FOUND
ATTEMPT_NOT_RUNNING
PROCESS_CONTROL_FAILED
PROCESS_LOST
SNAPSHOT_REQUIRED
SNAPSHOT_SOURCE_CHANGED
SNAPSHOT_SOURCE_BUSY
WORKSPACE_REQUIRED
WORKSPACE_PROVISION_FAILED
WORKSPACE_MANIFEST_INVALID
WORKSPACE_QUOTA_EXCEEDED
WORKSPACE_NOT_FOUND
WORKSPACE_NOT_CLEANABLE
```

- Reserve `lib/contracts/reason-codes.ts` for deterministic gate reasons; Milestone 1 adds snapshot/workspace gate reasons there.
- Do not alter execution behavior.

### Tests

- Every status enum accepts only canonical values.
- Run and attempt IDs are distinct and both required.
- `workspace_id` and `baseline_snapshot_id` are nullable for legacy projections.
- `HOST_ENFORCED` is valid as a contract but not emitted by the copy provider.
- Forward Change Set and merge contracts validate representative examples.
- Thread-surface legacy objects still normalize.

### Validation

```bash
bun test lib/runtime/schema.test.ts \
  lib/workspaces/schema.test.ts \
  lib/changesets/schema.test.ts \
  lib/merge/schema.test.ts \
  lib/contracts/schemas.test.ts
bun run typecheck
bun run lint
```

### Exit gate

All contracts are stable and no existing runtime or UI test regresses.

---

## PR-02 — Atomic runtime repositories and idempotency

**Branch:** `feat/runtime-repositories-v2`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/runtime/paths.ts
lib/runtime/run-repository.ts
lib/runtime/attempt-repository.ts
lib/runtime/process-repository.ts
lib/runtime/command-repository.ts
lib/runtime/runtime-index.ts
lib/runtime/legacy-projection.ts
lib/runtime/repositories.test.ts
lib/runtime/legacy-projection.test.ts
```

### Modify

```text
lib/fs/atomic.ts
lib/thread-surfaces/repository.ts
lib/runner/artifacts.ts
lib/exports/bundler.ts
```

### Required changes

- Add typed path builders. Validate all IDs before using them in paths.
- Persist run, attempt, process, and command records with atomic writes.
- Use optimistic revision checks equivalent to the current thread-surface repository.
- Maintain `.threados/state/runtime-index.json` as a derived lookup index, not authoritative state.
- Implement command-receipt lookup by idempotency key.
- Implement `LegacyRunRecordSchema` and non-destructive projection.
- Extend export discovery so V2 attempts are visible, while keeping legacy bundles valid.
- Do not write the same `run.json` once per step. One workflow run owns one file.

### Repository API

```ts
interface RunRepository {
  create(run: WorkflowRun): Promise<void>
  get(runId: string): Promise<WorkflowRun | null>
  update(runId: string, expectedRevision: number, mutate: RunMutation): Promise<WorkflowRun>
  list(query?: RunQuery): Promise<WorkflowRun[]>
}

interface AttemptRepository {
  create(attempt: StepAttempt): Promise<void>
  get(attemptId: string): Promise<StepAttempt | null>
  listForRun(runId: string): Promise<StepAttempt[]>
  update(attemptId: string, expectedRevision: number, mutate: AttemptMutation): Promise<StepAttempt>
}
```

### Tests

- Concurrent revision mismatch fails closed.
- Atomic write failure leaves the prior valid file intact.
- Two attempts do not overwrite one run record.
- Replayed command returns its original result reference.
- Reused idempotency key with changed payload is rejected.
- Malicious run/attempt IDs cannot escape `.threados/runs`.
- Legacy run records project without being rewritten.
- Derived index can be deleted and rebuilt from authoritative records.

### Validation

```bash
bun test lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
bun run typecheck
bun run lint
```

### Exit gate

A fixture can create one run with two attempts, reopen fresh repository instances, and reconstruct the same state.

---

## PR-03 — Shared runtime service and sequential scheduler

**Branch:** `feat/runtime-service-v2`  
**Milestone:** 0  
**Risk:** High

### Create

```text
lib/runtime/service-types.ts
lib/runtime/service.ts
lib/runtime/factory.ts
lib/runtime/scheduler.ts
lib/runtime/attempt-executor.ts
lib/runtime/lifecycle.ts
lib/runtime/errors.ts
lib/runtime/projections.ts
lib/runtime/service.test.ts
lib/runtime/attempt-executor.test.ts
```

### Modify

```text
lib/runner/artifacts.ts
lib/thread-surfaces/step-run-runtime.ts
lib/thread-surfaces/mutations.ts
lib/gates/engine.ts
lib/approvals/runtime.ts
lib/traces/writer.ts
```

### Required changes

- Extract the richer lifecycle currently embedded in `app/api/run/route.ts` into `ThreadOSRuntimeService` and `AttemptExecutor`.
- Preserve:
  - sequence read and DAG validation;
  - prompt existence and compilation;
  - policy evaluation;
  - approval lookup;
  - deterministic pre-run gates;
  - gate-decision persistence;
  - run and attempt persistence;
  - artifact persistence;
  - completion gates;
  - surface-run finalization;
  - runtime delegation events;
  - traces and audit hooks.
- Implement a scheduler with `maxConcurrency = 1`. This is intentional for M0.
- Persist run and attempt before dispatch.
- Persist a planned process record before spawn.
- Expose `runAndWait()` for compatibility callers.
- Keep provider launch construction in `lib/runner/dispatch.ts`.
- Keep the current execution path available only as an internal compatibility adapter until PR-05.

### Lifecycle transitions

```text
run: pending → provisioning → running → successful|failed|cancelled|interrupted
attempt: pending → provisioning → running → completed|needs_review|failed|cancelled|timed_out|interrupted
process: planned → starting → running → terminating|exited|lost
```

Invalid transitions throw `INVALID_RUNTIME_TRANSITION` and do not write partial state.

### Tests

- One successful mock attempt produces a V2 run, attempt, process, gates, trace, and artifacts.
- A blocked pre-run gate never spawns a process.
- A completion-gate failure produces `needs_review` or `failed` according to policy.
- A duplicate `startRun` command is idempotent.
- Failure after run creation but before spawn remains recoverable.
- Surface-run projections are updated once.
- Provider adapters remain mockable through service dependencies.

### Validation

```bash
bun test lib/runtime/service.test.ts \
  lib/runtime/attempt-executor.test.ts \
  lib/gates/engine.test.ts \
  lib/gates/rules.test.ts \
  test/api/runtime-persistence-proof.test.ts
bun run typecheck
bun run lint
```

### Exit gate

The service completes one sequential mock attempt without invoking an API or CLI handler.

---

## PR-04 — API cutover to the shared runtime service

**Branch:** `refactor/api-runtime-service`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/api/runtime-request.ts
app/api/runs/route.ts
app/api/runs/[runId]/route.ts
app/api/runs/[runId]/cancel/route.ts
app/api/attempts/[attemptId]/route.ts
app/api/attempts/[attemptId]/cancel/route.ts
app/api/attempts/[attemptId]/retry/route.ts
test/api/runtime-v2-routes.test.ts
```

### Modify

```text
app/api/run/route.ts
app/api/stop/route.ts
app/api/restart/route.ts
app/api/status/route.ts
lib/api-helpers.ts
```

### Required changes

- Reduce compatibility routes to:
  1. request parsing;
  2. session authorization;
  3. rate limiting;
  4. idempotency-key resolution;
  5. service invocation;
  6. typed response mapping.
- `POST /api/run` remains compatible and calls `runAndWait()`.
- `POST /api/runs` accepts a canonical start request and returns `202` with the run projection.
- `POST /api/stop` maps a step ID to its active attempt, then calls `cancelAttempt`.
- `POST /api/restart` retries the latest terminal attempt for the step; it never flips status directly.
- Return stable error codes and HTTP mappings.
- Accept `Idempotency-Key`; generate and return one when absent for local UI compatibility.
- Remove direct runner, surface mutation, and gate lifecycle imports from the route layer.

### Tests

- Existing `/api/run` behavior remains compatible.
- Resource routes return canonical V2 projections.
- Stop on a non-running step returns `409 ATTEMPT_NOT_RUNNING`.
- Retry returns a new attempt ID and `retry_of_attempt_id`.
- Identical API and direct-service requests produce equivalent persisted state.
- Route replay with the same idempotency key does not spawn twice.

### Validation

```bash
bun test test/api/runtime-v2-routes.test.ts \
  test/api/run-route-coverage.test.ts \
  test/api/runtime-persistence-proof.test.ts \
  test/api/thread-run-lifecycle.test.ts \
  test/api/routes.test.ts
bun run typecheck
bun run lint
```

### Exit gate

All app-side execution and control routes use the shared service. `app/api/run/route.ts` contains no execution lifecycle implementation.

---

## PR-05 — CLI cutover and stable runtime JSON

**Branch:** `refactor/cli-runtime-service`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/seqctl/commands/attempt.ts
lib/seqctl/formatters/runtime.ts
lib/seqctl/runtime-json-schema.ts
lib/seqctl/commands/attempt.test.ts
lib/seqctl/runtime-parity.test.ts
```

### Modify

```text
lib/seqctl/index.ts
lib/seqctl/commands/run.ts
lib/seqctl/commands/control.ts
lib/seqctl/commands/status.ts
lib/seqctl/commands/group.ts
lib/seqctl/commands/mprocs.ts
```

### Required changes

- Replace CLI lifecycle implementation with runtime-service calls.
- Preserve existing commands:

```text
thread run step <stepId>
thread run runnable
thread run group <groupId>
thread stop <stepId>
thread restart <stepId>
thread status
```

- Add:

```text
thread run list
thread run inspect <runId>
thread run cancel <runId>
thread attempt inspect <attemptId>
thread attempt cancel <attemptId>
thread attempt retry <attemptId>
```

- `thread restart <stepId>` becomes a compatibility alias for retrying the latest eligible attempt.
- Remove `updateStepProcess()` calls after a completed direct process.
- `mprocs` commands remain available as optional observer/legacy controls but do not update canonical V2 status.
- Version JSON output:

```json
{
  "schemaVersion": 1,
  "success": true,
  "data": {}
}
```

- Non-zero exit for blocked, approval-required, unavailable, cancelled, conflicted, or failed operations.

### Tests

- CLI and API fixture requests produce the same run/attempt states.
- `thread stop` cannot report success if the process controller failed.
- `thread restart` creates new attempt lineage.
- Every added command supports `--json`.
- Existing human-readable commands remain usable.
- CLI handlers no longer import `runner/wrapper`, `runner/dispatch`, or artifact lifecycle functions.

### Validation

```bash
bun test lib/seqctl/runtime-parity.test.ts \
  lib/seqctl/commands/attempt.test.ts \
  lib/seqctl/commands/run.test.ts \
  lib/seqctl/commands/control.test.ts \
  test/integration/cli-flow.test.ts
bun run typecheck
bun run lint
```

### Exit gate

One step run started through CLI and one started through API produce the same canonical file tree and equivalent projections.

---

## PR-06 — Truthful process control, retry, and recovery

**Branch:** `feat/truthful-process-control`  
**Milestone:** 0  
**Risk:** High

### Create

```text
lib/runner/process-handle.ts
lib/runtime/process-controller.ts
lib/runtime/recovery.ts
lib/runtime/process-controller.test.ts
lib/runtime/recovery.test.ts
test/fixtures/process/long-running.mjs
test/fixtures/process/exit-with-code.mjs
test/fixtures/process/write-heartbeat.mjs
```

### Modify

```text
lib/runner/wrapper.ts
lib/runtime/attempt-executor.ts
lib/runtime/service.ts
lib/reconciliation/reconciler.ts
lib/mprocs/state.ts
app/api/stop/route.ts
app/api/restart/route.ts
lib/seqctl/commands/control.ts
```

### Required changes

Refactor the runner to expose:

```ts
interface RunningProcessHandle {
  processId: string
  pid: number | null
  result: Promise<RawProcessResult>
  cancel(signal?: 'SIGTERM' | 'SIGKILL'): Promise<ProcessControlResult>
}

startProcess(config: RunnerConfig): Promise<RunningProcessHandle>
runStep(config: RunnerConfig): Promise<RunResult> // compatibility wrapper
```

- Persist process record before calling `spawn`.
- Update PID/status immediately after successful spawn.
- Stream heartbeat/output timestamps into the process record using throttled writes.
- Cancel sends graceful termination, waits a bounded interval, then escalates.
- Success requires process exit or a truthful `PROCESS_CONTROL_FAILED` result.
- Recovery on service startup:
  - inspect persisted `starting`, `running`, and `terminating` records;
  - test PID existence where supported;
  - because stdout/stderr cannot be safely reattached after server restart, mark the attempt `interrupted` and process `lost`;
  - optionally terminate a still-live orphan according to policy;
  - retain artifacts/workspace references;
  - never leave stale `running` state.
- Retry always creates a new attempt and process record.
- Keep legacy mprocs reconciliation for legacy runs only.

### Tests

- Cancel terminates a real fixture process.
- Failed kill returns non-success and does not claim cancellation.
- Timeout escalates and records `timed_out`.
- Startup reconciliation marks an unattachable process `interrupted`.
- Retry links to the prior attempt and starts from a clean lifecycle.
- Process arguments are redacted before persistence.
- Output/heartbeat writes are bounded and do not rewrite state per byte.

### Validation

```bash
bun test lib/runtime/process-controller.test.ts \
  lib/runtime/recovery.test.ts \
  lib/runner/wrapper.test.ts \
  lib/reconciliation/reconciler.test.ts \
  test/api/thread-run-lifecycle.test.ts
bun run typecheck
bun run lint
```

### Exit gate

The app and CLI can stop a real long-running fixture, retry it as a new attempt, and recover truthfully after simulated service restart.

---

## PR-07 — Runtime projections, operator controls, and M0 proof

**Branch:** `feat/runtime-operator-projections`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
app/api/runs/[runId]/attempts/route.ts
lib/runtime/projections.test.ts
test/architecture/runtime-service-boundary.test.ts
test/integration/runtime-interface-parity.test.ts
components/workbench/sections/RunSection.runtime.test.tsx
```

### Modify

```text
lib/runtime/projections.ts
lib/ui/api.ts
components/workbench/sections/RunSection.tsx
components/lanes/useLaneBoard.ts
components/inspector/ThreadSurfaceInspector.tsx
app/api/thread-runs/route.ts
app/api/status/route.ts
```

### Required changes

- Add hooks:

```text
useRuns
useRun
useRunAttempts
useAttempt
useCancelRun
useCancelAttempt
useRetryAttempt
```

- Enable real Stop/Cancel and Retry buttons.
- Display workflow-run ID separately from attempt ID.
- Display process state and interruption/lost state truthfully.
- Keep sequence status cards but source active execution state from runtime projections.
- Add an architecture test that fails if API or CLI lifecycle files import direct runner/process modules.
- Add a state-tree parity proof between API and CLI.
- Update current-state and architecture documentation.

### Tests

- Buttons invoke canonical resource APIs.
- Control buttons enable only for valid transitions.
- Failed controls display typed error and do not optimistically flip status.
- Legacy runs remain visible with a `legacy` badge/source.
- Architecture boundary scan passes.
- Full V1 runtime persistence proof remains green.

### Validation

```bash
bun test lib/runtime/projections.test.ts \
  test/architecture/runtime-service-boundary.test.ts \
  test/integration/runtime-interface-parity.test.ts \
  components/workbench/sections/RunSection.runtime.test.tsx \
  components/workbench/sections/RunSection.test.tsx
bun run check
bun run build
```

### M0 exit gate

- API and CLI use one runtime service.
- One sequential attempt produces identical canonical state through either interface.
- Stop and retry control real process state.
- Recovery eliminates stale-running attempts.
- No direct execution lifecycle remains in route or CLI handlers.

**Sequencing clarification:** filesystem-isolated execution is proven at the combined M0+M1 gate. M0 alone is not released or marketed as isolated parallel execution.

---

## PR-08 — Workspace configuration, external paths, and exclusions

**Branch:** `feat/workspace-config-paths`  
**Milestone:** 1  
**Risk:** Medium

### Create

```text
lib/workspaces/config-schema.ts
lib/workspaces/config.ts
lib/workspaces/paths.ts
lib/workspaces/exclusions.ts
lib/workspaces/repository.ts
lib/workspaces/config.test.ts
lib/workspaces/paths.test.ts
lib/workspaces/exclusions.test.ts
```

### Modify

```text
package.json
lib/local-first/types.ts
lib/local-first/workspace.ts
app/api/desktop/workspace/route.ts
lib/policy/schema.ts
```

### Dependency

Add the small `ignore` package for deterministic Gitignore-style pattern evaluation. Do not depend on Git itself.

### `.threados/workspace.yaml`

```yaml
version: 1
provider: auto
runtime_data_root: null
snapshot:
  exclusions:
    - .git/
    - .threados/
    - node_modules/
    - .next/
    - dist/
    - build/
    - coverage/
    - .venv/
    - venv/
    - target/
    - __pycache__/
  include_untracked: true
  max_source_retries: 3
workspace:
  retention: retain_on_failure
  max_active: 5
  max_bytes_each: 5368709120
  max_total_retained_bytes: 21474836480
  max_files: 250000
bootstrap: []
validate: []
```

### Path rules

- Windows default: `%LOCALAPPDATA%\thredOS\runtime`.
- Linux/WSL default: `$XDG_DATA_HOME/thredos` or `~/.local/share/thredos`.
- Runtime root must be outside the canonical project.
- Resolve and compare real paths before accepting overrides.
- Never place runtime copies under `.threados/`.
- Use the existing local workspace ID as the namespace.

### Exclusion precedence

```text
built-in defaults
→ workspace.yaml snapshot.exclusions
→ .threadosignore
→ explicit required includes
```

Required includes such as lockfiles remain included unless the user explicitly excludes them.

### Tests

- Windows, Linux, and WSL path resolution.
- Override inside the project root is rejected.
- `.threadosignore` negation and directory rules.
- `.git`, `.threados`, and sibling runtime roots are always excluded.
- Non-Git project configuration loads.
- Missing config produces safe defaults.

### Validation

```bash
bun test lib/workspaces/config.test.ts \
  lib/workspaces/paths.test.ts \
  lib/workspaces/exclusions.test.ts \
  lib/local-first/workspace.test.ts \
  lib/policy/engine.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Every local workspace resolves one safe external runtime root and one deterministic exclusion policy hash.

---

## PR-09 — Immutable baseline snapshot engine

**Branch:** `feat/immutable-snapshot-engine`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/workspaces/manifest.ts
lib/workspaces/hash.ts
lib/workspaces/snapshot.ts
lib/workspaces/snapshot-repository.ts
lib/workspaces/snapshot.test.ts
lib/workspaces/manifest.test.ts
lib/workspaces/hash.test.ts
lib/workspaces/snapshot-repository.test.ts
test/fixtures/workspaces/snapshot-project/
test/integration/snapshot-dirty-git.test.ts
test/integration/snapshot-non-git.test.ts
```

### Modify

```text
lib/workspaces/schema.ts
lib/traces/writer.ts
lib/traces/writer.test.ts
lib/security/safe-io.ts
lib/security/safe-io.test.ts
lib/contracts/schemas.ts
lib/contracts/schemas.test.ts
lib/fs/atomic.ts
lib/fs/atomic.test.ts
package.json
lib/workspaces/schema.test.ts
```

### Snapshot algorithm

1. Resolve canonical root and external snapshot staging directory.
2. Load exclusions and compute policy hash.
3. Walk the source without following symlinks.
4. Reject or record symlinks escaping the source root.
5. Capture a sorted discovery list with type, size, mode, mtime, and platform identity where available.
6. Copy each included file into a temporary snapshot tree using independent file copies, not hardlinks.
7. Hash copied bytes and record manifest entries.
8. Re-stat source entries after copy.
9. Detect added, removed, or changed files during capture.
10. Retry the entire capture up to `max_source_retries`.
11. Compute a deterministic root manifest hash over sorted normalized entries.
12. Atomically rename the temporary snapshot directory into its final content-addressed location.
13. Persist the project-local snapshot reference and append trace events.

Project-local snapshot records use an atomic generation plus commit-pointer layout. `manifest.json` is the stable dereferenceable manifest reference; `current.json` selects one complete metadata/manifest generation so readers never observe a half-published pair. External snapshot bytes remain content-addressed under the resolved runtime data root.

### Required behavior

- Dirty and untracked files are captured by content.
- Git metadata is best-effort only:
  - `HEAD` if available;
  - dirty state if available;
  - no failure when Git is absent.
- Snapshot content is immutable after `ready`.
- Two attempts in one group reference the same snapshot ID and manifest hash.
- Reuse an already verified identical snapshot within the same workflow run.
- Never include `.threados` runtime state.

### Tests

- Clean Git project.
- Dirty Git project with modified and untracked files.
- Non-Git directory.
- Binary file.
- Executable mode where supported.
- Internal symlink retained as symlink metadata.
- Escaping symlink blocked.
- File changes during snapshot trigger retry/failure.
- Root hash is stable across traversal order.
- `.threados` and runtime root are absent from the snapshot.
- Snapshot tree contains independent files, not hardlinks.

### Validation

```bash
bun test lib/workspaces/snapshot.test.ts \
  lib/workspaces/manifest.test.ts \
  test/integration/snapshot-dirty-git.test.ts \
  test/integration/snapshot-non-git.test.ts
bun run typecheck
bun run lint
```

### Exit gate

A dirty project and a non-Git project each produce a verified immutable snapshot with deterministic manifest hash.

---

## PR-10 — Portable copy provider and workspace manager

**Branch:** `feat/copy-workspace-provider`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/workspaces/providers/provider.ts
lib/workspaces/providers/copy.ts
lib/workspaces/providers/copy.test.ts
lib/workspaces/manager.ts
lib/workspaces/quotas.ts
lib/workspaces/retention.ts
lib/workspaces/doctor.ts
lib/workspaces/doctor.test.ts
lib/workspaces/manager.test.ts
lib/workspaces/quotas.test.ts
lib/workspaces/retention.test.ts
```

### Modify

```text
lib/workspaces/repository.ts
lib/workspaces/repository.test.ts
lib/workspaces/schema.ts
lib/workspaces/schema.test.ts
lib/runtime/attempt-repository.ts
lib/runtime/paths.ts
lib/runtime/repositories.test.ts
lib/contracts/schemas.ts
lib/contracts/schemas.test.ts
```

### Provider contract

```ts
interface SurfaceWorkspaceProvider {
  id: 'copy' | 'overlayfs' | 'container'
  capabilities(): WorkspaceProviderCapabilities
  provision(request: ProvisionWorkspaceRequest): Promise<SurfaceWorkspace>
  inspect(workspaceId: string): Promise<SurfaceWorkspaceState>
  freeze(workspaceId: string): Promise<SurfaceWorkspace>
  destroy(workspaceId: string): Promise<void>
}
```

### Copy-provider requirements

- Source is the immutable snapshot tree, not the live canonical project.
- Materialize into a temporary workspace path, verify, then atomically promote.
- Use independent file copies; no hardlinks or symlink escapes.
- Preserve allowed mode metadata.
- Do not copy snapshot control metadata into the agent-visible tree.
- Verify final tree against the snapshot manifest before setting `ready`.
- Emit `THREADOS_SCOPED`.
- On partial failure, clean the temp directory and persist a failed workspace record.
- Enforce file count, per-workspace bytes, active count, and retained-byte quotas before and during materialization.

### Retention behavior

| Outcome | Default behavior |
|---|---|
| Successful, no review/apply dependency yet | Retain until later Change Set capture is available |
| Failed | Retain |
| Needs review | Retain |
| Interrupted | Retain |
| Cancelled before agent writes | Clean if verification proves no useful output |
| User-selected `retain_always` | Retain |

Because Change Sets arrive in Milestone 2, M1 must not auto-delete successful write workspaces immediately.

Workspace quota reservation is persisted on the planned workspace record and created under the same repository lock as the quota precondition. Canonical per-workspace records are authoritative after an atomic legacy-index migration; `index.json` remains rebuildable projection data. Attempt linkage is persisted separately as an exact, path-safe `workspace.ref.json` without dispatching the attempt in PR-10.

The repository check discovers exact test-file paths and executes each file in its own short Bun process because legacy tests intentionally mutate process-global hooks, environment state, and module mocks. Exact-file process isolation avoids cross-file interference and a confirmed long-process panic in Bun 1.3.7. Focused suites remain parallelizable in separate processes; the canonical aggregate favors deterministic evidence over unsafe cross-file interference.

### Tests

- Two workspace provisions from one snapshot produce different roots and identical manifest hashes.
- Modifying workspace A does not change snapshot or workspace B.
- Modifying workspace A does not change canonical project.
- Quota rejection occurs before agent dispatch.
- Partial copy is cleaned.
- Retained-byte accounting is rebuilt from records if index is lost.
- Destroy refuses an active workspace.
- Doctor detects missing tree, invalid manifest, and orphaned directory.

### Validation

```bash
bun test lib/workspaces/providers/copy.test.ts \
  lib/workspaces/manager.test.ts \
  lib/workspaces/quotas.test.ts \
  lib/workspaces/retention.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Two verified, independent workspaces materialize from one snapshot without any Git operation.

---

## PR-11 — Bind attempts to isolated workspaces

**Branch:** `feat/isolated-attempt-dispatch`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/runtime/workspace-planner.ts
lib/runtime/workspace-planner.test.ts
lib/workspaces/bootstrap.ts
lib/workspaces/bootstrap.test.ts
test/integration/isolated-attempt-dispatch.test.ts
test/integration/canonical-workspace-unchanged.test.ts
test/integration/two-identical-baselines.test.ts
```

### Modify

```text
lib/runtime/service.ts
lib/runtime/scheduler.ts
lib/runtime/attempt-executor.ts
lib/runtime/projections.ts
lib/runner/dispatch.ts
lib/runner/wrapper.ts
lib/runner/prompt-compiler.ts
lib/runner/artifacts.ts
lib/gates/engine.ts
lib/gates/rules.ts
lib/contracts/schemas.ts
lib/contracts/reason-codes.ts
lib/policy/schema.ts
lib/sequence/schema.ts
lib/seqctl/commands/step.ts
app/api/step/route.ts
lib/thread-surfaces/step-run-runtime.ts
lib/traces/writer.ts
```

### Workspace-selection policy

```text
side_effect_class none/read:
  existing canonical read path remains allowed in M1 unless explicitly isolated

side_effect_class write/execute:
  isolated workspace required

parallel-group write/execute:
  isolated workspace mandatory; no override to canonical cwd
```

Compatibility classification for legacy steps that do not explicitly carry `side_effect_class`:

```text
shell                         → execute
claude-code, codex, gemini    → write
unknown external agent model → write unless the registered adapter declares read-only
```

Explicit user configuration wins, but a write-capable provider may never be downgraded to `none` merely because an older sequence omitted the field. Extend step creation/edit APIs and CLI with `--side-effect none|read|write|execute` and `--workspace isolated|auto`.

For M1 tests and the canonical vertical slice, use `workspace_mode: isolated` explicitly for all write-capable attempts.

### Required lifecycle

```text
create workflow run
→ create/reuse immutable snapshot
→ create attempt in provisioning
→ plan workspace
→ persist workspace record
→ provision and verify workspace
→ bind attempt.workspace_id and snapshot_id
→ compile prompt with workspace-safe context
→ dispatch agent with cwd = workspace.root_path
→ persist process and run
→ retain/freeze workspace on completion
→ update surfaces, gates, traces, and artifacts
```

### Gate additions

Add deterministic gate types:

```text
snapshot_present
snapshot_verified
workspace_present
workspace_ready
workspace_manifest_verified
```

Gate evidence references point to snapshot/workspace manifests, not free text.

### Bootstrap requirements

- Run configured bootstrap commands inside the verified Surface Workspace before agent dispatch.
- Evaluate each command through the existing policy engine.
- Persist command, redacted output, duration, and exit result in the attempt artifacts.
- A bootstrap failure blocks agent spawn with `WORKSPACE_BOOTSTRAP_FAILED`.
- Bootstrap never runs in the canonical workspace.

### Canonical protection

- Capture a lightweight canonical pre-dispatch manifest hash.
- Recheck after each isolated attempt.
- If thredOS itself changed the canonical tree unexpectedly, fail the run with `CANONICAL_WORKSPACE_MUTATED`.
- User edits are allowed and recorded as a changed canonical precondition for future Milestone 2 merge logic; they are not overwritten.
- Do not expose the canonical root as writable `cwd` or an environment variable to the agent.

### Prompt and environment rules

- `THREADOS_WORKSPACE_ID`, `THREADOS_SNAPSHOT_ID`, `THREADOS_ATTEMPT_ID`, and existing run/step IDs are injected.
- `THREADOS_BASE_PATH` is not passed to isolated agents unless a future host-enforced tool gateway requires a non-write reference. The runner must support an explicit inherited-environment denylist because its current `THREADOS_*` inheritance would otherwise reintroduce the canonical path.
- Project file-tree and dependency artifacts used by prompt compilation must be sourced from the snapshot/workspace context, not sibling workspaces.
- Sealed surfaces receive no sibling semantic artifacts.

### Tests

- Runner receives workspace path, not canonical base path.
- Two attempts reference the same snapshot and different workspace IDs.
- An agent fixture writing files changes only its workspace.
- The canonical project remains byte-identical when the user makes no edits.
- User edits made after launch survive.
- A missing/invalid workspace gate prevents spawn.
- Sealed sibling workspace paths are not present in prompt or environment.
- `isolation_label` is `THREADOS_SCOPED`.
- No Git repository is required.

### Validation

```bash
bun test lib/runtime/workspace-planner.test.ts \
  lib/workspaces/bootstrap.test.ts \
  test/integration/isolated-attempt-dispatch.test.ts \
  test/integration/canonical-workspace-unchanged.test.ts \
  test/integration/two-identical-baselines.test.ts \
  test/api/runtime-persistence-proof.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Two representative write attempts can run from the same immutable snapshot in separate workspaces, and the canonical project remains unchanged.

---

## PR-12 — Workspace API, CLI, UI, doctor, and M1 release proof

**Branch:** `feat/workspace-operator-surface`  
**Milestone:** 1  
**Risk:** Medium

### Create

```text
app/api/workspaces/route.ts
app/api/workspaces/[workspaceId]/route.ts
app/api/workspaces/[workspaceId]/retain/route.ts
app/api/workspaces/[workspaceId]/clean/route.ts
app/api/workspaces/doctor/route.ts
lib/seqctl/commands/workspace.ts
lib/seqctl/commands/workspace.test.ts
components/inspector/WorkspaceInspector.tsx
components/inspector/WorkspaceInspector.test.tsx
test/architecture/no-git-worktree-runtime.test.ts
test/integration/m1-workspace-release-proof.test.ts
test/ui/workspace-inspector.e2e.ts
scripts/verify/m1-workspace-proof.mjs
```

### Modify

```text
lib/seqctl/index.ts
lib/ui/api.ts
components/workbench/sections/RunSection.tsx
components/inspector/ThreadSurfaceInspector.tsx
components/inspector/StepInspector.tsx
components/command/CreateNodeDialog.tsx
components/lanes/useLaneBoard.ts
app/api/thread-surfaces/route.ts
app/api/thread-runs/route.ts
lib/exports/bundler.ts
package.json
README.md
docs/cli-reference.md
docs/product/current-state.md
docs/product/architecture-map.md
docs/launch/desktop-release-checklist.md
```

### CLI commands

```text
thread workspace list [--run <runId>]
thread workspace inspect <workspaceId>
thread workspace retain <workspaceId>
thread workspace clean <workspaceId>
thread workspace doctor
```

All commands support `--json` and use the shared workspace/runtime service.

### UI requirements

Workspace inspector displays:

- workspace ID;
- run and attempt IDs;
- surface and step;
- snapshot ID and root hash;
- provider;
- truthful isolation label;
- external root path;
- status;
- file count and bytes;
- retention policy;
- verification state;
- bootstrap result where present;
- retain and clean controls;
- diagnostic errors.

The Run section must show the workspace attached to each attempt and link to the inspector.

### Export requirements

M1 export adds:

- workflow-run record;
- attempt records;
- process records;
- snapshot references and manifests;
- workspace records and manifest hashes;
- isolation labels;
- workspace gate decisions;
- no external workspace file content unless explicitly included by export policy.

### No-worktree guard

The architecture test scans production runtime locations:

```text
app/
lib/
desktop/
scripts/
```

It fails on executable construction or process invocation of:

```text
git worktree
git.exe worktree
worktree add
worktree remove
```

Documentation may discuss worktrees only to state they are not required.

### Release-proof scenario

1. Create a dirty Git fixture and a non-Git fixture.
2. Create one workflow run with two write attempts.
3. Capture one immutable snapshot.
4. Provision two copy workspaces.
5. Run two deterministic fixture agents that write different outputs through the M0 sequential scheduler; concurrent dispatch is activated in Milestone 3.
6. Verify the same snapshot ID and different workspace IDs.
7. Verify canonical project hash is unchanged.
8. Stop and retry one long-running fixture through both API and CLI paths.
9. Restart service and reconcile an interrupted fixture.
10. Inspect workspaces through API, CLI, and UI.
11. Retain one and clean the other.
12. Export the evidence bundle.
13. Prove no Git worktree command was executed.

### Validation

```bash
bun test test/architecture/no-git-worktree-runtime.test.ts \
  test/integration/m1-workspace-release-proof.test.ts \
  lib/seqctl/commands/workspace.test.ts \
  components/inspector/WorkspaceInspector.test.tsx
bun run check
bun run build
bun test:ui
bun run verify:local
node scripts/verify/m1-workspace-proof.mjs
```

### M1 exit gate

- One immutable baseline is reused by at least two independent Surface Workspaces.
- Attempts run with isolated workspace `cwd` values.
- Canonical workspace remains unchanged by agents.
- Dirty Git and non-Git fixtures pass.
- App and CLI expose the same workspace state and controls.
- No production runtime invokes Git worktrees.
- Export contains snapshot, attempt, process, workspace, gate, approval, and trace evidence.

---

# 8. Cross-cutting test strategy

## 8.1 Unit-test suites

```text
lib/runtime/*
lib/workspaces/*
lib/runner/*
lib/gates/*
lib/approvals/*
lib/thread-surfaces/*
lib/seqctl/*
```

Required themes:

- schema validation;
- state-transition legality;
- optimistic concurrency;
- path containment;
- idempotency;
- exclusion matching;
- manifest determinism;
- quota accounting;
- retention decisions;
- process cancellation;
- recovery mapping;
- compatibility projection.

## 8.2 Integration-test matrix

| Case | M0 | M1 |
|---|---:|---:|
| API/CLI state parity | Required | Required |
| One run with multiple attempts | Required | Required |
| Stop real process | Required | Required |
| Retry lineage | Required | Required |
| Service restart reconciliation | Required | Required |
| Dirty Git snapshot | — | Required |
| Non-Git snapshot | — | Required |
| Same baseline, separate workspaces | — | Required |
| Canonical unchanged | — | Required |
| Symlink escape | — | Required |
| Workspace quota failure | — | Required |
| No-worktree static/runtime proof | Guard | Required |

## 8.3 Architecture tests

Automated source checks must assert:

- routes do not import runner/process lifecycle modules;
- CLI handlers do not import runner/process lifecycle modules;
- only runtime service/scheduler controls status transitions for V2 attempts;
- no production worktree invocation;
- mprocs state is not imported by V2 service as authoritative state;
- workspace provider never resolves under canonical root;
- copy provider does not use hardlink APIs.

## 8.4 Windows and WSL2 coverage

At minimum:

- path-normalization unit tests for drive letters, UNC-like paths, `/mnt/<drive>`, case differences, and separators;
- process termination tests on Windows CI or release machine;
- workspace root outside the source checkout;
- locked-file cleanup behavior;
- long-path diagnostic output;
- WSL-mounted source with runtime tree on native Linux filesystem.

---

# 9. Validation command policy

Every PR:

```bash
bun run typecheck
bun run lint
<targeted bun test commands>
```

Every milestone close:

```bash
bun run check
bun run build
bun test:ui
bun run verify:local
```

Before Desktop 1.0 release:

```bash
bun run desktop:build
bun run verify:release-live
```

A PR description must state:

```text
Tested:
- exact commands and outcomes

Not tested:
- anything not executed

Migration:
- state/files affected

Rollback:
- how to return to prior behavior without losing generated data
```

---

# 10. Rollback strategy

## 10.1 Code rollback

- PR-01/02 are additive and can be reverted without deleting generated files.
- After API/CLI cutover, reverting code may leave V2 records on disk; legacy readers must ignore unknown directories safely.
- Never roll back by deleting `.threados/runs`, snapshots, or external workspaces.

## 10.2 Runtime rollback

If a runtime defect is found before M1 closes:

1. stop new run creation;
2. cancel or mark current attempts interrupted truthfully;
3. retain external workspace directories;
4. export run evidence;
5. revert the responsible PR;
6. continue reading V2 records through compatibility projections;
7. do not resume V2 attempts through legacy direct execution.

## 10.3 Snapshot/workspace rollback

- Failed snapshot/workspace staging directories are safe to remove after record verification.
- Ready or active workspaces are retained until the operator or cleanup policy explicitly resolves them.
- Workspace cleanup is idempotent.

---

# 11. Milestone acceptance evidence

## 11.1 Milestone 0 evidence bundle

```text
m0-proof/
├── api-run-tree.txt
├── cli-run-tree.txt
├── parity.json
├── process-cancel.json
├── retry-lineage.json
├── recovery-report.json
├── architecture-boundary-report.json
├── test-results.txt
└── build-results.txt
```

Required proof:

- same service and record schemas through API and CLI;
- no duplicate process on idempotent replay;
- real cancellation;
- new retry attempt ID;
- interrupted recovery;
- route/CLI boundary scan.

## 11.2 Milestone 1 evidence bundle

```text
m1-proof/
├── snapshot.json
├── snapshot-manifest.json
├── workspace-a.json
├── workspace-b.json
├── canonical-before.manifest.json
├── canonical-after.manifest.json
├── isolation-proof.json
├── dirty-git-proof.json
├── non-git-proof.json
├── no-worktree-report.json
├── export-bundle.json
├── test-results.txt
└── ui-proof/
```

Required proof:

- same snapshot ID and root hash;
- distinct workspace roots;
- no canonical agent mutation;
- no worktree invocation;
- truthful `THREADOS_SCOPED` label;
- inspect/retain/clean through UI and CLI.

---

# 12. Requirement-to-PR traceability

| Requirement | PRs |
|---|---|
| FR-RUNTIME-001 shared service | 03, 04, 05, 07 |
| FR-RUNTIME-002 canonical methods | 03, 04, 05 |
| FR-RUNTIME-003 state transitions | 01, 02, 03 |
| FR-RUNTIME-004 idempotency | 01, 02, 03, 04, 05 |
| FR-RUN-001 separate run/attempt | 01, 02, 03 |
| FR-RUN-002 attempt identity | 01, 02, 03, 11 |
| FR-RUN-003 status model | 01, 03, 06 |
| FR-RUN-004 atomic persistence | 02 |
| FR-SNAPSHOT-001 immutable baseline | 08, 09 |
| FR-SNAPSHOT-002 dirty/untracked | 09, 12 |
| FR-SNAPSHOT-003 exclusions | 08, 09 |
| FR-SNAPSHOT-004 symlink safety | 09 |
| FR-SNAPSHOT-005 snapshot reuse | 09, 11 |
| FR-WORKSPACE-001 private workspace | 10, 11 |
| FR-WORKSPACE-002 copy provider | 10 |
| FR-WORKSPACE-003 provider abstraction | 10 |
| FR-WORKSPACE-004 auto provider | 08, 10 |
| FR-WORKSPACE-006 bootstrap contract | 08, 11 |
| FR-WORKSPACE-007 retention | 10, 12 |
| FR-WORKSPACE-008 quotas | 08, 10 |
| FR-SCHED-002 persist before spawn | 02, 03, 06 |
| FR-SCHED-003 durable token model | 03; concurrency activated in M3 |
| FR-SCHED-005 process registry | 02, 06 |
| FR-SCHED-006 cancellation | 06, 07 |
| FR-SCHED-007 recovery | 06 |
| FR-SCHED-008 retry | 03, 05, 06 |
| FR-AGENT-001 common adapter boundary | 03, 11 |
| FR-AGENT-003 isolated cwd | 11 |
| FR-AGENT-004 environment filtering | 06, 11 |
| FR-SURFACE-002 workspace binding | 10, 11 |
| FR-SURFACE-003 no sibling projection | 11, 12 |
| FR-SURFACE-005 honest isolation | 10, 11, 12 |
| FR-CLI-001 compatibility | 05 |
| FR-CLI-003 run operations | 05, 07 |
| FR-CLI-004 workspace operations | 12 |
| FR-CLI-006 JSON parity | 05, 12 |
| FR-CLI-007 truthful exit codes | 05, 06 |
| FR-API-001 compatibility routes | 04 |
| FR-API-002 canonical resources | 04, 12 |
| FR-API-004 typed errors | 03, 04 |
| FR-UI-001 real run control | 07 |
| FR-UI-005 workspace inspector | 12 |
| A-001 no worktrees | 12 |
| A-003 distinct workspaces | 10, 11, 12 |
| A-004 exact baseline | 09, 11, 12 |
| A-005 canonical unchanged | 11, 12 |
| A-014 real process cancellation | 06, 07 |
| A-015 truthful retry lineage | 05, 06, 07 |
| A-016 restart reconciliation | 06 |
| A-017 shared service | 04, 05, 07 |
| A-019 truthful isolation label | 10, 11, 12 |

---

# 13. Explicit non-deliverables in these PRs

Do not expand Milestones 0–1 into:

- Change Set generation;
- source-code merge algorithms;
- canonical project apply;
- automatic Git commits;
- real parallel worker pool greater than one;
- race winner selection;
- SSE/WebSocket streaming overhaul;
- OverlayFS;
- Docker sandboxing;
- thredOS Node remote execution;
- Thread Runner marketplace/proving work;
- broad visual redesign.

Only implement seams required to avoid future breaking changes.

---

# 14. First implementation action

Begin with PR-01 only.

```bash
git checkout -b feat/runtime-contracts-v2 origin/main
```

Before editing, capture the preflight drift audit from Section 1.1 in the PR description. Implement schemas and tests without changing runtime behavior. Do not start repository or service extraction until PR-01 is green and merged.

---

# 15. Definition of complete for this implementation plan

Milestones 0 and 1 are complete when:

1. API and CLI execute through one shared runtime service.
2. Workflow runs and attempts have separate durable identities.
3. Every launch request is persisted before spawn.
4. Stop and retry act on real process state.
5. Startup reconciliation removes stale-running claims.
6. A dirty Git project can be snapshotted by content.
7. A non-Git project can be snapshotted by content.
8. Two attempts can share one immutable snapshot but receive separate workspaces.
9. Agents run from the Surface Workspace path, not the canonical project.
10. Agent writes do not change the canonical project.
11. Workspace state is inspectable and controllable from app and CLI.
12. No production runtime invokes Git worktrees.
13. The evidence bundle proves each statement above.

At that point the codebase is ready for Milestone 2 Change Sets and Milestone 3 real bounded parallel scheduling without another runtime redesign.
