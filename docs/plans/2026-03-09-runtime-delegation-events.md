# Runtime Delegation Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace inferred child-lane and merge creation with real runtime-emitted delegation events consumed by the API and CLI run paths.

**Architecture:** Introduce a step-run event log (`events.jsonl`) inside the existing artifact directory, define a small validated event contract (`spawn-child`, `merge-into`), inject that contract into the prompt/dispatch runtime, and update API/CLI run handlers to translate parsed runtime events into `ThreadSurfaceState` mutations. Keep static sequence-metadata inference only as a temporary fallback when no runtime events were emitted.

**Tech Stack:** Bun, Next.js API routes, local JSON artifacts, TypeScript domain helpers, Bun test.

---

### Task 1: Add Runtime Event Log Helpers

**Files:**
- Create: `lib/thread-surfaces/runtime-event-log.ts`
- Test: `lib/thread-surfaces/runtime-event-log.test.ts`
- Modify: `lib/runner/artifacts.ts`
- Test: `lib/runner/artifacts.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- parsing valid JSONL runtime events into typed records
- ignoring blank lines
- rejecting malformed event payloads without throwing the whole parse
- resolving the event-log file path under `.threados/runs/<runId>/<stepId>/events.jsonl`

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/runtime-event-log.test.ts lib/runner/artifacts.test.ts`
Expected: FAIL because runtime-event-log helpers and path helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `readRuntimeEventLog(...)`
- `appendRuntimeEvent(...)` or `writeRuntimeEventLog(...)` helper for tests
- validated schemas for `spawn-child` and `merge-into`
- artifact helper to resolve/create the event-log path

