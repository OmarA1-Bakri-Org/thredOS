# Task 1 report: P0 filesystem containment

Date: 2026-07-16

## Result

Task 1 centralizes opaque file-identifier validation and real-path containment, then applies that contract to the currently implemented library, prompt, pack, run-record, surface, child-sequence, and export boundaries. Request routes now reject unsafe IDs as validation errors before repository access.

No dependency was added. No Git worktree command or implementation was introduced. Existing unrelated dirty files and canonical documents were not modified or staged by this task.

## RED evidence

The tests were added before the corresponding production edits.

### Shared helper missing

Command:

```text
bun test lib/security/safe-path.test.ts
```

Observed output:

```text
error: Cannot find module './safe-path'
0 pass
1 fail
1 error
```

### File-backed boundary escapes/acceptance

Command:

```text
bun test lib/security/file-boundaries.test.ts
```

Observed output before integrations:

```text
1 pass
8 fail
```

The failed expectations showed unsafe library IDs and catalog paths, prompt IDs, run repository IDs, run artifact IDs, surface IDs/sequence refs, and export dot-segments resolving instead of rejecting. The pack fixture was then corrected to a schema-valid manifest so the path boundary—not an unrelated manifest parse error—was under test:

```text
bun test lib/security/file-boundaries.test.ts --test-name-pattern "pack ID"
Expected promise to reject
Received promise resolved
0 pass
1 fail
```

### Manifest-controlled step ID

Command:

```text
bun test lib/security/file-boundaries.test.ts --test-name-pattern "pack manifests"
```

Observed output before pack schema hardening:

```text
Expected promise to reject
Received promise resolved
0 pass
1 fail
```

### Request boundary status mapping

Command:

```text
bun test test/api/approvals-route.test.ts test/api/traces-route.test.ts test/api/packs-install-route.test.ts --test-name-pattern "unsafe|traversal"
```

Observed output before route validation:

```text
Expected: 400
Received: 500
0 pass
3 fail
```

## Implementation

- Added `lib/security/safe-path.ts`:
  - `assertSafePathSegment` accepts exactly one portable opaque segment and rejects dot segments, both separators, absolute/drive/UNC shapes, control/NUL characters, ADS colons, Windows reserved devices, and trailing dot/space hazards.
  - `resolvePathWithinRoot` enforces lexical containment and verifies the nearest existing ancestor's real path, including symlink and Windows-junction escape rejection.
  - `resolveExistingPathWithinRoot` additionally verifies the final existing target's real path.
- Migrated library IDs and catalog-supplied paths for read, write, and delete.
- Migrated prompt IDs for read, write, existence, delete, and sync path construction.
- Migrated pack ID/version loading and constrained file-backed pack/step IDs in the pack schema.
- Migrated approvals, traces, gate decisions, run artifacts, canonical surface records, and child-sequence provisioning.
- Replaced export run-ID regexes with the shared contract and preserved portable `/` paths in bundle output on Windows.
- Added route validation for approvals, traces, gate decisions, library assets, pack installation, and run export.

## GREEN evidence

### Adversarial helper and integration suite

Command:

```text
bun test lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts
```

Output:

```text
15 pass
0 fail
49 expect() calls
Ran 15 tests across 2 files.
```

This run exercised the Windows junction path successfully; no link-creation skip was needed on this host.

### Request routes

Command:

```text
bun test test/api/approvals-route.test.ts test/api/traces-route.test.ts test/api/packs-install-route.test.ts
```

Output:

```text
9 pass
0 fail
31 expect() calls
Ran 9 tests across 3 files.
```

### Library, prompt, and pack loading/compilation

Command:

```text
bun test lib/library/repository.test.ts lib/prompts/manager.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts
```

Output:

```text
21 pass
0 fail
68 expect() calls
Ran 21 tests across 4 files.
```

### Run repositories, artifacts, surfaces, and exports

Command:

```text
bun test lib/approvals/repository.test.ts lib/traces/writer.test.ts lib/gates/repository.test.ts lib/runner/artifacts.test.ts lib/thread-surfaces/repository.test.ts lib/exports/bundler.test.ts test/api/surface-proof-routes.test.ts
```

Output:

```text
36 pass
0 fail
157 expect() calls
Ran 36 tests across 7 files.
```

### TypeScript

Command:

