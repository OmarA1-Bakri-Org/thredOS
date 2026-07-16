# Task 6 report: PR-02 atomic runtime repositories and idempotency

## Outcome

Implemented canonical atomic repositories for workflow runs, attempts, process evidence, command receipts, and the derived runtime index. V2 records coexist with legacy artifacts; no runtime service, scheduler, API, CLI, or canonical-workspace execution path was cut over.

## Changed files

- Added `lib/runtime/paths.ts`, `run-repository.ts`, `attempt-repository.ts`, `process-repository.ts`, `command-repository.ts`, `runtime-index.ts`, and focused repository tests.
- Added the read-only `lib/runtime/legacy-projection.ts` re-export surface and legacy/export discovery tests.
- Extended `lib/fs/atomic.ts` with sibling cross-process `wx` locks, durable temp-file writes, atomic replacement, failure cleanup, and a test-only pre-rename hook.
- Upgraded thread-surface revision checks to run inside the same sibling lock/re-read transaction.
- Extended exports additively with explicit `run_source`, `run_schema_version`, and canonical V2 attempt discovery. Existing bundle parsing remains valid through schema defaults.

## Contract and security behavior

- Canonical paths are `.threados/runs/<runId>/run.json`, nested attempt/process records, `.threados/state/runtime-commands/<commandId>.json`, and `.threados/state/runtime-index.json`.
- Every path-bearing ID uses the existing portable safe-segment validator. Repository boundaries reuse safe containment and no-follow reads.
- Create/update transactions acquire a sibling exclusive filesystem lock, re-read authoritative bytes, enforce numeric expected revision, atomically replace, and clean locks in `finally`.
- The runtime index is derived only. Missing, corrupt, stale, or unsafe mixed-separator references trigger an authoritative scan and rebuild.
- Idempotency uses a SHA-256 digest only for lock/index lookup. Raw keys are never filenames. Exact-key/exact-hash replay returns the original receipt; changed request hashes fail `IDEMPOTENCY_CONFLICT`.
- Attempts never mutate the owning run record. Process records live under their owning attempt.
- Legacy projection is pure/read-only and covers every legacy status. Retry behavior remains a later service concern; this PR does not rewrite legacy bytes.
- Export snapshot linkage follows canonical `baseline_snapshot_id`; no `snapshot_id` drift was introduced.

## TDD evidence

Initial RED command:

```text
bun test lib/runtime/repositories.test.ts lib/runtime/legacy-projection.test.ts lib/thread-surfaces/repository.test.ts lib/exports/bundler.test.ts
```

Initial result: exit 1; 15 passed and two module errors. Decisive failures were missing `./run-repository` and `./legacy-projection` (plus their dependent repository modules).

Thread-surface cross-process CAS was separately proved RED by temporarily restoring the prior implementation:

```text
bun test lib/thread-surfaces/repository.test.ts -t "concurrent stale thread-surface"
```

RED result: exit 1 because both stale concurrent writes fulfilled. After the sibling lock/re-read fix, the same command passed with exactly one winner.

Unsafe derived-index references were separately proved RED: a syntactically valid index containing `..\\outside.json` threw instead of rebuilding. The portable-reference schema fix made the focused test pass from authoritative state.

## Final validation

```text
bun test lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
```

Result: 38 passed, 0 failed, 118 assertions across four files.

```text
bun run typecheck
```

Result: exit 0 (`tsc --noEmit`).

```text
bun run lint
```

Result: exit 0; only the existing ESLint poor-concurrency advisory. `.eslintcache` was removed afterward.

```text
bun test
```

Result: 1638 passed, 0 failed, 4083 assertions across 198 files in 62.86 seconds.

Exit-gate fixture proof:

```text
bun test lib/runtime/repositories.test.ts -t "one run and two attempts survive fresh repository instances without overwrite"
```

Result: 1 passed, 0 failed; fresh repository instances reconstructed one run and two distinct attempts.

`git diff --check` passed. Task-scoped scans found no production `git worktree` invocation, no dependency change, no generated runtime state, and no canonical-workspace write/execution cutover.

## Path drift and compatibility

- The plan allowed modifications to `lib/runner/artifacts.ts`; none were needed because legacy artifact writing remains untouched and export discovery can discriminate the canonical `run.json` schema.
- `lib/exports/schema.ts` received additive fields because explicit source/schema evidence is part of canonical export behavior. Defaults preserve existing bundle validation.
- The PR-01 legacy definitions remain authoritative in `lib/runtime/schema.ts`; the new required projection module re-exports them rather than duplicating schemas or mappings.

## Rollback and remaining risks

Rollback is a clean revert of this PR-02 commit. Legacy readers/writers remain available and no migration was performed.

- Lock acquisition has a bounded five-second wait and fails closed if a live lock remains; stale-lock recovery is intentionally deferred to service/recovery work rather than risking concurrent ownership.
- Rebuilding the derived index is an authoritative filesystem scan and is intentionally more expensive than an indexed read.
- Repository APIs are not yet the application runtime path. PR-03 performs the shared runtime service and scheduler integration.