Keep the parser tolerant: invalid lines become skipped parse results, not fatal run errors.

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/runtime-event-log.test.ts lib/runner/artifacts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/runtime-event-log.ts lib/thread-surfaces/runtime-event-log.test.ts lib/runner/artifacts.ts lib/runner/artifacts.test.ts
git commit -m "feat: add runtime delegation event log helpers"
```

### Task 2: Inject the Runtime Event Contract into Prompt + Dispatch

**Files:**
- Modify: `lib/runner/prompt-compiler.ts`
- Test: `lib/runner/prompt-compiler.test.ts`
- Modify: `lib/runner/dispatch.ts`
- Test: `lib/runner/dispatch.test.ts`

**Step 1: Write the failing test**

Add tests proving:
- compiled prompts include explicit instructions for writing runtime delegation events
- dispatch injects `THREADOS_EVENT_LOG` into the child process env
- the prompt contract documents both `spawn-child` and `merge-into`

**Step 2: Run test to verify it fails**

Run: `bun test lib/runner/prompt-compiler.test.ts lib/runner/dispatch.test.ts`
Expected: FAIL because no event-log env or prompt contract exists yet.

**Step 3: Write minimal implementation**

Update the compiler and dispatcher so each step run gets:
- a concrete event-log path env var
- compact instructions describing the JSONL event contract
- no change to the general run artifact format beyond adding the event log path

Do not add broader agent-control features in this task.

**Step 4: Run test to verify it passes**

Run: `bun test lib/runner/prompt-compiler.test.ts lib/runner/dispatch.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/runner/prompt-compiler.ts lib/runner/prompt-compiler.test.ts lib/runner/dispatch.ts lib/runner/dispatch.test.ts
git commit -m "feat: expose runtime delegation event contract"
```

### Task 3: Consume Runtime Events in API Runs

**Files:**
- Modify: `app/api/run/route.ts`
- Modify: `lib/thread-surfaces/mutations.ts`
- Test: `test/api/thread-spawn-events.test.ts`
- Test: `test/api/thread-runtime-events.test.ts`
- Test: `lib/thread-surfaces/mutations.test.ts`

**Step 1: Write the failing test**

Add route-level tests proving:
- runtime-emitted `spawn-child` events create child surfaces/runs even when static sequence metadata would not
- runtime-emitted `merge-into` events create merge events from the artifact log
- plain orchestrator metadata does not create child lanes if no runtime event was emitted and fallback is disabled for the test
- fallback metadata inference still works when no event log is present yet

**Step 2: Run test to verify it fails**

Run: `bun test test/api/thread-spawn-events.test.ts test/api/thread-runtime-events.test.ts lib/thread-surfaces/mutations.test.ts`
Expected: FAIL because the route only derives child lanes from metadata today.

**Step 3: Write minimal implementation**

After each step run completes successfully:
- read the runtime event log from that step’s artifact directory
- translate `spawn-child` into child surface/run creation + `child-agent-spawned` run events
- translate `merge-into` into persisted `MergeEvent` records
- fall back to `deriveSpawnSpecsForStep(...)` only when the runtime event log is absent/empty and compatibility mode is needed

Keep the persisted `ThreadSurfaceState` shape unchanged.

**Step 4: Run test to verify it passes**

Run: `bun test test/api/thread-spawn-events.test.ts test/api/thread-runtime-events.test.ts lib/thread-surfaces/mutations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/run/route.ts lib/thread-surfaces/mutations.ts test/api/thread-spawn-events.test.ts test/api/thread-runtime-events.test.ts lib/thread-surfaces/mutations.test.ts
git commit -m "feat: consume runtime delegation events in api runs"
```

### Task 4: Bring CLI Runtime onto the Same Event Path

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Test: `test/integration/cli-lifecycle.test.ts`

**Step 1: Write the failing test**

Add CLI integration coverage proving:
- successful orchestrator runs create child surfaces from runtime-emitted event logs
- merge events can be created from runtime-emitted `merge-into` records
- metadata fallback still works when no runtime event log exists yet

**Step 2: Run test to verify it fails**

Run: `bun test test/integration/cli-lifecycle.test.ts`
Expected: FAIL because the CLI still consumes only metadata-derived spawn specs.

**Step 3: Write minimal implementation**

Mirror the API behavior in the CLI run command:
- read runtime event logs from artifacts
- apply the same child/merge mutation path
- keep the CLI runtime override seam for tests

**Step 4: Run test to verify it passes**

Run: `bun test test/integration/cli-lifecycle.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/seqctl/commands/run.ts test/integration/cli-lifecycle.test.ts
git commit -m "feat: consume runtime delegation events in cli runs"
```

### Task 5: Tighten UI/Projection Fixtures to Runtime Truth

**Files:**
- Modify: `test/fixtures/thread-surfaces/multi-thread-state.json`
- Modify: `test/integration/thread-surface-ui-flow.test.ts`
- Modify: `components/lanes/useLaneBoard.test.ts`
- Modify: `components/hierarchy/useHierarchyGraph.test.ts`

**Step 1: Write the failing test**

Update and extend fixtures so they reflect runtime-emitted truth:
- lanes that exist because events were emitted
- merges that exist because `merge-into` events were emitted
- hierarchy behavior unchanged when the persisted state is already truthful

**Step 2: Run test to verify it fails**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts components/lanes/useLaneBoard.test.ts components/hierarchy/useHierarchyGraph.test.ts`
Expected: FAIL if any assumptions still depend on inferred metadata.

**Step 3: Write minimal implementation**

Adjust fixtures/assertions only as needed. Avoid UI production changes unless a read-path bug is exposed.

**Step 4: Run test to verify it passes**

Run: `bun test test/integration/thread-surface-ui-flow.test.ts components/lanes/useLaneBoard.test.ts components/hierarchy/useHierarchyGraph.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add test/fixtures/thread-surfaces/multi-thread-state.json test/integration/thread-surface-ui-flow.test.ts components/lanes/useLaneBoard.test.ts components/hierarchy/useHierarchyGraph.test.ts
git commit -m "test: align thread surface fixtures with runtime delegation events"
```

### Task 6: Full Verification and Handoff

**Files:**
- Modify: `docs/plans/2026-03-09-runtime-delegation-events-design.md`
- Modify: `docs/plans/2026-03-09-runtime-delegation-events.md` if any implementation notes need tightening

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
git add docs/plans
git commit -m "docs: capture runtime delegation event phase"
```
