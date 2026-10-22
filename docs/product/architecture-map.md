# Architecture Map

## Top-Level Shape

thredOS is a local-first application with one visible product entry and several layers behind it:

- UI in `app/`, `components/`, and `lib/ui/`
- local API routes in `app/api/`
- CLI control plane in `lib/seqctl/`
- shared application runtime in `lib/runtime/`, with process adapters in `lib/runner/` and compatibility projections in `lib/thread-surfaces/`
- workspace configuration and isolation foundations in `lib/workspaces/` and `lib/local-first/`
- safety and traceability in `lib/policy/` and `lib/audit/`

`app/page.tsx` is the top-level switch:

- no selection -> product entry screen
- `threados` -> main workbench shell
- `thread-runner` -> locked Thread Runner gate

## UI

The UI is a Next.js app with React Query for server state and Zustand for client state.

- Product entry: `components/entry/ProductEntryScreen.tsx`
- Main shell: `components/workbench/WorkbenchShell.tsx`, `components/workbench/TopBar.tsx`, `components/workbench/LeftRail.tsx`
- Sequence authoring controls: `components/workbench/sections/SequenceSection.tsx` and `components/command/CreateNodeDialog.tsx`
- Canvas and construction: `components/canvas/`
- Hierarchy and focused thread detail: `components/hierarchy/`
- Lane board and run-scoped views: `components/lanes/`
- Inspectors and edit forms: `components/inspector/`
- Chat panel: `components/chat/`
- Thread Runner gate: `components/thread-runner/ThreadRunnerGate.tsx`

Client-side data access lives in `lib/ui/api.ts`:

- reads from `app/api/*`
- invalidates runtime queries after mutations
- polls canonical runs and attempts only while execution is active
- preserves typed runtime error codes and idempotency metadata for operator controls

Client-side local UI state lives in `lib/ui/store.ts`:

- product entry mode
- left-rail and inspector state
- hierarchy vs lanes view mode
- selected thread surface and run
- dialog and navigation state

## API

The UI talks to local route handlers under `app/api/`.

Core sequence and runtime routes:

- `app/api/sequence/` for sequence read, reset, rename, thread-type persistence, and template application
- `app/api/step/`
- `app/api/dep/`
- `app/api/group/`
- `app/api/fusion/`
- `app/api/gate/`
- `app/api/run/`
- `app/api/stop/`
- `app/api/restart/`
- `app/api/status/`
- `app/api/runs/` and `app/api/runs/[runId]/` for canonical workflow-run resources
- `app/api/runs/[runId]/attempts/` for process-aware attempt lists
- `app/api/attempts/[attemptId]/` plus `cancel/` and `retry/` for canonical attempt controls

Thread-surface read model routes:

- `app/api/thread-surfaces/`
- `app/api/thread-runs/`
- `app/api/thread-merges/`
- `app/api/thread-annotations/`

Agent and proving-layer adjacent routes:

- `app/api/agent-profile/`
- `app/api/agents/`
- `app/api/packs/`
- `app/api/thread-runner/eligibility/`

Chat routes:

- `app/api/chat/` streams responses, extracts proposed actions, computes dry-run diffs, and still falls back to stub output when no provider is configured
- `app/api/apply/` applies validated chat actions against the sequence

## Shared Runtime

The runtime is local and file-backed.

- Sequence source of truth: `.threados/sequence.yaml`
- Prompts: `.threados/prompts/`
- Run artifacts: `.threados/runs/<runId>/<stepId>/`
- Runtime state: `.threados/state/`
- Policy file: `.threados/policy.yaml`

Canonical application-service modules:

- `lib/runtime/service.ts` owns run and attempt orchestration behind `ThreadOSRuntimeService`
- `lib/runtime/scheduler.ts` provides the truthful Milestone 0 sequential scheduler
- `lib/runtime/process-controller.ts` controls and observes real processes
- `lib/runtime/recovery.ts` and `lib/reconciliation/` eliminate stale-running state without interpreting missing evidence as success
- `lib/runtime/projections.ts` provides source-aware V2/legacy operator projections and writes compatibility surface projections
- `lib/runtime/*-repository.ts` persists workflow runs, attempts, processes, and idempotent command receipts

Supporting modules:

- `lib/sequence/` for schema, parsing, and DAG validation
- `lib/templates/` for thread-type template generators used by the workbench and API
- `lib/runner/` for provider dispatch, process launch adapters, wrapper logic, and artifact handling behind runtime ports
- `lib/mprocs/` for optional observability and legacy compatibility, not runtime truth
- `lib/thread-surfaces/` for topology, compatibility history, and merge projections
- `lib/agents/execution.ts` resolves and freezes executable identities through the existing agent repository; the runtime validates them at dispatch and retry, child projections use frozen spawn capabilities, and trace/export writers derive safe identity evidence from persisted run/attempt records rather than caller claims or live assignments
- `lib/workspaces/config*.ts`, `paths.ts`, and `exclusions.ts` for the Milestone 1 workspace policy boundary: validated human-authored config, external runtime-root resolution, deterministic exclusion hashes, and caller-supplied hard-excluded roots such as the resolved runtime data root
- `lib/workspaces/hash.ts`, `manifest.ts`, `snapshot.ts`, and `snapshot-repository.ts` for immutable baseline capture: normalized byte-stable manifests, bounded no-follow source copies, source-race retries, content-addressed external trees, workflow-run-scoped reuse, and atomic project-local snapshot metadata generations behind a stable manifest reference
- `lib/workspaces/providers/copy.ts` and `manager.ts` for manifest-driven portable-copy provisioning, verified `THREADOS_SCOPED` roots, lifecycle traces, retention, and cleanup; `quotas.ts` reserves active and retained capacity from canonical records and `doctor.ts` audits workspace storage without taking over process recovery
- `lib/workspaces/repository.ts` for canonical per-workspace records, closed lifecycle transitions, atomic legacy migration, and a rebuildable derived index; `lib/runtime/attempt-repository.ts` owns the exact atomic `workspace.ref.json` binding used by downstream dispatch
- `lib/runtime/workspace-planner.ts` classifies isolation requirements and verifies workspace identity/root boundaries; `factory.ts` supplies snapshot, provisioning, bootstrap, canonical verification, and retention ports to the service and attempt executor. `lib/workspaces/bootstrap.ts` evaluates configured commands through policy and delegates launch to the canonical process controller. `process-repository.ts` persists separate bootstrap/agent process records per attempt while retaining legacy readers; recovery preserves interrupted workspace evidence. `canonical-write-journal.ts` supplies canonical precondition and write-attribution evidence, without an apply path.

