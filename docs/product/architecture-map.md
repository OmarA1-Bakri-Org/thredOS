# Architecture Map

## Top-Level Shape

thredOS is a local-first application with one visible product entry and several layers behind it:

- UI in `app/`, `components/`, and `lib/ui/`
- local API routes in `app/api/`
- CLI control plane in `lib/seqctl/`
- execution runtime in `lib/runner/`, `lib/mprocs/`, and `lib/thread-surfaces/`
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
- polls status on a short interval

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

## Runtime

The runtime is local and file-backed.

- Sequence source of truth: `.threados/sequence.yaml`
- Prompts: `.threados/prompts/`
- Run artifacts: `.threados/runs/<runId>/<stepId>/`
- Runtime state: `.threados/state/`
- Policy file: `.threados/policy.yaml`

Primary runtime modules:

- `lib/sequence/` for schema, parsing, and DAG validation
- `lib/templates/` for thread-type template generators used by the workbench and API
- `lib/runner/` for prompt compilation, dispatch, wrapper logic, and artifact handling
- `lib/mprocs/` for process-manager integration
- `lib/thread-surfaces/` for runtime state beyond simple step status

The main execution path is:

1. a UI or CLI mutation requests execution
2. the sequence is read and validated
3. prompt context is compiled in `lib/runner/prompt-compiler.ts`
4. a runner is dispatched in `lib/runner/dispatch.ts`
5. artifacts and runtime events are written under `.threados/`
6. thread-surface state is updated and exposed back to the UI

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

The system is designed so both UI and CLI act on the same local model instead of maintaining separate sources of truth.

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
