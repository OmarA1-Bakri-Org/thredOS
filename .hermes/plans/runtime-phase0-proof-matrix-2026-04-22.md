# Runtime Phase 0 proof matrix — 2026-04-22

Purpose
- Define the non-Apollo proof matrix and acceptance criteria before Phase 1 runtime coding starts.
- Force later runtime claims to answer concrete workflow classes, not abstract semantics.
- Give Phase 4 a fixed target for what must be proven, what evidence must be preserved, and what outcomes count as supported vs fragile vs unsupported-but-cleanly-rejected.

Inputs used
- `/home/omar/.hermes/plans/2026-04-22_091759-lets-finish-the-runtime-set-out-the-plan.md`
- `/home/omar/.hermes/plans/audit-closure-checklist-2026-04-22.md`
- Live repo tests and fixtures in this worktree, especially:
  - `lib/seqctl/commands/run.test.ts`
  - `test/api/run-route-coverage.test.ts`
  - `test/api/run-approval-proof.test.ts`
  - `test/api/thread-run-lifecycle.test.ts`
  - `lib/runner/dispatch.test.ts`
  - `lib/thread-runner/eligibility.test.ts`
  - `test/api/thread-runner-eligibility-route.test.ts`

Missing repo-local inputs
- The requested repo-local audit files were not present at the provided paths:
  - `.hermes/audits/runtime-readiness-matrix.md`
  - `.hermes/audits/runtime-roadmap.md`
- This matrix therefore anchors itself to the global finish plan, the audit closure checklist, and the existing runtime proof tests in the worktree.

Status vocabulary for this matrix
- supported
  - Representative workflow runs through the intended executor path end-to-end.
  - Final persisted state matches the expected semantic outcome (`DONE`, `BLOCKED`, `NEEDS_REVIEW`, `FAILED`, or `SKIPPED`).
  - Required artifacts, approvals, traces, and runtime-context side effects are preserved and internally consistent.
  - CLI/API parity is proven where the class claims parity.
- fragile
  - The workflow can be made to work in a constrained harness, but support depends on narrow heuristics, host state, Apollo-shaped assumptions, or one executor path only.
  - Evidence exists, but there is a known semantic gap called out in the audit checklist or plan.
  - The class must not be marketed as broadly supported.
- unsupported-but-cleanly-rejected
  - Runtime declines execution early and explicitly.
  - Rejection is deterministic and user-legible: structured error, unmet preflight/eligibility signal, explicit `BLOCKED`/`FAILED`/`NEEDS_REVIEW`, and no false `DONE`.
  - No partial silent mutation that would make recovery ambiguous.
- unsupported-and-badly-handled
  - Anything that silently succeeds, returns `DONE` without business completion, mutates state inconsistently, or fails without preservable evidence.
  - This is an automatic matrix failure.

Evidence package expected for every matrix run
- authored workflow definition used for the run
- exact invocation command or API request payload
- resulting stdout/stderr or API response body
- persisted sequence state after the run
- persisted runtime context after the run when applicable
- approvals log when approvals are involved
- trace events when traces are involved
- artifact directory contents for any artifact-producing flow
- concise verdict note: supported / fragile / unsupported-but-cleanly-rejected

Acceptance rule across the full matrix
- Phase 4 is only complete when each workflow class below has at least one preserved representative run with an explicit verdict and evidence package.
- The readiness claim may rise only to the narrowest level actually proven by those runs.

---

## 1) Pure shell workflow

Minimal representative workflow
- A shell-mode step with no native actions, no approvals, no Apollo assumptions, and a simple artifact or output side effect.
- Smallest useful example:
  - one `model: shell` step
  - prompt resolves from workspace-local prompt file
  - shell script writes a deterministic artifact under workspace control and exits 0
  - optional second step depends on the first to prove downstream readiness after `DONE`
- This should be the canonical “nothing fancy, just run shell safely” proof.

Acceptance criteria
- Runtime dispatches to `sh` with a workspace-local temp prompt file, not a hidden host-global prompt path.
- Step finishes `DONE` only when the shell command actually completes and expected artifact/output exists.
- If the shell step emits an obvious blocker/refusal/tool-unavailable message with exit 0, runtime must downgrade to `NEEDS_REVIEW` rather than `DONE`.
- Dependency progression after a true `DONE` is preserved.
- No Apollo-specific runtime context is required.

