# AGENTS.md

## Purpose

This file defines the mandatory working rules for human contributors and AI coding agents operating in `OmarA1-Bakri-Org/thredOS`.

thredOS is a local-first operating environment for governed agent work. Contributions must preserve runtime truth, local data boundaries, deterministic control, and the product decision to support parallel agents **without Git worktrees**.

## Canonical authority

Read these documents before implementation:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md`
2. `docs/plans/m0-m1-repository-implementation-plan.md`
3. `docs/plans/m0-m1-pr-manifest.yaml`
4. `docs/product/current-state.md`
5. `docs/product/architecture-map.md`

Authority order:

1. The canonical PRD controls product scope, locked decisions, and release acceptance.
2. This `AGENTS.md` controls repository conduct, implementation discipline, safety, and validation.
3. The canonical implementation plan controls Milestones 0–1 sequencing and repository mapping.
4. The PR manifest controls the machine-readable PR order, dependencies, and gates.
5. Current-state and architecture documents describe the repository but do not override the canonical set.

Do not silently change a locked decision. A material change requires a versioned amendment, explicit rationale, impact analysis, and owner approval.

## Product invariants

The following are non-negotiable:

1. **No production runtime path may invoke `git worktree`.**
2. **Git is optional.** Dirty Git projects and non-Git directories must remain supported.
3. **No parallel write-capable agent may mutate the canonical workspace.**
4. **Comparable attempts use the same immutable baseline snapshot.**
5. **Every isolated write/execute attempt uses a verified Surface Workspace as `cwd`.**
6. **Directory-scoped isolation is `THREADOS_SCOPED`, never `HOST_ENFORCED`.**
7. **Only the merge/apply service may mutate the canonical workspace during a parallel workflow.**
8. **Agent output is evidence, not authority.** Agents do not approve gates, reveals, merges, or their own completion.
9. **API, CLI, chat/apply, and future MCP interfaces use one `ThreadOSRuntimeService`.**
10. **mprocs is optional observability and legacy compatibility, not runtime truth.**
11. **Persist run, attempt, workspace, process, and launch intent before process spawn.**
12. **Retry creates a new attempt with lineage. Historical attempts never transition back to `running`.**
13. **Missing process evidence is never interpreted as success.**
14. **Indexes and UI projections are rebuildable; they are not the only source of truth.**
15. **No agent completion implicitly applies files to the canonical project.**

## Milestone sequencing

Do not collapse the milestone order:

- **Milestone 0:** one truthful shared runtime; sequential scheduler; real process control and recovery.
- **Milestone 1:** immutable snapshots and separate portable-copy Surface Workspaces; attempts may still be scheduled sequentially.
- **Milestone 2:** Change Sets, review, merge preview, transactional apply, and rollback.
- **Milestone 3:** real bounded concurrent scheduling and candidate/sharded/race strategies.
- **Milestone 4:** composition, synthesis, conflict UX, and complete operator loop.
- **Milestone 5:** hardening and Desktop 1.0 release.

Do not claim that Milestones 0–1 deliver parallel agent execution. They make safe parallel execution possible without another state or workspace migration. Explicit parallel requests must fail truthfully until Milestone 3 is implemented.

## Current implementation order

Implement the PRs in `docs/plans/m0-m1-pr-manifest.yaml` in order:

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07
                                                    │
                                                    ▼
PR-08 → PR-09 → PR-10 ───────────────────────────→ PR-11 → PR-12
```

Start with PR-01 only. Do not begin a dependent PR until the prior dependency is merged and green, unless the owner explicitly authorizes parallel branch development.

Before each PR:

```bash
git fetch origin
git checkout main
git pull --ff-only
bun install
bun run check
```

Record path drift from the implementation plan in the PR description. Preserve the contract when a file has moved; update the plan/manifest only when the mapping change is durable.

## Repository architecture rules

### Interface layers

API routes, CLI handlers, chat actions, and UI hooks may:

- parse and validate requests;
- authorize and rate-limit;
- construct command context;
- call application services;
- map typed results to HTTP, CLI, or UI forms; and
- invalidate or refresh projections.

They may not own:

- prompt compilation;
- target resolution;
- gate evaluation;
- approval lookup/consumption;
- process spawn or termination;
- attempt lifecycle transitions;
- artifact finalization;
- snapshot/workspace provisioning;
- sequence compatibility status transitions; or
- thread-surface run finalization.

Those operations belong behind `ThreadOSRuntimeService` and its ports.

### Canonical state

Use:

- Zod for runtime contracts;
- atomic JSON for current entity records;
- append-only NDJSON for traces, approvals, and decisions;
- expected revision or precondition hashes for conflicting updates; and
- derived indexes for listing and UI performance.

Do not introduce a database during Milestones 0–1.

Canonical records must remain recoverable without the UI, in-memory state, or mprocs.

### Human-authored versus generated files

Human-authored configuration:

- `.threados/sequence.yaml`
- `.threados/policy.yaml`
- `.threados/workspace.yaml`
- pack definitions
- prompt and skill source files

Generated runtime data:

- runs and attempts
- process records
- snapshots
- workspace records
- traces
- approvals
- gate decisions
- Change Sets
- merge plans/results
- exports and indexes

Agents must not directly edit generated canonical records. Use repositories and services.

## Surface Workspace rules

For the portable copy provider:

- place workspace content outside the canonical project root;
- never recursively copy `.threados`, `.git`, runtime roots, or sibling workspaces;
- never use hardlinks for writable files;
- treat filenames and symlinks as untrusted;
- reject path traversal and escaping symlinks;
- materialize into staging and atomically rename after verification;
- verify manifest equivalence before dispatch;
- bind `cwd` to the workspace root;
- retain failed, interrupted, conflicted, and review-required workspaces by default;
- clean partial materializations on failure; and
- enforce file-count, byte, active-workspace, and retained-storage quotas.

