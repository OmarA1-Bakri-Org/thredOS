# Runtime phase 0.5 baseline revalidation — 2026-04-22

Worktree
- path: `/mnt/c/Users/albak/xdev/thredOS-worktrees/runtime-phase0-baseline-r1`
- branch: `feat/runtime-phase0-baseline-r1`
- head: `020e1b0c4bd091cf9a69c7c64739b5049b919982`

Source docs read before rerun
- `/home/omar/.hermes/plans/2026-04-22_091759-lets-finish-the-runtime-set-out-the-plan.md`
- `/home/omar/.hermes/plans/audit-closure-checklist-2026-04-22.md`

Exact baseline bundle rerun
1. `bun test lib/seqctl/commands/run.test.ts`
2. `bun test test/api/run-route-coverage.test.ts`
3. `bun test test/api/run-approval-proof.test.ts`
4. `bun test test/api/thread-run-lifecycle.test.ts`
5. `bun test lib/gates/rules.test.ts`
6. `bun test lib/seqctl/commands/status.test.ts`
7. `bun test lib/runner/dispatch.test.ts`

Results
- PASS — `bun test lib/seqctl/commands/run.test.ts` (`46 pass`, exit 0)
- PASS — `bun test test/api/run-route-coverage.test.ts` (`27 pass`, exit 0)
- PASS — `bun test test/api/run-approval-proof.test.ts` (`3 pass`, exit 0)
- PASS — `bun test test/api/thread-run-lifecycle.test.ts` (`6 pass`, exit 0)
- PASS — `bun test lib/gates/rules.test.ts` (`16 pass`, exit 0)
- PASS — `bun test lib/seqctl/commands/status.test.ts` (`11 pass`, exit 0)
- PASS — `bun test lib/runner/dispatch.test.ts` (`17 pass`, exit 0)
- Bundle summary: `126 pass`, `0 fail`, all seven commands green on clean head.

Live baseline truth restated from this rerun + current repo audit docs

Still PARTIAL
- Process success vs business completion remains PARTIAL.
  - Live evidence: `lib/runner/dispatch.test.ts` still proves downgrade coverage for obvious zero-exit refusal/blocked cases, and the CLI/API run suites still prove those covered cases end in `NEEDS_REVIEW` instead of false `DONE`.
  - Why still partial: the currently rerun suite proves narrow hardening, not a generalized business-completion model across workflow classes.
- CLI/API semantic closure remains PARTIAL.
  - Live evidence: `lib/seqctl/commands/run.test.ts` and `test/api/run-route-coverage.test.ts` are green on the same head and prove parity for the currently covered prompt-path, approval-block, conditional, composio, and dispatch cases.
  - Why still partial: this rerun does not newly prove closure for every runtime semantic edge; the audit wording that some remaining divergences are intentional/not yet comprehensively unified is not contradicted by the live rerun.
- `NEEDS_REVIEW` lifecycle remains PARTIAL.
  - Live evidence: covered downgrade paths pass, including zero-exit blocked/refusal cases and exit-code-42 handling.
  - Why still partial: the rerun does not establish one complete runtime-wide lifecycle model beyond those covered downgrade paths.
- `BLOCKED` causes and reopen rules remain PARTIAL.
  - Live evidence: approval-blocked and reopen flows are exercised in CLI/API tests and pass.
  - Why still partial: the rerun proves covered approval/gate paths, not a fully unified authority model for all blocked causes.
- Approval/gate unified authority remains PARTIAL.
  - Live evidence: approval proof and route/run coverage tests pass and show materially improved behavior.
  - Why still partial: the live suite still reads as proof of improved covered behavior, not proof that approvals, sequence gates, and gate engine now form one fully coherent authority model.
- Subagent/runtime completion hardening remains PARTIAL.
  - Live evidence: run/dispatch tests cover native actions, sub-agent fallback behavior, and false-success downgrade behavior.
  - Why still partial: explicit evidence requirements and broader semantic completion validation are still not proven by this baseline.

Still OPEN
- Explicit output evidence requirements for important workflow steps.
  - Live evidence gap: no command in this baseline bundle proves a broader explicit evidence-contract system; current tests stop at the present hardening layer.
- Pack/install/compiler/runtime prompt contract coherence.
  - Live evidence gap: no pack/install/compiler tests were part of this baseline rerun, and the current audit doc still marks authored-vs-installed prompt contract work open.
- Semantic pack validation.
  - Live evidence gap: this rerun exercised runtime/gates/status/thread lifecycle coverage, not pack semantic validation paths.
- Runtime context provenance / namespacing / conflict discipline / typing.
  - Live evidence gap: no rerun target in this bundle closes or disproves the audit's open runtime-context safety items.
- Environment/tool contract and fail-fast preflight.
  - Live evidence gap: this rerun succeeded in the current environment but did not establish an explicit environment manifest, required tool declaration set, or fail-fast preflight layer.
- Non-Apollo proof matrix / universal readiness proof.
  - Live evidence gap: this baseline was the parent-verified runtime bundle rerun only; it was not the broader non-Apollo workflow proof matrix described in the finish plan.

Discrepancy check against existing audit wording
- Head truth matches the audit's assessed commit: live rerun was performed at `020e1b0c4bd091cf9a69c7c64739b5049b919982`, which is the same head the audit checklist describes as merge commit `020e1b0`.
- Branch-context wording is stale, but not semantically wrong.
  - Existing wording says the assessed branch state was `feat/apollo-pack` after merge commit `020e1b0`.
  - Live truth is this rerun happened on `feat/runtime-phase0-baseline-r1`, but at the same head commit.
  - Conclusion: no code-status discrepancy found; only the branch-context wording is older than the current revalidation worktree.
- Evidence wording can now be tightened.
  - Existing checklist repeatedly says variants of "parent-verified tests passed" or "passed in parent session".
  - Live truth is stronger: the required seven-command baseline bundle was rerun directly in this clean worktree at the audited head and all seven commands passed again.

Bottom line
- Phase 0.5 baseline revalidation succeeded.
- The clean-head baseline bundle is green.
- The remaining items still read as PARTIAL/OPEN in the same areas already called out by the live audit docs; this rerun does not reveal a new contradiction, but it does refresh the evidence from inherited parent-session wording to a direct same-head rerun in this worktree.
