# Apollo Native Engine Implementation Plan

> For Hermes: execute with subagent-driven-development, one task at a time, with spec review first and code quality review second. Hard gate every task on tests that pass and third-party inspection.

**Goal:** Finish the thredOS runtime so the Apollo Segment Builder pack executes through native structured actions rather than prompt-only projection.

**Architecture:** Extend the existing `run` command runtime in thin vertical slices. Each slice adds one native action capability, persists structured runtime outputs, and proves behavior with targeted tests plus Apollo smoke verification. Avoid broad rewrites; preserve the current pack/compiler/install framework and deepen runtime consumption.

**Tech Stack:** Bun, TypeScript, Zod, thredOS pack/compiler/install/runtime, Composio CLI.

---

## Task 1: Native `composio_tool` action execution

**Objective:** Execute `composio_tool` actions directly from the runtime instead of only exposing them in prompts.

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Modify: `lib/seqctl/commands/run.test.ts`
- Optional create: `lib/runtime/context.ts` if extraction is needed

**Requirements:**
- Action type `composio_tool` executes through the local Composio CLI
- Tool output is captured and written into runtime context under `output_key` if present
- `on_failure` behavior at least supports `warn`, `abort_step`, `abort_workflow`, `skip`
- Existing prompt dispatch path remains intact for model-based steps
- Apollo smoke run should advance further once real composio-backed steps are enabled

**TDD gate:**
1. Add failing tests in `lib/seqctl/commands/run.test.ts`
2. Verify they fail
3. Implement minimal native composio execution
4. Verify tests pass
5. Re-run relevant suites

**Verification:**
- `bun test lib/seqctl/commands/run.test.ts`
- `bun test lib/packs/loader.test.ts lib/packs/compiler.test.ts lib/packs/install.test.ts lib/packs/apollo-pack.test.ts lib/seqctl/commands/run.test.ts`

---

## Task 2: Runtime context + output propagation

**Objective:** Make action outputs persist in a structured way so later conditions/gates/actions can reference them predictably.

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Optional create: `lib/runtime/context.ts`
- Optional create tests near `lib/seqctl/commands/run.test.ts`

**Requirements:**
- Runtime context lives in `.threados/state/runtime-context.json`
- `output_key` values write deterministic structured output there
- Existing condition evaluation reads from the same context layer
- Writes are atomic and merge-safe for iterative runs

**Verification:**
- tests proving one step writes context and a later step reads it
- Apollo smoke run should show deeper progress after real output propagation

---

## Task 3: Native approval action handling

**Objective:** Turn `approval` actions into real runtime approval records instead of prompt-only metadata.

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Reuse approval/traces infrastructure already present under `lib/approvals/**`, `lib/traces/**`
- Modify tests under `lib/seqctl/commands/run.test.ts`

**Requirements:**
- Approval action creates a pending approval record
- Runtime reflects blocked / waiting state correctly
- Approval lifecycle emits trace events / persisted evidence
- SAFE-mode side-effect steps can integrate with this path later

**Verification:**
- targeted runtime tests
- no regressions in existing approval proof tests if relevant

---

## Task 4: Native conditional action handling

**Objective:** Execute `conditional` actions as structured branches in runtime, not just step-level gating.

**Files:**
- Modify: `lib/seqctl/commands/run.ts`
- Modify: `lib/seqctl/commands/run.test.ts`

**Requirements:**
- Support `config.condition`
- Execute `if_true` / `if_false` action arrays natively
- Persist outputs from whichever branch executes

**Verification:**
- tests for true/false branch execution
- no regressions in current runnable-condition tests

---

## Task 5: Apollo full real run and output inspection

**Objective:** Run Apollo against real tool calls and inspect resulting artifacts/state.

**Files:**
- Likely no code changes initially — execute and inspect
- Update docs if learnings are found:
  - `docs/plans/2026-04-20-apollo-pack-bootstrap.md`
  - `docs/workflows/apollo-segment-builder.md`
  - `docs/workflows/workflow-requirements-template.md`

**Requirements:**
- Use real Composio where safe and available
- Capture produced outputs, runtime context, sequence status, artifacts
- Document gaps between expected and actual behavior
- Feed those learnings back into thredOS workflow requirements and runtime design

**Verification:**
- successful end-to-end run or explicit blocker report with concrete evidence

---

## Hard gates for every task

- Spec review must PASS before quality review starts
- Quality review must APPROVE before task is marked done
- Relevant tests must pass
- Apollo smoke verification should be rerun when runtime semantics change

## Likely files touched overall
- `lib/seqctl/commands/run.ts`
- `lib/seqctl/commands/run.test.ts`
- possibly a new `lib/runtime/context.ts`
- docs under `docs/workflows/` and `docs/plans/`

## Risks / tradeoffs
- Overloading `run.ts` further may create debt; if a helper module emerges naturally, extract it
- Real Composio execution introduces credential/tool variability; preserve mocked tests for determinism
- Approval semantics can sprawl into policy/gate code; keep the first slice narrow and observable

## Success condition
The Apollo pack runs materially deeper with real native runtime behavior, and the learnings are captured in thredOS docs so the future workflow intake/requirements flow can shield users from this complexity.
