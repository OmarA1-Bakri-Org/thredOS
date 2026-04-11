# Current State of the Product

This page is intentionally blunt. It describes the repo as it exists now, not the aspirational product story.

## Implemented

- thredOS is the active product path. `app/page.tsx` routes into `components/entry/ProductEntryScreen.tsx` and then into the workbench shell for the `threados` entry mode.
- The core thredOS workbench exists. `components/workbench/`, `components/canvas/`, `components/hierarchy/`, `components/inspector/`, and `components/chat/` are all live UI modules, backed by `lib/ui/api.ts` and `lib/ui/store.ts`.
- Sequence authoring in the workbench is materially implemented, not just stubbed. `components/workbench/TopBar.tsx`, `components/workbench/sections/SequenceSection.tsx`, and `components/command/CreateNodeDialog.tsx` support named new threads, inline sequence rename, persisted thread-type selection, template application, and step/gate creation that re-focuses the left rail on the new node's phase.
- Sequence construction and execution flows exist through both CLI and API. `lib/seqctl/index.ts` exposes `init`, `step`, `dep`, `group`, `fusion`, `gate`, `run`, `stop`, `restart`, `mprocs`, `template`, and `event`. Matching route groups exist under `app/api/`.
- Sequence-level API persistence is implemented beyond reset. `app/api/sequence/route.ts` supports `reset`, `rename`, `set-type`, and `apply-template`, and `apply-template` also creates placeholder prompt files for generated steps.
- Step execution is wired into a real runtime flow. `app/api/run/route.ts` reads the sequence, compiles prompts, dispatches the runner, saves artifacts, and updates thread-surface state.
- Thread-surface persistence is real. `lib/thread-surfaces/repository.ts` persists surfaces, runs, merge events, and run events under `.threados/state/thread-surfaces.json`.
- Merge and spawn runtime events are implemented. `lib/thread-surfaces/runtime-event-log.ts` defines the event log format, and `lib/thread-surfaces/step-run-runtime.ts` materializes runtime events into state changes.
- Policy and audit foundations exist. `lib/policy/` and `lib/audit/` are used by the API helpers and chat action validator.
- Local developer setup is usable. `package.json` defines install, dev, lint, typecheck, test, UI test, and combined check commands, and `.env.example` documents the expected environment variables.
- Canvas thread-surface truth is live. `lib/thread-surfaces/materializer.ts` auto-materializes real thread surfaces on step add/clone/remove, template apply, and sequence reset. `app/api/thread-surfaces/route.ts` reconciles surfaces on read. The `status-scaffold` fallback in `components/canvas/threadSurfaceScaffold.ts` now logs a warning and should rarely trigger.
- Basic agent workflow is implemented. `app/api/agents/route.ts` lists and registers agents, `app/api/step/route.ts` persists `assigned_agent_id`, `lib/ui/api.ts` exposes `useListAgents`, `useRegisterAgent`, and `useAssignAgent`, and `components/workbench/sections/AgentSection.tsx` provides real Workshop, Roster, Assign, and Tools tabs.
- Gate workflow is materially implemented. `GateSchema` now includes `description`, `acceptance_conditions`, and `required_review`; `app/api/gate/route.ts` supports `insert`, `update`, `approve`, `block`, and `rm`; `lib/ui/api.ts` exposes `useUpdateGate`; and `components/workbench/sections/GateSection.tsx` plus `components/inspector/StepActions.tsx` enforce condition-aware approval.
- Agent performance stats are wired to real data. `app/api/agent-stats/route.ts` computes performance from Thread Runner race/run data via `aggregateAgentStats()`, and `components/workbench/sections/AgentSection.tsx` renders runs, pass rate, avg time, and quality from the `useAgentPerformance()` hook.
- Gate quality metrics are wired to real audit data. `lib/gates/metrics.ts` computes approval rate and time-to-approval from audit log entries, `app/api/gate-metrics/route.ts` serves them, and `components/workbench/sections/GateSection.tsx` renders time/quality and pass rate cards via the `useGateMetrics()` hook.
- Pack lifecycle is file-backed with UI. `app/api/packs/route.ts` uses `readPackState()`/`updatePackState()` for persistence with `create` and `promote` actions. `components/workbench/sections/PacksSection.tsx` renders pack cards with status progression (challenger/champion/hero), icons, and timeline. Hooks: `useListPacks()`, `useCreatePack()`, `usePromotePack()`.
- Builder profile is implemented. `lib/builders/types.ts` defines `BuilderProfile`, `app/api/builder-profile/route.ts` aggregates agent count, pack count, best pack status, and quality score. `components/workbench/sections/BuilderSection.tsx` renders stat cards. Hook: `useBuilderProfile()`.
- AutoResearch workflow optimizer is implemented. `lib/autoresearch/` defines types, prompt, and tools for LLM-driven sequence analysis. `app/api/optimize/route.ts` serves optimization suggestions. `components/autoresearch/OptimizeButton.tsx` renders an "Optimize Workflow" button with expandable suggestion cards showing category, confidence, impact, and proposed actions. Hook: `useOptimizeWorkflow()`.
- Thread Runner race flow is implemented. `lib/thread-runner/race-executor.ts` provides file-backed `enrollRace()`, `recordRun()`, `listRaces()`, `getRaceResults()`. `app/api/thread-runner/race/route.ts` serves GET (list/results) and POST (enroll/record-run). `components/thread-runner/RaceView.tsx` renders race cards with status badges, combatant counts, and a results panel with placement rankings. Hooks: `useListRaces()`, `useRaceResults()`, `useEnrollRace()`, `useRecordRun()`.