Do not expose sibling workspace paths, semantic content, or private absolute paths in prompts or exports.

## Process rules

- Spawn with `shell: false` unless a reviewed adapter explicitly requires otherwise.
- Persist a redacted launch request before spawn.
- Persist environment key names, not secret values.
- Track PID/provider handle, attempt ID, workspace ID, status, timestamps, exit code, and signal.
- Cancellation must target the real process or process tree and observe termination before reporting success.
- Windows process-tree termination must use safe direct argument invocation; never interpolate an agent-controlled shell command.
- Timeouts and cancellation must retain truthful terminal states and artifacts.
- Recovery marks an absent unmanaged process `interrupted`/`lost`, not successful.

## Security rules

Treat all agent-produced content as untrusted:

- paths;
- filenames;
- patches;
- event payloads;
- JSON/structured output;
- logs;
- tool requests; and
- completion claims.

Required protections:

- canonical path containment;
- traversal rejection;
- symlink escape prevention;
- no hardlinks;
- output/log caps;
- safe environment filtering;
- secret redaction;
- exact approval payload binding;
- stale merge-plan rejection;
- atomic writes and rollback evidence; and
- explicit isolation labels.

Do not broaden network access, side-effect permissions, or allowed roots to make a test pass.

## TypeScript and code-quality rules

- Use TypeScript for new runtime code.
- Keep strict types at boundaries; avoid `any` and unchecked casts.
- Define contracts once and re-export them; do not maintain duplicate schema/type definitions.
- Use discriminated unions for commands, results, statuses, and typed errors.
- Use stable machine-readable error codes.
- Keep provider-specific logic behind adapters.
- Keep filesystem and process operations behind focused modules/ports.
- Prefer small, testable functions over route-sized orchestration.
- Preserve Node-compatible server execution even though Bun is the package manager/test runner.
- Support native Windows, WSL2, and Linux paths explicitly.
- Use existing formatting/lint conventions; do not introduce a second toolchain.

## Testing rules

Every behavior change starts with or includes targeted tests.

Required layers as applicable:

1. schema tests;
2. repository and revision tests;
3. runtime service tests;
4. real process integration tests;
5. filesystem snapshot/workspace integration tests;
6. API mapping tests;
7. CLI JSON and exit-code tests;
8. architecture guard tests; and
9. Playwright operator-flow tests.

Use real temporary files and deterministic fixture processes for integration behavior. Do not mock away the behavior under test.

Minimum per PR:

```bash
bun run typecheck
bun run lint
# targeted bun test commands from the canonical implementation plan
```

Milestone close:

```bash
bun run check
bun run build
bun test:ui
bun run verify:local
```

Also run the milestone proof command introduced by that milestone.

A passing test claim requires captured command output. State clearly when a command was not run and why.

## PR discipline

Each PR must:

- match one manifest entry;
- stay within its declared scope unless a necessary dependency is documented;
- preserve compatibility routes and existing local-first data;
- avoid broad visual redesign;
- add or update focused tests;
- update the canonical plan/manifest only for durable path or contract changes;
- include migration and rollback notes;
- include exact validation commands and outputs; and
- leave `main` deployable.

Do not bundle unrelated cleanup into runtime PRs. Do not delete legacy readers before parity and compatibility proofs pass.

Recommended commit form:

```text
<type>(<scope>): <imperative summary>
```

The PR description must include:

- canonical PR ID;
- objective;
- files changed;
- contract/state impact;
- compatibility impact;
- security considerations;
- tests run;
- not-tested items;
- rollback path; and
- evidence for the PR gate.

## Documentation rules

- Keep product claims aligned with executable behavior.
- Never describe sequential execution as parallel.
- Never describe `THREADOS_SCOPED` as host isolation.
- Never imply that Git is required.
- Never instruct users to create or manage worktrees.
- Keep the CLI and app documentation consistent with the shared runtime.
- Update `docs/product/current-state.md` whenever implementation status materially changes.
- Update `docs/product/architecture-map.md` when ownership or runtime boundaries change.
- Update `docs/cli-reference.md` for every CLI contract change.

## Prohibited shortcuts

Do not:

- call `git worktree` from production code;
- use branches as the canonical Change Set abstraction;
- let agents write the canonical project during isolated attempts;
- report process control success after swallowing an error;
- flip a historical attempt back to `running`;
- persist secrets or full unredacted launch commands;
- use hardlinks for writable workspace materialization;
- follow escaping symlinks;
- derive success from agent prose or exit code alone when contracts/gates apply;
- add a second runtime lifecycle in a route, CLI command, or UI action;
- auto-apply agent changes before Milestone 2;
- enable `--parallel` before Milestone 3; or
- weaken policy, gates, approvals, or isolation to satisfy a test.

## Completion protocol

Before declaring a task complete:

1. verify the change against the canonical PRD and current manifest entry;
2. inspect the diff for scope creep and generated artifacts;
3. run targeted tests, typecheck, and lint;
4. run broader checks required by the PR gate;
5. inspect persisted runtime output when state behavior changed;
6. confirm no worktree invocation or canonical-workspace write path was introduced;
7. update documentation and tests;
8. clean temporary files, workspaces, fixtures, and debug output; and
9. report what passed, what was not run, risks, and the next manifest PR.

Do not claim the product or milestone is complete until its canonical evidence bundle and exit gate pass.