Required preserved evidence
- shell prompt file path under `.threados/tmp-prompts/...`
- command/args actually dispatched
- artifact produced by the shell script or captured stdout proving completion
- final step status in persisted sequence
- run response JSON or CLI JSON output
- if testing the blocked/refusal variant, preserved stdout proving the downgrade case

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - both dispatch shape and completion semantics hold with no external tool assumptions beyond shell itself
- fragile
  - shell path works only in one executor path, or `DONE` still depends mainly on exit code without evidence for the chosen artifact-producing step
- unsupported-but-cleanly-rejected
  - missing shell/bad prompt path/unwritable workspace yields explicit failure before false success

Likely validation commands / harness shape
- Existing harness anchor:
  - `bun test lib/runner/dispatch.test.ts`
  - `bun test test/api/run-route-coverage.test.ts`
- Phase 4 proof shape:
  - CLI proof: a focused `lib/seqctl/commands/run.test.ts` case or equivalent fixture-backed integration run
  - API proof: a focused `test/api/run-route-coverage.test.ts` case using `model: 'shell'`
  - Preserve the written artifact and resulting sequence JSON

---

## 2) Native-action workflow

Minimal representative workflow
- One step that combines a normal agent/shell execution path with native actions that mutate runtime context and filesystem.
- Smallest representative set should cover the action types already exercised by current tests:
  - `cli`
  - `write_file`
  - `sub_agent`
  - `composio_tool` (use current naming; `rube` is legacy)
- Keep it non-Apollo in concept even if current fixtures use Apollo-shaped names. The proof claim is about native action plumbing, not Apollo business logic.

Acceptance criteria
- Actions execute in deterministic order.
- Each action writes its documented output into runtime context under the expected `output_key`.
- Files claimed as written actually exist and contain expected content.
- Sub-agent result is persisted with enough evidence to distinguish success from empty/false success.
- Tool action result is persisted and attributable to the invoked tool slug and arguments.
- CLI/API parity must hold for the same representative workflow class.

Required preserved evidence
- workflow definition showing ordered native actions
- runtime context JSON after the run
- artifact files written by `write_file` or child process
- child/sub-agent output summary and exit code
- tool invocation result payload
- final sequence state and response JSON for both CLI and API proofs

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - CLI and API both run the same native-action pattern and persist equivalent semantic outputs
- fragile
  - works only for Apollo-shaped context keys, or only one executor path proves it, or sub-agent completion still relies on narrow heuristics
- unsupported-but-cleanly-rejected
  - unavailable tool/action capability aborts or blocks explicitly with attributable error and without leaving a false `DONE`

Likely validation commands / harness shape
- Existing harness anchors:
  - `bun test lib/seqctl/commands/run.test.ts`
  - `bun test test/api/run-route-coverage.test.ts`
- Phase 4 proof shape:
  - paired CLI/API representative tests using the same action bundle
  - preserve resulting runtime-context JSON and any emitted artifacts
  - add one failure-path proof where a tool/native action is unavailable and the workflow rejects cleanly

---

## 3) Approval-heavy workflow

Minimal representative workflow
- A workflow where the main outcome is governed by approval semantics rather than raw process success.
- Smallest useful example:
  - step A requires approval action before execution or completion
  - step B depends on step A
  - SAFE mode path records approval lifecycle
  - POWER mode variant proves intentional bypass behavior separately
- Include one case where approval notes hydrate from runtime context without relying on Apollo-only semantics.

Acceptance criteria
- Approval request is persisted with correct target reference and actor attribution.
- SAFE mode creates the expected pending/approved lifecycle for the policy confirmation path.
- Native step approval remains pending when human review is actually required.
- Dependent steps remain waiting/READY until approval-governed predecessor is resolved.
- Trace events reflect approval-requested / approval-resolved transitions.
- POWER mode behavior, if intentionally different, is explicitly preserved as intentional divergence rather than accidental drift.

