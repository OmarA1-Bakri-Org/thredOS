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