- `lib/runtime/workspace-operations.ts` owns operator workspace inspection, idempotent mutation, policy confirmation and doctor projection behind `ThreadOSRuntimeService`; `workspace-process-evidence.ts` verifies physical run/attempt/bootstrap/process evidence and conservative process-group termination before cleanup. API/CLI/UI remain adapters. Windows descendant termination is unsupported by the observation port and cleanup fails closed.
- `components/inspector/WorkspaceInspector.tsx` presents workspace/isolation/process/bootstrap evidence and operator actions; the Desktop Explorer bridge validates local sender, API identity, provider storage and actual directory boundaries before opening a verified workspace.
- `lib/exports/schema.ts`, `bundler.ts`, and `redaction.ts` assemble redacted M1 evidence without workspace file content; the export route writes only sanitized companion NDJSON. `scripts/verify/no-worktree-guard.ts` scans production invocation paths and `m1-workspace-proof.mjs` assembles fresh programmatic, operator, build and UI proof.

`lib/local-first/workspace.ts` joins the existing local workspace identity to
that boundary. Each local workspace projection resolves a runtime data root
outside the canonical project plus snapshot/workspace roots namespaced by both
workspace identity and canonical-project digest, and an exclusion-policy hash.
`.threados/workspace.yaml` remains human-authored input;
generated workspace records remain repository-owned.

The main execution path is:

1. an API route or CLI command validates interface input and calls `ThreadOSRuntimeService`
2. the service persists the command and workflow-run intent before execution
3. the sequential scheduler reserves an attempt and the service persists attempt/process launch intent
4. runtime ports compile the prompt, provision execution context, and start the real process
5. the service observes terminal process evidence, persists lifecycle/artifact/gate results, and updates projections
6. recovery reconciles interrupted or missing process evidence on startup
7. API, CLI, and operator UI read the same canonical records

API and CLI lifecycle handlers are guarded by
`test/architecture/runtime-service-boundary.test.ts`, and
`test/integration/runtime-interface-parity.test.ts` proves that a sequential
attempt persists the same canonical state tree through either interface.
`bun run verify:m0` repeats that parity proof, exercises real process
cancellation, retry lineage, and restart recovery, then writes the canonical
Milestone 0 evidence bundle under `test-results/verify/m0/`.

## Orchestration

thredOS has two orchestration faces: deterministic CLI control and chat-assisted control.

CLI orchestration:

- entrypoint: `lib/seqctl/index.ts`
- commands: `lib/seqctl/commands/*`
- purpose: create and mutate sequence state, run steps, manage gates, emit runtime events

Chat orchestration:

- streaming route: `app/api/chat/route.ts`
- validation/apply layer: `lib/chat/validator.ts`
- provider abstraction: `lib/llm/providers/*`

Both UI and CLI call the same runtime service instead of maintaining separate execution lifecycles or sources of truth.

The workbench's sequence authoring flow is also tied directly to that model:

- `TopBar` can create a new named sequence
- `SequenceSection` can rename the sequence, persist `thread_type`, and apply templates
- `CreateNodeDialog` creates nodes, refreshes status, and navigates the left rail to the affected phase

## Audit / Policy

Safety and traceability are first-class concepts even though some product flows are still incomplete.

- Policy engine: `lib/policy/engine.ts` and related modules
- Audit logging: `lib/audit/logger.ts`
- API helper integration: `lib/api-helpers.ts`

Policy is consulted before sensitive actions such as runtime execution or sequence mutation. Audit logging records applied actions so the system keeps a local action history.

## Thread-Surface Model

The thread-surface model is the main runtime abstraction beyond raw sequence steps.

Core modules:

- types: `lib/thread-surfaces/types.ts`
- persistence: `lib/thread-surfaces/repository.ts`
- mutation lifecycle: `lib/thread-surfaces/mutations.ts`
- execution-time materialization: `lib/thread-surfaces/step-run-runtime.ts`
- projections for UI: `lib/thread-surfaces/projections.ts`
- runtime event log parsing: `lib/thread-surfaces/runtime-event-log.ts`

The model separates three things:

- a thread surface: the runtime and inspection container for a thread
- a run: one execution attempt for that surface
- run events and merge events: the history of what happened during that execution

That model is what allows thredOS to render hierarchy, lanes, merges, ancestry, skills, and run history instead of only showing a flat list of steps.

## Important Current Caveat

The architecture is partly ahead of the fully finished product UX. The clearest example is `components/canvas/threadSurfaceScaffold.ts`, which can still fall back from real thread-surface data to a status-derived scaffold. That is a deliberate bridge between current runtime truth and the fuller recursive surface model the repo is moving toward.
