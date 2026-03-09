# Thread Surface Runtime Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire real child thread-surface creation, run-scoped merge recording, and runtime event persistence into the orchestrator so the hierarchy and lane board are driven by actual agent behavior instead of only root-run lifecycle state.

**Architecture:** Keep `ThreadSurface` as the durable structural identity and `RunScope`/`MergeEvent` as runtime facts. Extend the execution layer so root runs, child agent spawns, cancellations, and merges all mutate `.threados/state/thread-surfaces.json` through the repository helpers already added. Keep the UI read-only for this phase; the main change is producing truthful runtime data.

**Tech Stack:** Bun, Next.js API routes, local JSON state in `.threados/state/`, TypeScript domain helpers, Bun test.

---

### Task 1: Add Runtime Event Helpers

**Files:**
- Modify: `lib/thread-surfaces/mutations.ts`
- Test: `lib/thread-surfaces/mutations.test.ts`

**Step 1: Write the failing test**

Add tests for:
- creating a child surface when a parent agent spawns a subagent
- recording a block merge into an existing destination lane
- preventing a source lane from merging into itself

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/mutations.test.ts`
Expected: FAIL on missing child-spawn or merge mutation behavior

**Step 3: Write minimal implementation**

Extend mutation helpers with:
- `createChildThreadSurfaceRun(...)`
- `recordMergeEvent(...)`
- any small helper needed to resolve parent depth and validate destination/source surfaces

Keep all functions pure over `ThreadSurfaceState`.

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/mutations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/mutations.ts lib/thread-surfaces/mutations.test.ts
git commit -m "feat: add thread surface runtime mutations"
```

### Task 2: Persist Runtime Events from the Orchestrator

**Files:**
- Modify: `app/api/run/route.ts`
- Modify: `app/api/stop/route.ts`
- Modify: `app/api/restart/route.ts`
- Modify: `lib/runner/dispatch.ts`
- Test: `test/api/thread-run-lifecycle.test.ts`

**Step 1: Write the failing test**

Add route-level tests that prove:
- root runs initialize thread-surface state
- replacement runs append instead of mutating prior runs
- stop cancels the active run
- restart creates a fresh run

**Step 2: Run test to verify it fails**

Run: `bun test test/api/thread-run-lifecycle.test.ts`
Expected: FAIL on missing repository writes or incorrect run replacement behavior

**Step 3: Write minimal implementation**

In route handlers:
- create a root `ThreadSurface` when absent
- append new `RunScope` values for new execution attempts
- cancel active runs instead of mutating them into restarts
- keep route test stubbing isolated from unrelated module tests

**Step 4: Run test to verify it passes**

Run: `bun test test/api/thread-run-lifecycle.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/run/route.ts app/api/stop/route.ts app/api/restart/route.ts lib/runner/dispatch.ts test/api/thread-run-lifecycle.test.ts
git commit -m "feat: persist root thread surface lifecycle"
```

### Task 3: Emit Child Surface Creation from Real Agent Spawn Events

**Files:**
- Modify: `lib/chat/*` or the actual spawn orchestration entrypoints once identified
- Modify: `lib/runner/*` if child-agent dispatch happens there
- Test: add focused tests near the runtime entrypoint you modify

**Step 1: Write the failing test**

Write a test that simulates a parent run spawning one or more child agents and asserts:
- child surfaces are created immediately when the child agent appears
- each child gets its own `RunScope`
- parent `childSurfaceIds` is updated in creation order

**Step 2: Run test to verify it fails**

Run the smallest relevant test command for the runtime module you touched.

**Step 3: Write minimal implementation**

At the real spawn point:
- call repository update helpers
- create `ThreadSurface`/`RunScope` records for each child
- store `parentSurfaceId`, `parentAgentNodeId`, `depth`, and child ordering

Do not fake child surfaces in the UI layer.

**Step 4: Run test to verify it passes**

Run the same focused test command.

**Step 5: Commit**

```bash
git add <runtime files> <tests>
git commit -m "feat: persist child thread surfaces from agent spawns"
```

### Task 4: Emit Real Merge Events

**Files:**
- Modify: runtime/orchestration module where merge or synthesis completion is decided
- Test: add merge-focused runtime tests

**Step 1: Write the failing test**

Add tests for:
- single-source merge into an existing destination lane
- block merge with ordered source lanes
- source lanes remaining terminal after merge

**Step 2: Run test to verify it fails**

Run the smallest relevant test command for the merge-producing module.

**Step 3: Write minimal implementation**

At the real merge decision point:
- persist `MergeEvent`
- ensure destination lane already exists
- preserve source ordering exactly as merged
- do not synthesize new lanes during merge

**Step 4: Run test to verify it passes**

Run the same focused test command.

**Step 5: Commit**

```bash
git add <merge runtime files> <tests>
git commit -m "feat: record runtime lane merge events"
```

### Task 5: Tighten UI Read Path Against Real Runtime Data

**Files:**
- Modify: `components/canvas/SequenceCanvas.tsx`
- Modify: `components/canvas/threadSurfaceScaffold.ts`
- Modify: `components/canvas/threadSurfaceFocus.ts`
- Test: `test/integration/thread-surface-ui-flow.test.ts`

**Step 1: Write the failing test**

Add coverage proving:
- the canvas prefers real API data when all thread-surface collections are present
- the lane detail panel follows the selected thread/run
- partial query resolution does not suppress loading early

**Step 2: Run test to verify it fails**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts`
Expected: FAIL when selection or partial-loading handling is wrong

**Step 3: Write minimal implementation**

Use the persisted runtime data to:
- build the hierarchy graph
- build the lane board
- drive the focused lane detail panel
- keep the scaffold only as a fallback while true data is absent

**Step 4: Run test to verify it passes**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add components/canvas/SequenceCanvas.tsx components/canvas/threadSurfaceScaffold.ts components/canvas/threadSurfaceFocus.ts test/integration/thread-surface-ui-flow.test.ts
git commit -m "feat: drive canvas from runtime thread surface data"
```

### Task 6: Full Verification and Handoff

**Files:**
- Modify: `README.md` or `docs/*.md` only if behavior changes require documentation

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
git add README.md docs
git commit -m "docs: capture thread surface runtime orchestration"
```
