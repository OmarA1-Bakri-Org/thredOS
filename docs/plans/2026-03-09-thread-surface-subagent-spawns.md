# Thread Surface Subagent Spawn Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace step-driven child thread-surface creation with real subagent-spawn-driven runtime state so hierarchy and lane views reflect actual delegation events rather than every executed step.

**Architecture:** Introduce a spawn-runtime layer that derives explicit child-agent spawn events from orchestrated/fanout/watchdog semantics, persists those events and their child `ThreadSurface`/`RunScope` records, and updates API/CLI execution flows to emit child lanes only when delegation actually occurs. Keep root run lifecycle and merge recording from the current runtime branch; this phase narrows child-lane creation to real delegation.

**Tech Stack:** Bun, Next.js API routes, local JSON state in `.threados/state/`, TypeScript domain helpers, Bun test.

---

### Task 1: Persist Run Events in Thread Surface State

**Files:**
- Modify: `lib/thread-surfaces/repository.ts`
- Modify: `lib/thread-surfaces/repository.test.ts`
- Modify: `lib/thread-surfaces/types.ts`

**Step 1: Write the failing test**

Add repository tests for:
- reading/writing a `runEvents` collection alongside surfaces, runs, and merges
- defaulting `runEvents` to `[]` for older state files
- preserving existing persisted state when only `runEvents` changes

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/repository.test.ts`
Expected: FAIL on missing `runEvents` persistence.

**Step 3: Write minimal implementation**

Extend `ThreadSurfaceState` with:
- `runEvents: RunEvent[]`

Update repository read/write logic to:
- preserve backward compatibility with files that lack `runEvents`
- persist `runEvents` atomically with the rest of thread-surface state

Do not change projection behavior yet.

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/repository.ts lib/thread-surfaces/repository.test.ts lib/thread-surfaces/types.ts
git commit -m "feat: persist thread surface run events"
```

### Task 2: Add Spawn Runtime Helpers

**Files:**
- Create: `lib/thread-surfaces/spawn-runtime.ts`
- Create: `lib/thread-surfaces/spawn-runtime.test.ts`
- Modify: `lib/thread-surfaces/mutations.ts`
- Modify: `lib/thread-surfaces/mutations.test.ts`

**Step 1: Write the failing test**

Add helper tests that prove:
- orchestrator steps create child spawn specs only for their delegated workers
- watchdog steps create a dedicated watchdog child spawn tied to the watched thread
- plain base steps with no delegation metadata do **not** produce child spawn specs
- fanout metadata expands to ordered child spawn specs and preserves intended child order

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/spawn-runtime.test.ts lib/thread-surfaces/mutations.test.ts`
Expected: FAIL because spawn-runtime helpers do not exist yet.

**Step 3: Write minimal implementation**

Create a pure spawn-runtime module with helpers such as:
- `deriveSpawnSpecsForStep(...)`
- `resolveSpawnParentSurfaceId(...)`
- `resolveChildSurfaceId(...)`
- `buildChildSpawnEvent(...)`

Extend mutations only if needed to support:
- recording `child-agent-spawned` run events
- appending child surfaces in deterministic creation order

Rules:
- only explicit delegation semantics produce child surfaces
- direct step execution alone does not imply a child surface
- source of truth is sequence metadata (`orchestrator`, `fanout`, `watchdog_for`, later true runtime spawn hooks)

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/spawn-runtime.test.ts lib/thread-surfaces/mutations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/spawn-runtime.ts lib/thread-surfaces/spawn-runtime.test.ts lib/thread-surfaces/mutations.ts lib/thread-surfaces/mutations.test.ts
git commit -m "feat: add subagent spawn runtime helpers"
```

### Task 3: Emit Real Spawn Events from API Runtime

**Files:**
- Modify: `app/api/run/route.ts`
- Modify: `test/api/thread-runtime-events.test.ts`
- Create: `test/api/thread-spawn-events.test.ts`

**Step 1: Write the failing test**

Add API route tests that prove:
- orchestrator execution records `child-agent-spawned` events and creates child surfaces only for delegated children
- worker/base steps without new delegation metadata do not create extra child surfaces
- repeated orchestrator runs append replacement child runs instead of duplicating child surfaces
- watchdog creation is represented as a distinct child lane when configured

**Step 2: Run test to verify it fails**

Run: `bun test test/api/thread-runtime-events.test.ts test/api/thread-spawn-events.test.ts`
Expected: FAIL because the API route still creates child surfaces per executed step.