```text
bun run typecheck
```

Output:

```text
$ tsc --noEmit
Exit code: 0
```

### Affected-file ESLint

Command:

```text
bunx eslint lib/security/safe-path.ts lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts lib/library/repository.ts lib/prompts/manager.ts lib/packs/loader.ts lib/packs/pack-schema.ts lib/approvals/repository.ts lib/traces/reader.ts lib/traces/writer.ts lib/gates/repository.ts lib/runner/artifacts.ts lib/thread-surfaces/repository.ts lib/thread-surfaces/provision-child-sequence.ts lib/exports/bundler.ts app/api/library/route.ts app/api/packs/install/route.ts app/api/approvals/route.ts app/api/traces/route.ts app/api/gate-decisions/route.ts app/api/exports/run-bundle/route.ts test/api/approvals-route.test.ts test/api/traces-route.test.ts test/api/packs-install-route.test.ts
```

Output:

```text
Exit code: 0
0 errors
0 warnings
```

## Verification notes

A single large 17-file Bun invocation produced six route-test timeouts while those same route files passed together in 0.29 seconds. It also exposed two Windows path-separator regressions in export output; those were fixed and the export/proof suite passed. The non-reproducing timeouts are treated as test-runner contention rather than product failures.

`bun test lib/packs/install.test.ts` has one inherited assertion mismatch: the test expects `thread-root` before `thread-alpha` and `thread-beta`, while the pre-existing canonical surface repository sorts IDs lexically and returns `thread-root` last. Task 1 did not modify that sort or pack-install ordering, so this unrelated behavior was not changed.

## Self-review

- All request-, catalog-, manifest-, and state-derived values migrated by this task are validated before the first path-based read/write/delete operation.
- The helper checks both lexical containment and real containment, so a safe-looking in-root path cannot traverse an escaping symlink/junction ancestor.
- Existing final symlinks are checked even on future-target writes.
- Catalog mutation now occurs only after the catalog path has been proven contained and any deletion succeeds.
- Export bundle paths remain platform-independent after replacing raw path joins.
- The diff introduces no environment policy, executable policy, dependency, database, worktree, or runtime lifecycle.

## Known gaps and follow-up

- The current runner does not consume a manifest's `prompt_file`; it loads prompts by step ID. Creating an unused `lib/runner/step-preparation.ts` would falsely imply runtime coverage, so no dead preparation layer was added. When `prompt_file` is wired into execution, it must be resolved as a contained canonical relative path with `resolveExistingPathWithinRoot`, including link-escape tests.
- Real-path checks reduce traversal and link escapes but do not eliminate filesystem time-of-check/time-of-use races. A future privileged or adversarial multi-process threat model may require descriptor-relative operations or equivalent OS-specific primitives.
- The inherited pack-install ordering assertion remains for its owning task.

## Task files

- `lib/security/safe-path.ts`
- `lib/security/safe-path.test.ts`
- `lib/security/file-boundaries.test.ts`
- `lib/library/repository.ts`
- `lib/prompts/manager.ts`
- `lib/packs/loader.ts`
- `lib/packs/pack-schema.ts`
- `lib/approvals/repository.ts`
- `lib/traces/reader.ts`
- `lib/traces/writer.ts`
- `lib/gates/repository.ts`
- `lib/runner/artifacts.ts`
- `lib/thread-surfaces/repository.ts`
- `lib/thread-surfaces/provision-child-sequence.ts`
- `lib/exports/bundler.ts`
- `app/api/library/route.ts`
- `app/api/packs/install/route.ts`
- `app/api/approvals/route.ts`
- `app/api/traces/route.ts`
- `app/api/gate-decisions/route.ts`
- `app/api/exports/run-bundle/route.ts`
- `test/api/approvals-route.test.ts`
- `test/api/traces-route.test.ts`
- `test/api/packs-install-route.test.ts`
- `.superpowers/sdd/task-1-report.md`

## Blocking review fix pass

The blocking review in `task-1-review.md` was addressed with a second strict RED/GREEN pass.

### Review RED

Portable nested-path validation was specified before its implementation:

```text
bun test lib/security/safe-path.test.ts
SyntaxError: Export named 'assertPortableRelativePath' not found
0 pass
1 fail
1 error
```

All reviewed sinks were then exercised together before production changes:

