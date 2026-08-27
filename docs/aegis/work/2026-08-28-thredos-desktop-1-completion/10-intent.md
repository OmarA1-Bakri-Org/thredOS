# thredOS Desktop 1.0 completion intent

## Requested outcome

Finish Milestones 0 through 5 against the canonical PRD, with truthful runtime ownership, portable Surface Workspaces, Change Sets and controlled apply, bounded concurrency, the complete operator loop, and release evidence.

## Scope and stop states

- In scope: the runtime, workspace, Change Set, merge/apply, concurrency, UI/CLI/API/chat parity, hardening, documentation, proofs, and task-owned local commits required by the canonical milestones.
- Non-goals: host-enforced Milestone 6, Thread Runner marketplace expansion, broad visual redesign, worktree-based development, destructive cleanup of protected state, push/PR/merge/release without explicit authority.
- Stop states: `done`, `blocked`, `needs-verification`, or `scope-exceeded`.

## Canonical baseline read set

All required authority files were read completely before the first write:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md`
2. `AGENTS.md`
3. `docs/plans/m0-m1-repository-implementation-plan.md`
4. `docs/plans/m0-m1-pr-manifest.yaml`
5. `docs/product/current-state.md`
6. `docs/product/architecture-map.md`
7. `docs/cli-reference.md`

No `CONTEXT.md` or `CONTEXT-MAP.md` exists in the repository.

## TaskStartSnapshot

- Captured: 2026-08-28, native Windows PowerShell.
- Branch: `codex/canonical-completion`.
- HEAD: `a184542e9839fc1406d4fbb4bcccd63f4ec0a4bf`.
- `origin/main`: `8eb1a99ab44bff459b5630c4f6c1c014dc57175f`.
- Merge base: `8eb1a99ab44bff459b5630c4f6c1c014dc57175f`.
- Ahead/behind: 47/0.
- Staged paths: 0.
- Modified tracked paths: 18.
- Untracked paths: 170.
- Protected pre-existing areas: `.omx/`, `.token-optimizer/`, `.worktrees/`, `.git/worktrees/`, launch/commercial documentation, historical review artifacts, and all unrelated dirty paths.
- Git fetch updated remote refs but reported permission-denied cleanup for 53 protected `.git/worktrees/` metadata entries. No cleanup was attempted.
- Relevant running application processes: none; only codebase-memory MCP servers were observed.
- Latest pre-task evidence: M0, UI, and local proof artifacts under `test-results/verify/` from 2026-08-28.

## TDD Route

- Mode: auto.
- Decision: strict for behavior and contract repairs.
- Strict authority: the task explicitly requires failing tests first where practical.
- Test posture: real regression or integration tests at the canonical owner and consumer boundary.
- Verification: focused RED/GREEN, related regressions, per-PR gates, milestone proofs, independent spec and quality review.

## Architecture and compatibility boundary

- `ThreadOSRuntimeService` remains the canonical lifecycle owner.
- Interface layers only parse, authorize, invoke services, and render typed results.
- Existing API/CLI JSON contracts and legacy read projections remain compatible.
- No worktree invocation, database introduction for M0–M1, hidden host-isolation claims, canonical shared writes, or destructive legacy migration.
- M0 remains sequential; M1 adds isolation; M2 adds controlled apply; M3 activates concurrency.

## Impact statement

This task changes runtime status derivation, interface ownership, approval evidence, workspace isolation, persistence, process scheduling, canonical apply, and release surfaces. Every slice requires owner-level tests, persisted-state inspection, independent review, and rollback notes.
