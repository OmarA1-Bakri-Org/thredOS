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
