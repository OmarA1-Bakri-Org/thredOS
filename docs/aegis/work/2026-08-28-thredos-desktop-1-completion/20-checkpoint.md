# Todo checkpoint

## Current goal

Close the verified Milestone 0 correctness and ownership defects without changing the sequential M0 scheduling boundary.

## Active slice

Phase 0 closeout gate:

M0 proof, UI proof, and local proof are green. Final approval-consumption repair is implemented and reviewed; rerun the integrated M0 proof before closing Phase 0.

## Completed

- Captured TaskStartSnapshot.
- Refreshed the codebase-memory index: 5,557 nodes and 12,702 edges.
- Read the complete canonical baseline.
- Ran the pre-edit baseline: frozen install made no changes; lint, typecheck, and 1,829 tests passed.
- Phase 0 Task 1: extracted truthful terminal run-outcome derivation, persisted `awaiting_review`, `partially_successful`, and `interrupted` results, and aligned `/api/stop` with the latest running attempt.
- Task 1 strict TDD, specification review, TypeScript-quality review, and coordinator verification passed.
- Phase 0 Task 2: removed chat/apply runtime-control and lifecycle-field bypasses, constrained structured and fallback parsers, and made full/partial/rejected apply results and audit evidence truthful.
- Task 2 strict TDD, specification review, TypeScript-quality review, and coordinator verification passed.
- Phase 0 Task 3: added exact/unbound approval binding, atomic approval lifecycle and resolution, trusted resolver identity, honest public authority projection, expiry/consumption enforcement in the sole matcher, and explicit committed trace-projection failure evidence.
- Task 3 strict TDD, specification/security review, TypeScript-quality review, and coordinator verification passed.
- Phase 0 Task 4: trace and approval evidence now distinguish loading, unavailable, true-empty, and populated states without optimistic zero counts.
- Task 4 strict TDD, specification review, React/TypeScript-quality review, and coordinator verification passed.
- Phase 0 Task 5: replaced the incomplete fixed lifecycle allowlist with recursive AST-based discovery, explicit classification, fail-closed traversal reporting, chat/apply rejection proof, and adversarial import/origin/shadowing coverage.
- Task 5 strict TDD, specification review, TypeScript/verifier-quality review, and coordinator verification passed.
- Integrated `bun run verify:m0` passed after one repaired stale-fixture iteration: 50 focused tests, 1,927 full-suite tests across 228 files, typecheck, lint, and production build.
- UI proof passed 12/12 and local operator-flow proof passed 11/11.
- Final independent review found exact approvals were replayable. Atomic consume-on-use, pre-spawn failure handling, and confirmed-approval atomic `pending -> approved -> consumed` persistence were implemented and approved by spec and TypeScript/concurrency reviewers.

## Boundaries

- No production source write before a focused failing test.
- No M1 work until all Critical/High M0 findings pass spec review, quality review, and the M0 gate.
- No modification or cleanup of protected pre-existing Git/worktree/OMX state.
- Coordinator owns Git staging and commits.

## Resume state

Resume by re-reading `10-intent.md`, this checkpoint, the canonical authority set, and live Git status. Compare all current changes with the TaskStartSnapshot before editing.

## Next

Rerun `bun run verify:m0` on the approval-consumption repair, then close Phase 0 only if the full proof remains green.

## Drift decision

`continue` — the slice directly closes documented Implementation Drift and stays within M0 authority.
