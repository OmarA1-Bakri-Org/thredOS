# Bounded M2 transaction acceptance

This checkpoint implements the documented service transaction/approval/recovery path for regular files in existing directories. It does not authorize mutation of an existing canonical project, enable the default mutation provider, close M2 or introduce M3 concurrency.

## Cloud proof

Use the existing pinned Node 22.23.4 and Bun 1.3.6 tooling, then run:

```bash
bun run check
bun test
bun scripts/verify/m2-transaction-proof.ts --fixture-contract --confirm-owned-fixtures
bun run build
```

The proof creates and removes owned fixtures. Both dirty Git and non-Git variants use a registered real agent process, validation configured before launch, a user edit after launch, actual preview validation, a pending/resolved human-operator fixture approval in the existing repository, service consumption, regular-file add/modify/delete, real canonical post-check processes, a fresh exact rollback approval and reversal. It writes bounded receipt hashes/counts under `test-results/verify/m2-transactions/`; it does not export source contents, environment values or full launch payloads. Its status explicitly distinguishes fixture contract success from native acceptance.

Targeted regressions cover unknown helper outcomes, missing physical process evidence, controlled cancellation of a live validation child, selection revocation serialization, stale canonical/rollback preconditions, prepared-journal restart, orphan evidence before initial journal commit, and staged rollback restart with fresh approval. The fixture provider uses ordinary Node filesystem operations in owned roots. It proves the service protocol and durable recovery behavior, not Windows handle semantics or protection against a hostile host process.

## Exact remaining Windows dependency for this bounded slice

Use an already authorized native Windows host with matching local Node headers/import library, the existing C++ toolchain/Python/Windows SDK, and the pinned dependencies already available. No paid executor, network/header download, new credentials, ACL changes or security-setting changes are needed or authorized by this plan. Linux refuses `--windows-native` explicitly.

Build the addon using existing local `node-gyp`, supplying the matching pre-provisioned headers with `--nodedir`; verify the headers include `node.h`, `node_version.h`, `config.gypi`, `common.gypi` and `Release/node.lib`. Do not invoke a setup path that silently downloads headers. Review and run the bounded positive native tests, excluding the historical ACL-denial testcase that changes permissions. Verify the newly added `pinDirectory` entry point, parent/root replacement rejection, exclusive stage refusal, pinned content checks and supervised-child terminal journals.

Then run in the reviewed checkout:

```text
bun scripts/verify/m2-transaction-proof.ts --windows-native --confirm-owned-fixtures
```

This selects the protected adapter only inside the proof's newly created disposable fixtures. Verify both variants, operation journals, exact approval consumption, post-check processes, rollback, later-user-edit rejection, absence of leftover staging files and preservation of repository source hashes. Native helper timeout or indeterminate I/O requires review; PID absence alone must not clear a transaction or authorize reversal. Report the exact addon/source hashes, Node/Bun/OS versions and evidence path. Do not enable provider wiring for an existing canonical project, merge PRs or deploy as part of this acceptance.

Packaged Desktop native binary inclusion/ASAR behavior and the full M2 UI/composition/unsupported-operation gates remain separate release work. A bounded native proof must not be reported as full product or milestone completion.
