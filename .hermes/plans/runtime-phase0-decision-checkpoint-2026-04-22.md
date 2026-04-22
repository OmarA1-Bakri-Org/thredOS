# Runtime Phase 0 Decision Checkpoint — 2026-04-22

Status: decided
Scope: prerequisite contract for Phase 1 runtime finish work
Applies to: runtime semantics, pack/install prompt handling, completion hardening, CLI/API parity

## Context

This checkpoint is the contract Phase 1 must follow.
It resolves the remaining design ambiguity called out by the verified finish plan before more runtime code lands.

Grounding used:
- `/home/omar/.hermes/plans/2026-04-22_091759-lets-finish-the-runtime-set-out-the-plan.md`
- `/home/omar/.hermes/plans/audit-closure-checklist-2026-04-22.md`
- repo evidence in:
  - `lib/sequence/schema.ts`
  - `lib/gates/rules.ts`
  - `lib/gates/engine.ts`
  - `lib/runner/dispatch.ts`
  - `lib/packs/compiler.ts`
  - `lib/packs/install.ts`
  - `lib/packs/compiler.test.ts`
  - `lib/packs/install.test.ts`
  - `docs/product/current-state.md`
  - `docs/product/developer-onboarding.md`

Note: the requested files `.hermes/audits/runtime-audit.md`, `.hermes/audits/runtime-roadmap.md`, and `.hermes/audits/state-audit.md` were not present in this worktree at the requested paths. This record therefore anchors to the verified finish plan, the audit-closure checklist, and live repo evidence.

---

## 1) Runtime state / authority model

### Decision

`SKIPPED`, `BLOCKED`, and `NEEDS_REVIEW` are distinct runtime outcomes and must not be treated as interchangeable soft failures.

- `SKIPPED` = terminal non-execution by design
- `BLOCKED` = non-terminal execution prevention by an unmet authority or dependency condition
- `NEEDS_REVIEW` = terminal execution outcome where the process ran or appeared to complete, but runtime cannot honestly claim business completion

### Operational meaning

#### `SKIPPED`

A step is `SKIPPED` when runtime intentionally does not execute it because its condition resolves false or its branch is not taken.

Operational rules:
- terminal for that run state
- counts as dependency satisfaction for downstream steps by default
- does not require approval replay or reopening
- does not imply error, refusal, or operator action needed
- should preserve why it was skipped in evidence/reason material when available, but the status itself is sufficient to unblock dependents

This matches current dependency behavior in `lib/gates/rules.ts`, where `DONE` and `SKIPPED` satisfy step dependencies.

#### `BLOCKED`

A step is `BLOCKED` when runtime cannot legally or safely execute it yet.

Operational rules:
- non-terminal in workflow intent; it is resumable/reopenable
- does not satisfy downstream dependencies
- requires an external state change before retry becomes valid
- external state change can be: dependency completion, gate approval, reveal/access change, or explicit operator/policy approval
- a retry after the blocking cause is cleared should reopen from `BLOCKED` rather than invent a new semantic path

`BLOCKED` is for unmet authority to start, not for uncertain success after execution.

#### `NEEDS_REVIEW`

A step is `NEEDS_REVIEW` when execution happened or a zero-exit result was returned, but runtime lacks enough evidence to say the work is truly complete.

Operational rules:
- terminal for the current attempt
- does not satisfy downstream dependencies automatically
- should require human or explicit follow-up workflow action before the workflow can honestly proceed as complete
- is the correct downgrade for obvious refusals, permission denials, unavailable tools, and similarly ambiguous zero-exit outcomes
- is not a substitute for `BLOCKED`; if runtime knew before execution that the step could not legally run, the status should have been `BLOCKED`

This matches current dispatch hardening in `lib/runner/dispatch.ts`, where exit code `42` and obvious non-completion payloads map to `NEEDS_REVIEW`.

### Authority precedence

### Decided precedence order

1. dependency state
2. gate/policy/access authority to execute
3. approval evidence that satisfies an approval requirement within the gate/policy layer
4. post-execution completion assessment

