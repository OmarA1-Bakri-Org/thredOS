# Todo checkpoint

## Current goal

Close the verified Milestone 0 correctness and ownership defects without changing the sequential M0 scheduling boundary.

## Active slice

Phase 0 Task 4:

1. Render trace and approval retrieval failures as unavailable evidence.
2. Make lifecycle-interface discovery exhaustive and fail on unclassified handlers.

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

## Boundaries

- No production source write before a focused failing test.
- No M1 work until all Critical/High M0 findings pass spec review, quality review, and the M0 gate.
- No modification or cleanup of protected pre-existing Git/worktree/OMX state.
- Coordinator owns Git staging and commits.

## Resume state

Resume by re-reading `10-intent.md`, this checkpoint, the canonical authority set, and live Git status. Compare all current changes with the TaskStartSnapshot before editing.

## Next

Create the minimal failing tests for unavailable runtime evidence UI and unclassified lifecycle-interface discovery.

## Drift decision

`continue` — the slice directly closes documented Implementation Drift and stays within M0 authority.
