# Task 4 implementation report

## Scope

Restored inherited lint, unit-test, Playwright startup, and Windows runtime-verifier baseline without weakening validation rules or changing intended runtime behavior.

## Root causes and fixes

- Kept legacy `kind`/`type` aliases synchronized across API, CLI, validator, fusion, group, and step mutations.
- Cleared both assignment aliases during unassignment so schema normalization cannot restore stale agent references.
- Corrected stale test expectations for canonical agent selection, apply targets, typed annotation codes, deterministic pack ordering, and derived prompt compatibility.
- Removed shared `process.env` dependence from environment filtering coverage.
- Added cross-platform verifier helpers for Bun discovery, PATH construction, host/port selection, and reserve-release-rebind behavior.
- Unified Playwright ports and made global setup consume configured `baseURL`.
- Made build/dev helpers use `process.execPath`.
- Replaced server-side `Bun.spawn` agent discovery with Node `child_process.spawn`, direct Windows `where.exe`, and `shell: false`.
- Removed explicit `any` and unused bindings reported by lint.

## TDD evidence

- Alias regressions: RED 5 failures, then GREEN 112/112.
- Assignment regression: RED 1 failure, then GREEN 5/5.
- Verifier helper: RED missing module, then GREEN 12/12 with 28 assertions.
- Fusion hidden alias: RED 1 failure, then GREEN.
- Node-safe agent lookup: RED 1 failure, then GREEN 14/14.

## Verification

- `bun test`: 1,581 pass, 0 fail, 3,948 assertions, 192 files.
- `bun run lint`: pass.
- `bun run typecheck`: pass.
- `bun run build`: pass; 57 pages generated.
- `bun run verify:local`: pass after Node-safe dispatch fix; all 11 local browser checks passed.
- `git diff --check`: pass.

## Cleanup and compatibility

- Deleted generated `.eslintcache` and transient `.threados/surfaces` output.
- No dependency added.
- No policy, approval, or isolation rule weakened.
- Unrelated user changes and canonical planning documents preserved.

## Remaining risk

- Port probing necessarily has a small race between releasing reservation and Next binding; verifier uses bounded retry behavior.
- Direct standalone UI invocation was used to prove startup repair, while `verify:local` supplies the completed browser-suite evidence.