Required preserved evidence
- approvals log entries
- trace events log
- sequence state before/after showing `BLOCKED` or downstream waiting behavior
- API/CLI response payload proving whether work executed or halted
- hydrated approval note content when runtime-context templating is exercised

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - approval lifecycle is explicit, durable, and stops downstream progress correctly until resolved
- fragile
  - approval semantics differ materially between CLI and API, or SAFE vs POWER behavior exists without crisp documentation, or approval/gate authority remains ambiguous
- unsupported-but-cleanly-rejected
  - approval-required run blocks explicitly and durably, with preserved pending approval and no hidden execution

Likely validation commands / harness shape
- Existing harness anchors:
  - `bun test test/api/run-approval-proof.test.ts`
  - `bun test test/api/run-route-coverage.test.ts`
- Phase 4 proof shape:
  - API-first proof for approval lifecycle because current evidence is strongest there
  - add CLI twin if approval semantics are claimed on CLI too
  - preserve approvals repository output and trace log as first-class evidence

---

## 4) Optional-branch workflow

Minimal representative workflow
- A workflow with one conditional branch that selects exactly one path and leaves the non-taken branch inert.
- Smallest useful example:
  - runtime-context seed or deterministic flag
  - one step with `conditional` native action choosing between `if_true` and `if_false`
  - one sibling step with false condition becoming durably `SKIPPED`
  - one downstream step depending on the branch result or skipped branch semantics
- This is the proof class for “optional paths do not deadlock the workflow.”

Acceptance criteria
- Condition evaluation is based on persisted runtime context, not ad hoc process memory.
- Only the selected branch executes.
- Non-selected branch outputs are absent.
- False-condition step/branch becomes durably `SKIPPED` where the model says it should be skipped.
- Downstream dependency satisfaction treats `SKIPPED` and non-taken optional branches according to the current runtime rules.
- No hidden execution occurs on the non-selected branch.

Required preserved evidence
- input runtime-context JSON used to drive the branch
- response payload showing which step executed and which waited/skipped
- final runtime-context JSON proving only selected-branch keys exist
- final sequence state proving durable `SKIPPED` where expected
- trace log if branch/gate evaluation is recorded there

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - selected branch executes once, non-selected branch stays inert, and downstream dependencies do not deadlock
- fragile
  - branch selection works only for narrow context shapes, or `SKIPPED` semantics still fail in adjacent dependency patterns
- unsupported-but-cleanly-rejected
  - invalid condition context or unsupported branch action fails/blocks explicitly without mutating both branches or returning false `DONE`

Likely validation commands / harness shape
- Existing harness anchors:
  - `bun test test/api/run-route-coverage.test.ts`
  - `bun test lib/gates/rules.test.ts`
- Phase 4 proof shape:
  - API harness with seeded runtime context and one deterministic branch-selection action
  - CLI twin if branch parity is claimed
  - preserve runtime-context JSON and final sequence YAML/JSON snapshot

---

## 5) Tool-driven workflow

Minimal representative workflow
- A workflow whose key business step is invoking an external tool capability rather than only running a prompt.
- Smallest useful example:
  - one composio-backed tool action with deterministic stubbed response
  - one success path that persists tool result into runtime context
  - one failure path with `on_failure: abort_workflow`
  - one later step proving abort semantics prevent accidental downstream execution
- This class covers tool authority, tool failure handling, and “no false success when the tool is the real work.”

Acceptance criteria
- Tool invocation payload preserves the exact tool slug and arguments.
- Successful tool result lands in runtime context under the intended key.
- Failure path with abort semantics marks the owning step `FAILED` and prevents later steps from running.
- Error surface is attributable to the failed tool action, not hidden under a generic success payload.
- If tool output is business-critical for claiming completion, absence of the output cannot still yield `DONE`.

Required preserved evidence
- invoked tool slug and arguments
- raw or normalized tool result payload
- runtime-context JSON showing persisted tool output on success
- sequence state showing `FAILED` and downstream non-execution on abort failure
- response payload containing explicit tool failure message

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - success and abort-failure semantics are both preserved, with no downstream leakage on failure
- fragile
  - tool success path works only with mocks, or failure semantics still rely on handwritten heuristics not generalized across tool classes
- unsupported-but-cleanly-rejected
  - unavailable tool/auth issue returns explicit failure or `NEEDS_REVIEW` without claiming completion

