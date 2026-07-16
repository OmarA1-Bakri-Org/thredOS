# Task 5 report: PR-01 canonical contracts

## Outcome

Implemented additive canonical runtime, command, workspace, Change Set, and merge schemas. Added a pure legacy-run projection and optional V2 thread-surface links. Runtime execution behavior remains unchanged.

## Contract choices

- `WorkflowRun`, `StepAttempt`, `ProcessRecord`, `RuntimeCommandReceipt`, snapshots, and Surface Workspaces follow implementation-plan Section 4 field names and enum values exactly.
- Runtime commands are one discriminated union on `command_type`; every command carries the shared Section 5.2 `RuntimeCommandContext`.
- Legacy `RunSchema` remains the only definition of the existing `run.json` shape. `LegacyRunRecordSchema` aliases it and the projection creates deterministic, distinct attempt identity as `<legacy-run-id>:attempt:<attempt-number>`.
- Legacy projection is pure, returns nullable snapshot/workspace references, uses `sequential`, maps `successful` to attempt `completed`, and emits no `ProcessRecord` without process evidence.
- Forward Change Set fields cover canonical refs, before/after content evidence, text/binary classification, byte/line summaries, path-scope violations, validation, output-contract, approval, and every locked lifecycle status.
- Forward merge fields keep canonical precondition hash, selected Change Set refs, preview workspace ref, explicit conflicts, rollback evidence, and Git outcome separate from filesystem apply outcome.
- `HOST_ENFORCED` is valid contract data. No provider behavior was added or changed.

## TDD evidence

RED command:

```text
bun test lib/runtime/schema.test.ts lib/workspaces/schema.test.ts lib/changesets/schema.test.ts lib/merge/schema.test.ts lib/contracts/schemas.test.ts lib/thread-surfaces/types.test.ts
```

RED result: exit 1; 8 passed, 5 failed with 5 module/export errors. Decisive failures were missing `./schema` modules for runtime, workspaces, changesets, and merge, plus missing `WorkflowRunSchema` from `lib/contracts/index.ts`.

GREEN result for the same expanded command: 54 passed, 0 failed, 106 assertions across 6 files.

## Validation

Canonical PR-01 targeted command:

```text
bun test lib/runtime/schema.test.ts lib/workspaces/schema.test.ts lib/changesets/schema.test.ts lib/merge/schema.test.ts lib/contracts/schemas.test.ts
```

Result: 46 passed, 0 failed, 84 assertions across 5 files.

```text
bun run typecheck
```

Result: exit 0, `tsc --noEmit`.

```text
bun run lint
```

Result: exit 0. ESLint reported only its existing poor-concurrency advisory. Generated `.eslintcache` was removed afterward.

```text
bun test
```

Result: 1608 passed, 0 failed, 4002 assertions across 196 files in 81.55 seconds.

Diff checks:

- task-scoped diff contains no `git worktree` invocation;
- task-scoped diff adds no canonical-workspace write path;
- no dependency added;
- no generated runtime state retained.

## Compatibility impact

- Existing `RunSchema` and all existing `lib/contracts` exports remain available.
- `lib/contracts/index.ts` is the additive stable barrel for V2 contracts.
- Legacy `ThreadSurface`, `RunScope`, `RunEvent`, and `MergeEvent` values remain valid because V2 references are optional.
- `normalizeThreadSurface()` produces the same value for a legacy object and preserves V2 refs when supplied.

## Path drift

- Plan names `lib/contracts/schemas.ts` as the modification surface. Repository already has `lib/contracts/index.ts` as its public barrel, so V2 re-exports were added there; legacy schemas were not moved or duplicated.
- A focused `lib/thread-surfaces/types.test.ts` compatibility test was updated because it directly owns the additive link types.

## Remaining risks

- Command schemas and forward Change Set/merge schemas are intentionally unused in PR-01. Repository/service enforcement begins in later manifest PRs.
- Legacy projection cannot invent trustworthy process evidence; it returns `processRecord: null` by design.
- Forward Change Set and merge contracts validate representative records but do not implement capture, merge, apply, or rollback behavior.