## Partially Implemented

- Chat-assisted orchestration uses structured tool_use (function calling) as the primary output format, with regex-based JSON extraction as a fallback. `app/api/chat/route.ts` passes `CHAT_TOOLS` to the completion call; when the model returns `tool_calls`, actions are parsed directly via `parseToolCallActions()`. When tool_use is unsupported, the route falls back to streaming + `extractActions()`. It still falls back to a stub response when no provider is configured.
- Hierarchy and lane runtime views are mostly real, but not fully guaranteed. `app/api/thread-surfaces/`, `app/api/thread-runs/`, and `app/api/thread-merges/` expose persisted state, but `components/canvas/threadSurfaceScaffold.ts` still falls back to `status-scaffold` when recursive surface data is missing.
- Agent, builder, and pack context are partially integrated. `app/api/agent-profile/route.ts` combines agent registrations, pack state, runner state, and thread-surface state into a profile, but `components/workbench/sections/AgentSection.tsx` still has placeholder performance stats and the broader builder/pack progression loop is not productized.
- Runtime delegation exists, but the product layer around it is still maturing. `lib/thread-surfaces/step-run-runtime.ts` records spawn, spawn-denied, and merge events, provisions child sequences, and skill-gates spawning, yet the orchestration UX and capability semantics are still evolving.

## Prototype Only

- The static UI prototype set under `docs/prototypes/threados-ui/` is design reference material, not the production app.

## Not Started

- Thread Runner eligibility is data-driven but all requirements are still hardcoded as unmet. `app/api/thread-runner/eligibility/route.ts` and `components/thread-runner/ThreadRunnerGate.tsx` are wired to live API data, but no registration or subscription system exists to flip requirements to met.
- Verified VM execution is not live. The race executor manages race/run state but actual sandboxed VM-backed execution with verification does not exist.
- End-to-end pack progression loop (acquisition from Thread Runner proving, leaderboard ranking, builder reputation) is not productized — individual pieces exist but the loop connecting them is not wired.

## Interview-safe summary

If you need a concise, defensible summary of the repo state:

- **real today:** thredOS workbench, local API, CLI, sequence authoring, runtime surfaces, approvals, audit/policy foundations, and basic agent registration/assignment
- **partially real:** chat orchestration, lane/hierarchy completeness, builder/pack integration, and proving-layer hooks
- **not product-ready yet:** full Thread Runner proving loop, verified VM execution, and end-to-end competitive progression