```text
bun test lib/security/file-boundaries.test.ts lib/runner/artifacts.test.ts lib/runner/prompt-compiler-paths.test.ts lib/exports/bundler.test.ts lib/thread-surfaces/repository.test.ts test/api/step-path-validation.test.ts test/api/surface-proof-routes.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts

46 pass
23 fail
209 expect() calls
Ran 69 tests across 9 files.
```

The 23 failures proved that existing final-file links were followed by append/artifact/export operations; library entries could redirect to an unrelated in-workspace file; an escaping `.threados` junction was accepted; prompt compilation read traversal, run-junction, stdout-link, and status-link artifacts; sequence/policy snapshot links were read; `prompt_file` accepted traversal and backslashes; invalid surface state replaced aggregate state before rejection; and edit/remove/clone path identifiers returned 404/500 or mutated state instead of returning 400.

### Review fixes

- Added portable relative-path validation that rejects backslashes consistently on every host while allowing canonical paths such as `.threados/prompts/step-a.md`.
- Added safe file I/O wrappers. They use `O_NOFOLLOW` when the host exposes it and portable string flags otherwise; every caller still performs an immediate lexical/real-path verification before opening.
- Revalidated actual final files immediately before repository append, artifact write, snapshot read, policy read, export write, and runtime-record copy.
- Narrowed containment roots from the whole project to verified `.threados` sub-stores (`runs`, `prompts`, `skills`, `agents`, `state`, `surfaces`, `sequences`, `packs`, and `exports`).
- Removed catalog path authority: library reads/deletes require exact canonical `kind + id` path equality and derive the filesystem path independently.
- Contained every prompt-compiler run/dependency/status/stdout lookup and ignored escaping run entries or linked files.
- Validated pack `prompt_file` values in both schema parsing and synchronous compilation.
- Validated surface IDs and references before the first state write, then revalidated aggregate/canonical final targets.
- Added deterministic file-safe schemas for step add/edit/remove/clone identifiers and portable prompt/dependency inputs.

### Review GREEN

The exact former-RED set passed after the production fixes:

```text
bun test lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts lib/runner/artifacts.test.ts lib/runner/prompt-compiler-paths.test.ts lib/exports/bundler.test.ts lib/thread-surfaces/repository.test.ts test/api/step-path-validation.test.ts test/api/surface-proof-routes.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts

75 pass
0 fail
268 expect() calls
Ran 75 tests across 10 files.
```

Core Task 1 regressions:

```text
bun test lib/library/repository.test.ts lib/prompts/manager.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts lib/approvals/repository.test.ts lib/traces/writer.test.ts lib/gates/repository.test.ts lib/runner/artifacts.test.ts lib/runner/prompt-compiler.test.ts lib/runner/prompt-compiler-paths.test.ts lib/thread-surfaces/repository.test.ts lib/exports/bundler.test.ts lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts

95 pass
0 fail
312 expect() calls
Ran 95 tests across 14 files.
```

The final artifact/export/surface proof rerun after the portable `O_NOFOLLOW` fallback correction:

```text
bun test lib/runner/artifacts.test.ts test/api/surface-proof-routes.test.ts lib/thread-surfaces/repository.test.ts

29 pass
0 fail
91 expect() calls
Ran 29 tests across 3 files.
```

Final static checks:

```text
bun run typecheck
$ tsc --noEmit
Exit code: 0

bunx eslint <29 affected Task 1 fix files>
Exit code: 0
0 errors
0 warnings
```

### Review residual risk and unrelated failures

- Descriptor-relative parent-directory traversal is not exposed portably by the current Node/Bun APIs. The implementation verifies real parents and final targets immediately before I/O and uses final-component `O_NOFOLLOW` where available, but a privileged concurrent actor can still race parent-directory replacement on platforms without descriptor-relative primitives.
- `prompt_file` is now synchronously constrained to a portable relative path. The current runner still selects prompt content by step ID; when direct `prompt_file` consumption is introduced, the final existing file must be resolved under the verified prompt root immediately before its no-follow read.
- The API regression group passed 54 of 55 tests. The remaining `agents-route.test.ts` unassign failure is inherited: sequence normalization restores `assigned_agent_id` from the still-populated `agent_ref`; it is unrelated to filesystem containment.
- The previously documented inherited pack-install surface-order assertion remains unchanged.

