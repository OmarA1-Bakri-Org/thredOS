# Task 3 report: exact executable-policy binding

## Outcome

Task 3 closes the P0 policy indirection gap. API and CLI now evaluate the same structured executable payload before `runStep`; shell bytes remain in memory until authorization; SAFE approvals bind to a deterministic digest; and the materialized script is re-hashed immediately before `spawn`.

## Strict RED evidence

All required failures were observed before production edits.

### Hidden shell content and regex loading

```text
bun test lib/policy/engine.test.ts
10 pass
5 fail
24 expect() calls
```

The failures showed that forbidden content hidden behind `sh`, `bash`, `cmd`, and `powershell.exe` was allowed, and an invalid forbidden regex loaded successfully instead of being rejected safely.

### Premature materialization

```text
bun test lib/runner/dispatch.test.ts
12 pass
1 fail
22 expect() calls
```

Shell dispatch returned a materialized `threados-prompt-*.md` path instead of preserving the exact script bytes in a structured launch payload.

### API bypass

```text
bun test test/api/run-route-coverage.test.ts --test-name-pattern "forbidden shell bytes"
Expected status: 403
Received status: 200
0 pass
1 fail
```

The forbidden script reached the mocked `runStep` path.

### CLI bypass

```text
bun test lib/seqctl/commands/run.test.ts --test-name-pattern "CLI denies forbidden shell bytes"
Expected runStepCalls: 0
Received runStepCalls: 1
0 pass
1 fail
```

### Exact bytes and tamper verification

```text
bun test lib/runner/wrapper.test.ts --test-name-pattern "materialized script|temp script tampering"
Expected structured-script output; received: "legacy"
Expected tamper hook: function; received: undefined
0 pass
2 fail
```

### Approval binding

```text
bun test test/api/run-approval-proof.test.ts --test-name-pattern "confirmed SAFE"
Expected subject_digest: sha256:<64 hex>
Received: no subject_digest
0 pass
1 fail
```

## Implementation

- Added `ExecutablePayload`: exact command, argv, cwd, and optional interpreter/script content/hash.
- Added one policy evaluator used by API and CLI. Allowlist checks target the launcher command; forbidden regexes inspect exact command/argv fields and shell bytes.
- Added safe regex validation to `PolicyConfigSchema`; malformed user patterns fail during policy loading with a validation error.
- Shell dispatch no longer writes a temp file. It returns exact in-memory bytes plus SHA-256. Ordinary AI-agent prompt files remain ordinary prompt inputs and are not treated as executable scripts.
- Non-shell dispatch also records its exact command/argv/cwd structurally without scanning prompt contents.
- `runStep` materializes script bytes with exclusive creation and mode `0600` only after the caller has authorized the payload. It verifies the approved content hash, invokes a deterministic test seam, re-reads and hashes the file immediately before `spawn`, and fails closed on mismatch.
- Script execution inserts the materialized path as one argv element and preserves all remaining argument boundaries and UTF-8 bytes.
- Added canonical SHA-256 subject digests covering command, ordered argv, cwd relative to the project, exact script hash/interpreter, and a canonical policy identity hash.
- SAFE approval records and approval trace evidence now carry the subject digest. Legacy approvals without a digest remain readable but cannot match a new exact executable subject.
- Approval matching requires status, target, and exact digest. The focused A/B test proves an approval for payload A cannot authorize changed payload B on the same step.
- CLI invocation uses the same policy evaluator and treats the operator's explicit local CLI run command as confirmation for SAFE-mode confirmation semantics; forbidden and allowlist decisions remain fail-closed.

## GREEN evidence

### Policy and approval digest

```text
bun test lib/policy/engine.test.ts lib/policy/executable.test.ts
17 pass
0 fail
29 expect() calls
```

### Dispatch and wrapper

```text
bun test lib/runner/dispatch.test.ts lib/runner/wrapper.test.ts
31 pass
0 fail
85 expect() calls
```

### API and approval lifecycle

```text
bun test test/api/run-route-coverage.test.ts test/api/run-approval-proof.test.ts
18 pass
0 fail
56 expect() calls
```

One earlier combined approval invocation produced no output and was terminated at its command timeout. Both isolated approval tests then passed, and the combined API/approval command above completed normally.

### CLI parity

```text
bun test lib/seqctl/commands/run.test.ts
22 pass
0 fail
57 expect() calls
```

### Approval repository and contract compatibility

```text
bun test lib/approvals/repository.test.ts lib/contracts/schemas.test.ts
24 pass
0 fail
52 expect() calls
```

### Static checks

```text
bun run typecheck
$ tsc --noEmit
Exit code: 0

bunx eslint <16 affected Task 3 source/test files>
Exit code: 0
0 errors
0 warnings

git diff --check
Exit code: 0
```

## Changed files

- `app/api/run/route.ts`
- `lib/approvals/runtime.ts`
- `lib/contracts/schemas.ts`
- `lib/policy/engine.ts`
- `lib/policy/engine.test.ts`
- `lib/policy/executable.ts`
- `lib/policy/executable.test.ts`
- `lib/policy/schema.ts`
- `lib/runner/dispatch.ts`
- `lib/runner/dispatch.test.ts`
- `lib/runner/wrapper.ts`
- `lib/runner/wrapper.test.ts`
- `lib/seqctl/commands/run.ts`
- `lib/seqctl/commands/run.test.ts`
- `test/api/run-approval-proof.test.ts`
- `test/api/run-route-coverage.test.ts`
- `.superpowers/sdd/task-3-report.md`

## Self-review and concerns

- No dependency, database, worktree, shell-spawn mode, or broader permission was added.
- API and CLI preserve `shell: false`; structured argv is the execution authority and any flattened representation is non-authoritative.
- The dispatcher currently emits `sh` for shell-model steps. Policy coverage includes `bash`, `cmd`, and PowerShell payloads so future adapters cannot hide script content, but Task 3 does not add new platform dispatcher adapters.
- The re-hash is immediately before pathname-based interpreter spawn. Node does not expose a portable descriptor-based script execution API, so a privileged actor capable of replacing the temp path in the tiny hash-to-interpreter-open window remains outside the guarantee. Exclusive randomized creation, mode `0600`, and the immediate verification substantially narrow that window.
- CLI SAFE confirmation is bound to the explicit local operator invocation; CLI does not persist an API-style approval lifecycle in this task.
- Existing approval records remain backward compatible through an optional digest field. They deliberately do not authorize exact executable subjects until re-approved with a digest.
