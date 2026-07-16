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

## Independent review corrections

An independent review rejected the first implementation on four durability boundaries. The correction pass now:

- revalidates the complete parent path at lock creation, temp-file creation, and final rename, including deterministic directory-swap tests for runtime and thread-surface records;
- treats stale, malformed, identity-mismatched, or unsafe attempt/process index entries as derived-data failures, scans authoritative records, and rebuilds the index once on a best-effort basis;
- keeps every read-only repository lookup side-effect free, so absent runtime state does not create `.threados`, entity roots, or phantom directories; and
- records lock ownership metadata, fails closed for live owners, recovers dead or expired owners, and prevents a derived-index lock failure from invalidating an already committed authoritative record.

The correction pass was test-driven. The expanded suite first failed at module load because the boundary hook did not exist:

```text
bun test lib/runtime/repositories.test.ts lib/thread-surfaces/repository.test.ts
```

RED result: exit 1; both files reported the missing `setAtomicBoundaryHookForTests` export.

Post-correction focused validation:

```text
bun test lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
```

Result: 44 passed, 0 failed, 144 assertions. `bun run typecheck`, `bun run lint`, and the exit-gate fixture proof all exited 0.

Three post-correction exact full-suite attempts completed with no Task 6 failure but encountered unrelated process-test instability under concurrent workspace load: 1642/2, 1643/1, and 1643/1. The final failures were in `lib/runner/wrapper.test.ts` (`successful command`, then `custom env vars`); that complete file passed immediately in isolation with 19 passed and 0 failed. `lib/seqctl/commands/init.test.ts`, which accounted for the first attempt's two failures, likewise passed in isolation with 3 passed and 0 failed. The earlier pre-review full-suite run remains 1638 passed and 0 failed; the corrected exact full suite has not yet produced a zero-failure run.

## Third-review atomic boundary correction

A second independent rejection identified that a valid live lock owner could still be stolen solely because its timestamp was old, and that path validation occurred after lock metadata or temp content had already been written. The third correction keeps valid live owners authoritative regardless of age; the stale threshold applies only to malformed/no-owner lock files, while a valid dead owner remains recoverable.

The correction also captures the exact parent identity before each exclusive open, then verifies the opened file identity and unchanged parent before writing the first byte. A race after the precheck can therefore create at most an empty owned entry. That exact empty entry is removed without a broad external search. After any write begins, relocated-entry cleanup is restricted to a bounded no-follow traversal inside the allowed runtime root (4,096 entries, depth 16) and matches the opened device/inode identity. Tests inspect and restore renamed `.moved` directories and require them to contain no owned lock or temp artifacts.

For final replacement, the temp handle remains open across the last precheck and rename, and the destination is checked for containment and source identity after the operation. On Windows, renaming a directory containing the open source handle is rejected by the operating system (`EPERM`/`EACCES`); the test records that platform protection. On platforms that allow the relocation, the same hook exercises the post-precheck gap and cleanup locates only the matching in-root source. Portable Node filesystem APIs do not provide a cross-platform directory-handle-relative rename primitive, so an uninstrumented hostile swap in the final kernel-call interval can only be detected by the post-operation checks, not made impossible in user space.

Third-cycle RED evidence:

```text
bun test lib/runtime/repositories.test.ts
```

Result: 19 passed, 2 failed. An ancient valid live-PID lock was incorrectly recovered, and the post-open boundary hook was absent so the guarded create unexpectedly resolved. After moving the deterministic Windows test to the permitted after-precheck/before-open boundary, `bun test lib/fs/atomic.test.ts lib/runtime/repositories.test.ts` failed 3 tests because those new boundary stages were not implemented.

Third-cycle final validation:

```text
bun test lib/fs/atomic.test.ts \
  lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
```

Result: 50 passed, 0 failed, 154 expectations. `bun run typecheck`, `bun run lint`, and the fresh-repository exit fixture all exited 0.

The first bounded post-correction exact `bun test` attempt exceeded 180 seconds and left its child process running after the shell timeout. Profiling found no atomic-path slowdown: the atomic/repository/thread-surface trio passed 39/39 in 4.71 seconds, and `bun test lib` completed 1,042 tests in 23.94 seconds with only the known `runStep > custom env vars` process-spawn flake. Process inspection found the timed-out full-suite child plus a separate orphaned repository-test process that predated this correction and had accumulated more than 3,300 CPU seconds; both confirmed test orphans were terminated.

With the workspace idle, the exact full suite completed in 65.19 seconds: 1,646 passed and one unrelated `runStep > successful command` process test failed. No Task 6 test failed. A subsequent isolated wrapper-file run passed `successful command` but encountered the sibling `custom env vars` flake with Windows `ENOTCONN`; that exact failing case then passed alone. This report therefore does not claim a post-third-review full-suite green run, but the 180-second timeout was not reproduced and the Task 6 normal path remained within its prior timing envelope.

## Final-review stale-lock inspection correction

The final review found that orphan-lock recovery still opened and read owner metadata without binding that read to the parent and file identities inspected immediately beforehand. Lock inspection now captures both identities, opens the file handle, verifies the unchanged parent plus opened/path identity before reading, reads at most 4,097 bytes to enforce a 4,096-byte metadata limit, and revalidates after the bounded read. Oversized metadata is treated as an unknown owner and can only recover through the malformed/no-owner stale threshold. The handle closes in `finally`, including hook failures.

These checks provide `THREADOS_SCOPED` path integrity for cooperative runtime operations. They do not provide `HOST_ENFORCED` isolation from a malicious same-privilege process; portable Node filesystem APIs cannot remove every kernel-call race without platform-specific directory-handle-relative primitives.

Final-cycle RED evidence:

```text
bun test lib/fs/atomic.test.ts
```

Result before implementation: 6 passed and 4 failed. Replaced metadata timed out instead of being rejected, the parent-swap and post-open hooks were absent, and a stale oversized live-looking record incorrectly blocked recovery.

Final-cycle validation:

```text
bun test lib/fs/atomic.test.ts \
  lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
```

Result: 54 passed, 0 failed, 163 expectations. `bun run typecheck`, `bun run lint`, and the fresh-repository exit fixture all exited 0.

The bounded exact full-suite attempt exceeded 180 seconds while an unrelated `test/api/conflict-routes.test.ts` child process remained active in its sequence-reset subprocess. The orphaned test tree was terminated; that complete file then passed 2/2 in isolation. No full-suite green claim is made for this final correction.

## Path drift and compatibility

- The plan allowed modifications to `lib/runner/artifacts.ts`; none were needed because legacy artifact writing remains untouched and export discovery can discriminate the canonical `run.json` schema.
- `lib/exports/schema.ts` received additive fields because explicit source/schema evidence is part of canonical export behavior. Defaults preserve existing bundle validation.
- The PR-01 legacy definitions remain authoritative in `lib/runtime/schema.ts`; the new required projection module re-exports them rather than duplicating schemas or mappings.

## Rollback and remaining risks

Rollback is a clean revert of this PR-02 commit. Legacy readers/writers remain available and no migration was performed.

- Lock acquisition is bounded and fails closed while a live owner holds the lock. Dead owners and locks past the bounded stale threshold are recoverable from persisted owner metadata.
- Rebuilding the derived index is an authoritative filesystem scan and is intentionally more expensive than an indexed read.
- Repository APIs are not yet the application runtime path. PR-03 performs the shared runtime service and scheduler integration.