## Final safe-I/O re-review fix

The final re-review in `task-1-rereview.md` identified a pathname-swap window in the portable safe-I/O fallback. A third strict RED/GREEN pass closed it at the opened-handle boundary.

### Safe-I/O RED

The focused contract suite was added before changing `safe-io.ts`:

```text
bun test lib/security/safe-io.test.ts
SyntaxError: Export named 'setSafeIoBeforeOpenHookForTests' not found
0 pass
1 fail
1 error
```

This established the missing deterministic race seam before production implementation. The suite covers direct final-component symlinks for read, truncate/write, append, copy source, and copy destination; new and existing regular destinations; append preservation; and a destination changed to a symlink immediately before open.

### Safe-I/O fix

- New writable destinations are opened with exclusive-create modes (`O_EXCL` with `O_NOFOLLOW` where exposed, portable `wx`/`ax` otherwise) and mode `0600`.
- Existing destinations are opened without truncation, then the opened handle's `stat()` identity is compared with a fresh `lstat(path)`. Final symbolic links and device/inode mismatches are rejected before any bytes are read, truncated, appended, or written.
- Truncation now occurs on the verified handle. Reads, writes, appends, and copies continue through that same handle, so a later final-path replacement cannot redirect I/O.
- Append flags remain append-capable, and both new-file and existing-file behavior are covered by focused tests.

### Safe-I/O GREEN

Focused contract suite:

```text
bun test lib/security/safe-io.test.ts
8 pass
0 fail
18 expect() calls
Ran 8 tests across 1 file.
```

Required Task 1 re-review regression suite:

```text
bun test lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts lib/runner/artifacts.test.ts lib/runner/prompt-compiler-paths.test.ts lib/exports/bundler.test.ts lib/thread-surfaces/repository.test.ts test/api/step-path-validation.test.ts test/api/surface-proof-routes.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts

75 pass
0 fail
268 expect() calls
Ran 75 tests across 10 files.
```

Static checks:

```text
bun run typecheck
$ tsc --noEmit
Exit code: 0

bunx eslint lib/security/safe-io.ts lib/security/safe-io.test.ts
Exit code: 0
0 errors
0 warnings
```

## Existing-append disappearance micro-fix

The final safe-I/O review found that the Windows string fallback for an existing append used `a`, whose implicit `O_CREAT` could recreate a destination that disappeared after the exclusive-create probe returned `EEXIST`.

### Micro-fix RED

A deterministic hook removed an existing append destination immediately before its second open:

```text
bun test lib/security/safe-io.test.ts
Expected promise that rejects
Received promise that resolved
8 pass
1 fail
19 expect() calls
Ran 9 tests across 1 file.
```

The failure proved that the existing-file fallback recreated and appended to the vanished path non-exclusively.

### Micro-fix implementation

- Exclusive creation alone selects portable `ax`/`wx` when `O_NOFOLLOW` is unavailable.
- Existing read, write/copy, and append opens always use numeric, non-creating flags (`O_RDONLY`, `O_WRONLY`, and `O_WRONLY | O_APPEND`), adding `O_NOFOLLOW` when the host exposes it.
- Existing write/copy no longer require read permission.
- Bun on Windows does not advance writes to EOF for the numeric append flag, so append writes use the verified handle's current size as their position. POSIX `O_APPEND` continues to control the final write position.
- Identity verification and all I/O through the already-open handle remain unchanged.

### Micro-fix GREEN

```text
bun test lib/security/safe-io.test.ts
9 pass
0 fail
21 expect() calls
Ran 9 tests across 1 file.

bun test lib/security/safe-path.test.ts lib/security/file-boundaries.test.ts lib/runner/artifacts.test.ts lib/runner/prompt-compiler-paths.test.ts lib/exports/bundler.test.ts lib/thread-surfaces/repository.test.ts test/api/step-path-validation.test.ts test/api/surface-proof-routes.test.ts lib/packs/loader.test.ts lib/packs/compiler.test.ts
75 pass
0 fail
268 expect() calls
Ran 75 tests across 10 files.

bun run typecheck
$ tsc --noEmit
Exit code: 0

bunx eslint lib/security/safe-io.ts lib/security/safe-io.test.ts
Exit code: 0
0 errors
0 warnings
```
