# Evidence bundle draft

## Baseline evidence

- `bun install --frozen-lockfile` — passed, 776 installs checked, no changes.
- `bun run lint` — passed.
- `bun run typecheck` — passed.
- `bun test` — 1,829 passed, 0 failed, 4,831 assertions across 222 files.
- Codebase-memory moderate index — 5,557 nodes, 12,702 edges.

## Evidence boundary

The green baseline does not cover the known runtime-status, chat/apply ownership, evidence-query error, generic approval-binding, or exhaustive lifecycle-discovery defects. Those require new failing tests before repair.

## Phase 0 Task 1

- RED: run-outcome test initially failed because the owner module did not exist.
- RED: stop-route test initially failed because the API did not filter to running attempts.
- GREEN coordinator regression: 107 passed, 0 failed across seven focused runtime/API files.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `git diff --check` for task-owned paths — passed.
- Specification review — approved after service-level persisted run/receipt coverage was added.
- TypeScript-quality review — approved after canonical error-code typing, discriminated outcomes, typed boundary failures, gate-driven review evidence, and boundary tests were added.

## Phase 0 Task 2

- RED iterations proved runtime commands, lifecycle `status` updates, malformed fallback actions, false approved lifecycle evidence, and false full-batch success in the prior chat/apply path.
- GREEN coordinator regression: 188 passed, 0 failed across 14 focused chat/apply/component files.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `git diff --check` for task-owned paths — passed.
- Specification review — approved after rejected and mixed batches preserved valid mutations, ordered results, applied/rejected audit evidence, and zero false approval lifecycle.
- TypeScript-quality review — approved after lifecycle-field removal, truthful batch result typing, canonical command ownership, parser hardening, and bounded subprocess cleanup.

## Phase 0 Task 3

- RED iterations proved missing runtime approval binding, trusted-resolver drift, sequential-only duplicate protection, unbound runtime lifecycle creation, expiry/consumption matcher gaps, trace-error leakage, and failure-non-atomic approval writes.
- GREEN coordinator regression: 64 passed, 0 failed across nine focused approval, policy, apply, export, and contract files.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `git diff --check` for task-owned paths — passed.
- Specification/security review — approved after exact binding, atomic resolve/lifecycle, locked reads, honest public projection, and no fabricated chat-apply approvals.
- TypeScript-quality review — approved after runtime action-type enforcement, sanitized trace warnings, synchronous locked transitions, explicit committed trace status, and failure-atomic full-file replacement.

## Phase 0 Task 4

- RED: evidence-state tests proved query errors and pending undefined data were rendered as authoritative empty/zero state.
- GREEN coordinator regression: 17 passed, 0 failed across RuntimeEvidenceState and RunSection tests.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `git diff --check` for task-owned paths — passed.
- Specification and React/TypeScript-quality reviews — approved after explicit `error -> loading -> empty -> data` precedence and non-authoritative metrics.

## Phase 0 Task 5

- RED iterations proved fixed-list omission, comment/string evasion, removed ownership checks, same-named false positives, alternate import forms, alias/namespace/shadowing bypasses, silent traversal failures, unbound canonical service references, and static-template import bypasses.
- GREEN coordinator regression: 32 passed, 0 failed across the helper and live architecture test.
- Live boundary scan: 20 classified candidates, zero unclassified, zero traversal errors, zero violations.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `git diff --check` for task-owned paths — passed.
- Specification and TypeScript/verifier-quality reviews — approved after AST origin proof and fail-closed traversal/import analysis.

## Phase 0 integrated M0 proof

- First full proof iteration found two stale test assumptions: review-required runs expected `failed`, and an exact approval fixture omitted payload/policy binding. Production behavior remained aligned with the repaired contracts.
- Repaired focused regression: 53 passed, 0 failed.
- Final `bun run verify:m0`: 50 focused tests passed; full repository 1,927 passed, 0 failed across 228 files; production build passed.
- Evidence: `test-results/verify/m0/2026-08-28T02-50-29-900Z/m0-proof`.
- UI evidence: `test-results/verify/ui/2026-08-28T02-56-55-223Z` — 12/12 passed.
- Local evidence: `test-results/verify/local/2026-08-28T02-58-53-343Z` — 11/11 passed.

## Final approval consumption repair

- Final independent review identified replayable exact approvals because consumption fields were never mutated.
- Atomic repository consumption now has exactly one concurrent winner and validates current exact subject, expiry, action type, target, and digest.
- Existing exact approvals are consumed before process binding/spawn; missing or failed consumption blocks with `APPROVAL_CONSUMPTION_FAILED`.
- Newly confirmed SAFE approvals persist `pending -> approved -> consumed` in one atomic replacement; injected failure leaves no approval or process residue and retry succeeds.
- Coordinator focused regression: 86 passed, 0 failed; typecheck and lint passed.
- Specification/security and TypeScript/concurrency reviews — approved.