Likely validation commands / harness shape
- Existing harness anchors:
  - `bun test test/api/run-route-coverage.test.ts`
  - `bun test lib/seqctl/commands/run.test.ts`
- Phase 4 proof shape:
  - one stubbed-success tool run
  - one stubbed failure run with `abort_workflow`
  - preserve runtime-context JSON and final sequence state for both

---

## 6) Hosted / sandbox-sensitive workflow

Minimal representative workflow
- A workflow whose execution depends on hosted or sandbox-specific eligibility rather than just local shell/process availability.
- Smallest useful example:
  - one route or runtime entrypoint checking hosted/sandbox eligibility (for current repo, thread-runner / VM access is the clearest representative shape)
  - locked/default case where eligibility is unmet
  - optionally one synthetic all-green case in unit scope proving the happy-path decision function, without claiming full hosted runtime readiness
- This class is primarily about clean rejection and preflight honesty, not broad hosted execution proof.

Acceptance criteria
- When hosted/sandbox prerequisites are unmet, runtime or route returns structured eligibility data rather than pretending support.
- Response includes unmet requirement keys and labels that explain the rejection surface.
- No workflow is marked `DONE` merely because a hosted capability was bypassed or absent.
- If a happy-path unit proof is included, it must be clearly labeled as decision-logic proof, not end-to-end hosted runtime proof.
- This class remains unsupported until real hosted execution evidence exists; Phase 0 requires only a clean-rejection standard now.

Required preserved evidence
- eligibility response body or preflight failure payload
- requirement list showing which hosted/sandbox prerequisites are unmet
- any feature flag or base-path setup used to trigger the check
- for synthetic happy-path unit proof, unit assertion output proving eligibility logic only

Supported vs fragile vs unsupported-but-cleanly-rejected
- supported
  - only after real hosted/sandbox execution evidence exists end-to-end; this is not yet established by current repo evidence
- fragile
  - local mocks can prove eligibility branching, but there is still no end-to-end hosted runner execution proof
- unsupported-but-cleanly-rejected
  - current expected baseline: unmet VM/identity/subscription prerequisites return structured ineligibility cleanly and truthfully

Likely validation commands / harness shape
- Existing harness anchors:
  - `bun test lib/thread-runner/eligibility.test.ts`
  - `bun test test/api/thread-runner-eligibility-route.test.ts`
- Phase 4 proof shape
  - preserve route response showing locked requirements
  - if later hosted runtime exists, add a separate true end-to-end proof; do not let unit eligibility tests masquerade as hosted support proof

---

## Cross-matrix acceptance notes

CLI/API parity expectations
- Pure shell, native-action, and tool-driven classes should be treated as parity-sensitive.
- Approval-heavy and optional-branch classes should prove parity where the product claims parity; otherwise the doc/result must mark the limitation explicitly.
- Hosted/sandbox-sensitive class does not currently require CLI/API parity proof; it requires truthful, structured rejection.

What must be true before a class can move from fragile to supported
- no known false-success path for that class remains open in the current audit framing
- evidence package can be reproduced from a clean worktree/head
- if the class claims parity, both executor paths are proven
- if the class depends on preflight or eligibility, unmet prerequisites are explicit and stable

What automatically fails the matrix
- `DONE` without preserved evidence for the class’s claimed business completion
- executor drift where one path blocks/fails and the other claims success for the same workflow semantics
- non-selected optional branch executing anyway
- approval-required work executing silently without approval evidence
- tool/hosted prerequisite failure being masked as success

Recommended Phase 4 execution order
1. pure shell
2. optional-branch
3. approval-heavy
4. native-action
5. tool-driven
6. hosted/sandbox-sensitive

Rationale
- Start with the lowest-externality class.
- Prove branch and approval semantics before leaning on richer action/tool flows.
- Leave hosted/sandbox-sensitive until last because the likely honest outcome today is still unsupported-but-cleanly-rejected.

Bottom line
- This matrix defines the minimum honest bar for claiming broader runtime readiness.
- Today, based on current repo evidence, native-action, approval, branching, and tool flows have partial proof shapes but not yet a finalized preserved non-Apollo readiness package.
- Hosted/sandbox-sensitive flows should currently be expected to pass only the unsupported-but-cleanly-rejected bar unless later real hosted execution proof is added.