**Step 3: Write minimal implementation**

Refactor `app/api/run/route.ts` to:
- keep root run lifecycle as-is
- stop calling step-driven child-surface creation for every executed step
- call spawn-runtime helpers only when the executed step actually delegates
- persist `child-agent-spawned` run events plus child `ThreadSurface`/`RunScope` records
- preserve existing successful fusion merge-event recording

Do not fake spawn events from the UI.

**Step 4: Run test to verify it passes**

Run: `bun test test/api/thread-runtime-events.test.ts test/api/thread-spawn-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/run/route.ts test/api/thread-runtime-events.test.ts test/api/thread-spawn-events.test.ts
git commit -m "feat: emit subagent spawn events from api runtime"
```

### Task 4: Bring CLI Runtime to the Same Spawn Model

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Modify: `test/integration/cli-lifecycle.test.ts`
- Create: `test/integration/cli-subagent-spawn.test.ts`

**Step 1: Write the failing test**

Add CLI integration tests for:
- orchestrator run creating delegated child surfaces and run events
- non-delegating step runs leaving child-surface state unchanged except for root run updates
- repeated CLI runs appending new child runs instead of duplicating child surfaces

**Step 2: Run test to verify it fails**

Run: `bun test test/integration/cli-lifecycle.test.ts test/integration/cli-subagent-spawn.test.ts`
Expected: FAIL because CLI still mirrors the older step-driven child-surface creation.

**Step 3: Write minimal implementation**

Update `lib/seqctl/commands/run.ts` to use the same spawn-runtime path as the API route:
- root run scope remains per command invocation
- child surfaces arise only from delegation/spawn semantics
- run events are persisted with deterministic IDs/order

Keep CLI and API behavior aligned.

**Step 4: Run test to verify it passes**

Run: `bun test test/integration/cli-lifecycle.test.ts test/integration/cli-subagent-spawn.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/seqctl/commands/run.ts test/integration/cli-lifecycle.test.ts test/integration/cli-subagent-spawn.test.ts
git commit -m "feat: align cli runtime with subagent spawn events"
```

### Task 5: Update UI/Projection Tests to the New Runtime Truth

**Files:**
- Modify: `test/fixtures/thread-surfaces/multi-thread-state.json`
- Modify: `test/integration/thread-surface-ui-flow.test.ts`
- Modify: `components/canvas/threadSurfaceScaffold.test.ts`
- Modify: `components/canvas/threadSurfaceFocus.test.ts`
- Modify: `lib/thread-surfaces/projections.test.ts`

**Step 1: Write the failing test**

Adjust or add tests proving:
- hierarchy and lane views can still render from real persisted spawn-driven state
- child lanes correspond to delegated agent surfaces rather than every step
- merge groups still work when source lanes originate from delegated children
- old step-driven assumptions are removed from fixture shape and assertions

**Step 2: Run test to verify it fails**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts components/canvas/threadSurfaceScaffold.test.ts components/canvas/threadSurfaceFocus.test.ts lib/thread-surfaces/projections.test.ts`
Expected: FAIL until fixtures and assertions match spawn-driven runtime state.

**Step 3: Write minimal implementation**

Update fixtures/tests only as needed so UI projections align with the new truth:
- top-down hierarchy remains structural
- lane board remains run-scoped
- spawn-created child surfaces remain the displayed lanes

Avoid changing UI behavior unless a projection bug is exposed.

**Step 4: Run test to verify it passes**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts components/canvas/threadSurfaceScaffold.test.ts components/canvas/threadSurfaceFocus.test.ts lib/thread-surfaces/projections.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add test/fixtures/thread-surfaces/multi-thread-state.json test/integration/thread-surface-ui-flow.test.ts components/canvas/threadSurfaceScaffold.test.ts components/canvas/threadSurfaceFocus.test.ts lib/thread-surfaces/projections.test.ts
git commit -m "test: update thread surface projections for spawn-driven runtime"
```

### Task 6: Full Verification and Handoff

**Files:**
- Modify: `docs/plans/*.md` only if implementation details materially change

**Step 1: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Run tests**

Run: `bun test`
Expected: PASS

**Step 4: Run production build**

Run: `bun run build`
Expected: PASS

**Step 5: Commit**

```bash
git add docs
git commit -m "docs: capture subagent spawn runtime plan"
```