Equivalent rule:
- runtime may claim `DONE` only if dependencies were satisfied, execution authority passed, required approvals were present, and completion assessment passed

### Precedence details

#### Dependencies outrank everything else

If a required dependency is not satisfied, the step is not runnable, full stop.

Why:
- `lib/gates/rules.ts` already treats dependency failure/missing as blocking evidence
- approval should not bypass dependency order
- a manually approved step whose prerequisites are incomplete is still not runnable

Result:
- unresolved dependency => `BLOCKED`
- approval presence cannot override unsatisfied dependencies

#### Gates/policy/access authority outrank approval reuse as a standalone shortcut

Approvals are not an independent top-level override. They only satisfy an approval requirement inside the execution-authority layer.

Result:
- if policy/access/reveal rules block execution for reasons unrelated to approval, approval does not force execution
- approvals can clear `APPROVAL_MISSING`, but cannot override `DEP_MISSING`, `ACCESS_DENIED`, `REVEAL_LOCKED`, or comparable non-approval blockers

#### Approval outranks prior `BLOCKED` history only when the original block was approval-specific

A step previously marked `BLOCKED` may reopen when the blocking cause was an approval requirement and valid approval evidence now exists.

Result:
- approval replay/reuse is valid only for approval-caused blockage
- Phase 1 must keep or tighten this narrow rule, not broaden it into a generic bypass

#### Completion assessment is last, never first

Completion evidence is evaluated after a step actually runs.

Result:
- pre-execution blockers produce `BLOCKED`
- post-execution ambiguity produces `NEEDS_REVIEW`
- completion logic must not silently reinterpret a pre-execution authority failure as success

### Practical truth table

- dependency unmet -> `BLOCKED`
- dependency satisfied, approval missing for an approval-required step -> `BLOCKED`
- dependency satisfied, approval present, policy/access/reveal still deny -> `BLOCKED`
- step intentionally not taken -> `SKIPPED`
- step executes and returns clear success with required current evidence -> `DONE`
- step executes but output shows refusal / no permission / tool unavailable / ambiguous non-completion -> `NEEDS_REVIEW`

---

## 2) Prompt / install contract

### Decision

Authored prompts are canonical source material.
Installed prompts are derived runtime materializations and must not become the source of truth.

### Canonical contract

There are two layers:

1. authored prompt source
   - pack-authored prompt content or explicit prompt asset content
   - this is the canonical definition of intended behavior

2. installed runtime prompt file
   - concrete materialization under `.threados/prompts/<step>.md`
   - this is an executable copy for the active installed runtime, not the authoritative source

### Why this is the decision

Current repo behavior is inconsistent:
- `lib/packs/compiler.ts` preserves manifest `prompt_file` when explicitly provided and otherwise defaults to `.threados/prompts/<id>.md`
- `lib/packs/install.ts` unconditionally rewrites installed step prompts to `.threados/prompts/<step>.md` and writes prompt content there
- docs say template application writes placeholder prompt files for generated steps

That means install-time files are currently treated as mutable generated artifacts. They should not be elevated to canonical truth, because they are regenerated and normalized during install.

### Required contract for Phase 1 and later Phase 2A

Phase 1 must assume the following contract; Phase 2A must implement it fully:

- pack/compiler/runtime may normalize installed prompt location to `.threados/prompts/<step>.md`
- that installed location is the runtime execution target
- canonical prompt content comes from authored source, not from whatever installed file happens to exist after prior installs
- install must materialize authored content into the installed prompt file deterministically
- if no authored prompt exists yet, runtime may generate a placeholder, but that placeholder is explicitly scaffolding, not canonical content
- editing an installed generated prompt alone must not silently redefine the pack contract

### Immediate implication

Phase 1 must not bake in any assumption that generated installed prompt files are the canonical contract. All parity and runtime semantics work should treat them as derived runtime artifacts.

---

## 3) Completion-evidence scope

### Decision

Immediate scope is narrow hardening against known false-success classes and explicit evidence requirements for a very small number of high-value step classes.
Generalized evidence-contract infrastructure is deferred.

### In scope now

