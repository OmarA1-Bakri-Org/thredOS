# Task 8 report: PR-04 API cutover

## Result

App execution and control routes now delegate to `ThreadOSRuntimeService`. Canonical run and attempt resource routes return V2 projections, preserve trusted API context and idempotency keys, apply route-local auth/rate limits, and map the shared runtime error registry to stable HTTP responses.

## RED / GREEN

- RED: concurrent same-key retry could race the outer receipt binding; an accepted nested retry-start receipt with no run entered an unbounded replay wait.
- GREEN: retry receipts now bind one immutable child run, losing callers follow the winning binding, and accepted child-start receipts repair the exact bound run without duplicate spawn.
- RED: Windows inspection could hold `attempt.json` during atomic replacement, causing `EPERM` and false attempt failure.
- GREEN: commit `73971b9` adds bounded Windows sharing retries with parent/temp identity revalidation; focused atomic/repository proof is 33/33.
- RED: legacy tests asserted mprocs lifecycle authority and V1 run-record shape.
- GREEN: compatibility proofs now inject the shared service and assert canonical V2 run/attempt truth, typed errors, and retry lineage.

## Compatibility and mappings

- `/api/run` keeps legacy step/group/runnable envelopes and calls `runAndWait()` once.
- Pre-run gate blocks remain HTTP 200 with `READY` and gate reasons; exit code 42 remains `NEEDS_REVIEW`.
- Missing targets, policy denial, and confirmation requirements retain typed 404/403/409 responses.
- `/api/stop` and `/api/restart` resolve latest attempts through the service; mprocs is not execution authority.
- JSON syntax errors and blank idempotency headers map to `400 VALIDATION_ERROR` while preserving supplied keys where available.
- Canonical POST controls return refreshed run/attempt projections.

## Validation

- `bun test test/api/runtime-v2-routes.test.ts test/api/run-route-coverage.test.ts test/api/runtime-persistence-proof.test.ts test/api/thread-run-lifecycle.test.ts test/api/routes.test.ts`: 59 passed, 220 assertions.
- `bun test lib/fs/atomic.test.ts lib/runtime/repositories.test.ts --timeout 15000`: 33 passed, 85 assertions.
- `bun test test/api/runtime-persistence-proof.test.ts lib/runtime/service.test.ts --timeout 30000`: 11 passed, 82 assertions.
- `bun test test/api/hosted-auth-routes.test.ts --timeout 15000`: 17 passed, 115 assertions.
- `bun run typecheck`: passed.
- `bun run lint`: passed.
- Route lifecycle/direct-runner import scan: no matches.
- Production `git worktree` scan in changed API/runtime areas: no matches.

## Path drift and risk

- The legacy route test bridge remains supported but moved behind `lib/api/runtime-request.ts`; `app/api/run/route.ts` only invokes the service port.
- Canonical runtime records supersede the older V1 run-record assertion. Surface manifests and export compatibility remain covered.
- Real-service route tests use explicit integration budgets because each proof performs multiple fsync-backed canonical mutations on native Windows.
- Full repository `bun test` was not run in this task slice; the exact PR gate, focused service/persistence suites, hosted auth, typecheck, and lint were run.
