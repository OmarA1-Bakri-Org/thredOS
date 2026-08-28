# Todo checkpoint

## Current goal

Close the verified Milestone 0 correctness and ownership defects without changing the sequential M0 scheduling boundary.

## Active slice

PR-09 immutable baseline snapshot engine:

Implement the canonical dirty/non-Git-safe snapshot algorithm only after the PR-08 commit is read back and green.

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
- Final post-consumption `bun run verify:m0` passed: 50 focused tests, 1,934 full-suite tests across 228 files, typecheck, lint, and production build.
- Post-consumption UI proof passed 12/12; post-consumption local proof passed 11/11.
- Phase 0 status: complete for the authorized M0 correctness boundary; this is not M1 or Desktop 1.0 completion.
- PR-08 correction: safe external runtime roots, strict workspace config, authoritative exclusions, validated identity state, atomic workspace repository records, and factual docs passed the focused gate and two-stage review.
- PR-09 Task A: deterministic portable manifests, safe integer accounting, immutable lifecycle records, corruption-safe generation publication, stable manifest references, and workflow-compatible snapshot schemas were committed as `d4ade45` after independent spec and TypeScript/security approval.
- PR-09 Task B: clean/dirty Git and non-Git capture, bounded no-follow streaming copies, source-race retry, symlink and runtime-namespace containment, content-addressed read-only trees, workflow-run-scoped reuse, trace evidence, and factual architecture/current-state documentation passed the canonical focused gate and full repository check.
- PR-10: portable-copy provider, manager-owned workspace lifecycle, atomic active/retained quota reservation, M1-safe retention, recoverable cleanup, workspace doctor, canonical per-workspace records, exact attempt workspace references, and workspace lifecycle traces passed focused verification and three-lane review.

## Boundaries

- No production source write before a focused failing test.
- No M1 work until all Critical/High M0 findings pass spec review, quality review, and the M0 gate.
- No modification or cleanup of protected pre-existing Git/worktree/OMX state.
- Coordinator owns Git staging and commits.

## Resume state

Resume by re-reading `10-intent.md`, this checkpoint, the canonical authority set, and live Git status. Compare all current changes with the TaskStartSnapshot before editing.

## Next

Commit and read back the approved PR-10 paths, then start PR-11 isolated workspace planning and dispatch TDD.

## Drift decision

`continue` — the slice directly closes documented Implementation Drift and stays within M0 authority.