Phase 1 may harden only these areas:

1. strengthen current non-completion detection
   - refusal text
   - permission denial text
   - tool unavailable / environment unavailable text
   - other obvious live false-success payloads found in baseline revalidation

2. preserve the current rule that process success is not enough for `DONE`
   - zero exit alone is insufficient if output contradicts completion

3. add explicit evidence requirements for selected important step classes only
   - limit to 1-2 classes with high operational risk
   - default target classes:
     - side-effecting native/tool steps that claim external mutation
     - steps whose downstream logic depends on a concrete produced artifact or persisted output

4. require simple, concrete evidence forms
   - produced artifact path exists
   - expected structured output key/value exists
   - explicit action result marker exists

### Explicitly out of scope now

Deferred work includes:
- universal evidence schema for every step type
- generalized business-completion ontology across all workflow classes
- broad artifact manifest redesign
- full contract language for every possible tool/native action
- turning completion assessment into a new platform-wide framework before the narrow hardening proves out

### Phase 1 guardrail

If a proposed completion change needs new generic abstractions, cross-cutting schema expansion, or a universal contract DSL, it is out of scope for Phase 1.

The intended order is:
- first: narrow false-success hardening and selected explicit evidence checks
- later: generalized evidence-contract system only if the proof matrix shows it is necessary

---

## 4) CLI / API divergence policy

### Decision

Remaining divergences that affect runtime truth must converge.
Only UX-shaped response differences may remain intentional for now.

### Must converge

These are semantic and cannot remain split:

1. prompt resolution and missing-prompt behavior
   - same step should resolve the same prompt source/path in CLI and API
   - same missing-prompt condition should fail the same way

2. runnable-set / dependency / `SKIPPED` semantics
   - same branch and dependency graph must produce the same runnable frontier
   - `SKIPPED` must satisfy dependencies in both paths

3. approval replay / blocked-step reopening semantics
   - same approval evidence should reopen the same previously approval-blocked step in both paths
   - no executor-specific approval bypasses

4. pre-execution authority outcome
   - dependency, gate, policy, access, and reveal checks must produce the same block/not-block answer

5. post-execution completion downgrade semantics
   - the same execution result must downgrade to `NEEDS_REVIEW` or remain `DONE` identically in both paths

### Can remain intentional for now

These may differ temporarily if semantics stay aligned:

1. response envelope shape
   - CLI human-readable summaries vs API JSON payload format

2. artifact presentation richness
   - CLI may print richer local artifact summaries or console-oriented detail than API returns inline

3. direct invocation ergonomics
   - CLI-only flags or API-only request envelope details are acceptable if they map to the same runtime semantics

4. empty-result presentation
   - representational differences are acceptable only if both mean the same thing semantically
   - they are not acceptable if one path implies success and the other implies blocked/no-op/needs-review

### Policy test

Any divergence is allowed only if both of these are true:
- same input workflow state leads to the same persisted runtime state
- same execution outcome leads to the same semantic status (`DONE` / `BLOCKED` / `NEEDS_REVIEW` / `SKIPPED` / `FAILED`)

If either differs, the divergence must converge.

---

## Phase 1 constraints created by this checkpoint

Phase 1 must follow these boundaries:

- do not treat approval as a general override above dependencies or non-approval gates
- do not treat installed prompts as canonical source truth
- do not expand completion hardening into a universal framework yet
- do not leave semantic CLI/API divergence in approval, dependency, prompt, or completion behavior

---

## Bottom line

The runtime contract is now:
- `SKIPPED` = intentional terminal non-execution that satisfies dependencies
- `BLOCKED` = resumable pre-execution stop caused by unmet authority/dependency conditions
- `NEEDS_REVIEW` = terminal post-execution uncertainty or obvious non-completion
- dependencies outrank approvals; approvals only satisfy approval requirements, not all blockers
- authored prompts are canonical; installed prompts are derived runtime materializations
- immediate completion work is narrow hardening plus selected explicit evidence checks, not a universal framework
- CLI and API must converge on semantic truth, while representational UX differences may remain temporarily
