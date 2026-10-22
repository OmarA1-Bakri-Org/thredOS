# `thread` CLI Reference

## Global Options

- `-j, --json` — Output runtime commands with the versioned JSON envelope
- `-h, --help` — Show help
- `-w, --watch` — Watch mode (status only); JSON watch mode emits compact NDJSON
- `--idempotency-key <key>` — Supply a non-blank replay-safe key for a runtime mutation
- `--confirm` — Confirm the exact executable-policy subject for a run command

Runtime command JSON has one stable schema:

```json
{"schemaVersion":1,"success":true,"data":{}}
```

Failures use:

```json
{"schemaVersion":1,"success":false,"error":{"code":"VALIDATION_ERROR","message":"..."}}
```

Runtime exit codes are centralized: `0` success, `1` other error, `2` validation,
`3` policy/approval, `4` not found, `5` conflict or invalid state, `6` unsuccessful
run outcome, `7` process-control failure, and `8` unavailable runtime/resource.
Cancellation commands exit `0` after a confirmed cancellation even though the resulting
run or attempt status is `cancelled`.

## Commands

### `thread init`

Initialize `.threados/` in the current working directory.

```bash
thread init
```

### `thread step add <stepId> [options]`

Add a new step.

```bash
thread step add build --name "Build" --type base --model claude-code --prompt .threados/prompts/build.md
```

Options:
- `--name, -n` — Display name
- `--type, -t` — Step type: `base`, `p`, `c`, `f`, `b`, `l`
- `--model, -m` — Model id (for example `claude-code`, `codex`, `gemini`)
- `--prompt, -p` — Prompt file path
- `--depends-on, -d` — Comma-separated dependency IDs
- `--cwd` — Relative working directory within an isolated workspace; absolute paths and traversal are rejected
- `--side-effect` — Declared effect: `none`, `read`, `write`, or `execute`
- `--workspace` — Workspace mode: `auto` or `isolated`

### `thread step edit <stepId> [options]`

Edit an existing step.

The same `--side-effect`, `--workspace`, and `--cwd` options are accepted when editing.

```bash
thread step edit build --name "Build v2" --type p
```

### `thread step rm <stepId>`

Remove a step.

```bash
thread step rm build
```

### `thread step clone <sourceId> <newId>`

Clone an existing step.

```bash
thread step clone research research-copy
```

### `thread dep add <stepId> <depId>`

Add a dependency to a step.

```bash
thread dep add implement research
```

### `thread dep rm <stepId> <depId>`

Remove a dependency from a step.

```bash
thread dep rm implement research
```

### `thread gate insert <gateId> [options]`

Insert a gate.

```bash
thread gate insert review --name "Review" --depends-on research
```

Options:
- `--name, -n` — Gate display name
- `--depends-on, -d` — Comma-separated step IDs

### `thread gate approve <gateId>`

Approve a gate.

```bash
thread gate approve review
```

### `thread gate block <gateId>`

Block a gate.

```bash
thread gate block review
```

### `thread gate list`

List all gates.

```bash
thread gate list
```

### `thread run step <stepId>`

Run one specific step through `ThreadOSRuntimeService`. Milestone 0 execution is sequential.

Every executable step must be assigned an agent registered in `.threados/state/agents.json`, with matching model, role, canonical prompt reference, and skills. Missing registration fails with `AGENT_REGISTRATION_REQUIRED`; an unknown registration fails with `AGENT_NOT_REGISTERED`; a different loadout fails with `AGENT_COMPOSITION_MISMATCH`. Launch binds the registration version, composition, and asset content hashes. Retry retains the original binding. Legacy attempts without a frozen identity fail with `AGENT_REGISTRATION_REQUIRED`; a changed frozen identity or content fails with `AGENT_IDENTITY_CHANGED`. Start a new execution with a replacement registration for material changes.

Write/execute steps and steps configured with `--workspace isolated` run in verified portable-copy workspaces from the run's immutable baseline. Configured bootstrap commands run there first under executable policy. Bootstrap command, policy, or artifact errors block agent launch with `WORKSPACE_BOOTSTRAP_FAILED` (exit `8`); identity and process-control failures retain their typed `AGENT_*` or `PROCESS_CONTROL_FAILED` codes. The agent receives workspace, snapshot, and attempt identifiers without `THREADOS_BASE_PATH`. Successful workspaces and failure/review evidence are retained; cancellation may clean a pristine workspace. Attributed thredOS writes to the canonical project fail with `CANONICAL_WORKSPACE_MUTATED` (exit `5`). Isolation is `THREADOS_SCOPED`; execution remains sequential and does not apply workspace output to the canonical project.

A successful process exit does not validate a configured output schema or completion contract. Those gates remain blocked without validation evidence, so the attempt becomes `needs_review` and the run awaits review.

Failed control of a managed live bootstrap leaves its attempt and workspace active so cancellation can be retried. Cancellation intent alone cannot confirm termination of a lost process; the runtime preserves `PROCESS_CONTROL_FAILED` evidence.

```bash
thread run step research
```

### `thread run runnable`

Run all currently runnable steps through the shared sequential runtime.

```bash
thread run runnable
```

### `thread run group <groupId>`

Run a grouped set of steps sequentially. Group metadata does not enable concurrent execution
before Milestone 3.

```bash
thread run group group-1
```

### `thread run list|inspect|cancel`

Inspect and control canonical workflow-run records.

```bash
thread run list --json
thread run inspect <runId> --json
thread run cancel <runId> --idempotency-key <key> --json
```

### `thread attempt inspect|cancel|retry`

Inspect and control canonical step-attempt records. Retry creates a new attempt with
`retry_of_attempt_id` lineage; it never changes a historical attempt back to running.

```bash
thread attempt inspect <attemptId> --json
thread attempt cancel <attemptId> --idempotency-key <key> --json
thread attempt retry <attemptId> --idempotency-key <key> --json
```

### `thread workspace list|inspect|retain|clean|doctor`

Inspect and manage the Surface Workspaces used by write and execute attempts.
These commands read and mutate the same canonical workspace records as the API
and operator UI. Portable-copy workspaces report `THREADOS_SCOPED` isolation;
the label does not claim host-enforced containment.

```bash
thread workspace list --json
thread workspace list --run <runId> --json
thread workspace inspect <workspaceId> --json
thread workspace retain <workspaceId> --idempotency-key <key> --json
thread workspace clean <workspaceId> --idempotency-key <key> --json
thread workspace doctor --json
```

`retain` preserves a workspace for review. `clean` follows the workspace
lifecycle and quota rules; it does not apply files to the canonical project.
`doctor` reports configuration, canonical records, external storage, and
diagnostic errors without treating missing process evidence as success.

Cleanup fails with `WORKSPACE_NOT_CLEANABLE` when process termination evidence is missing, lost, malformed, quarantined, or ambiguous. POSIX cleanup checks both the recorded PID and its original process group. The current Windows observation port cannot prove descendant termination after a leader exits, so cleanup of a workspace with process records is refused there. The API returns HTTP `409`; CLI returns conflict exit code `5`. SAFE-mode cleanup requires `--confirm` (or API `policy_confirmed: true`).

### `thread status [--watch]`

Show status derived from canonical runtime records. mprocs state is not execution truth.

```bash
thread status
thread status --watch
thread status --json
thread status --watch --json
```

### `thread stop <stepId>`

Cancel the latest running canonical attempt for a step. Until PR-06 installs the truthful
process controller, a live cancellation returns a nonzero process-control error rather than
claiming success.

```bash
thread stop research
```

### `thread restart <stepId>`

Retry the latest terminal canonical attempt for a step as a new attempt with lineage.

```bash
thread restart research
```

### `thread group parallelize <stepId1> <stepId2> [...]`

Mark steps as a parallel group. This is configuration only; Milestones 0–1 still schedule
the group sequentially and explicit parallel execution remains unavailable until Milestone 3.

```bash
thread group parallelize research implement validate
```

### `thread group list`

List existing groups.

```bash
thread group list
```

### `thread fusion create --candidates <id1,id2,...> --synth <synthId>`

Create a fusion pattern.

```bash
thread fusion create --candidates draft-a,draft-b --synth final-synth
```

### `thread mprocs open`

Generate `.threados/mprocs.yaml` and launch optional legacy observability. mprocs never
updates or overrides canonical V2 runtime state, and launch failure exits nonzero.

```bash
thread mprocs open
```

### `thread mprocs select <stepId>`

Select a legacy observed process in mprocs. Selection failure exits nonzero.

```bash
thread mprocs select research
```

### `thread template apply <type> [--name <name>]`

Apply a thread template.

```bash
thread template apply parallel --name "Parallel Research"
thread template apply chained --name "Pipeline"
```

Available templates: `base`, `parallel`, `chained`, `fusion`, `orchestrated`, `long-autonomy`

### `thread event spawn-child <childStepId> [options]`

Emit a spawn-child runtime event.

```bash
thread event spawn-child worker-1 --label "Worker" --kind orchestrator --parent-step-id main-step
```

Options:
- `--label` — Display label for the child
- `--kind` — Spawn kind (`orchestrator`, `watchdog`, `fanout`)
- `--parent-step-id` — Parent step ID (optional)

### `thread event merge-into <destinationStepId> [options]`

Emit a merge-into runtime event.

```bash
thread event merge-into synthesizer --sources worker-1,worker-2 --kind single
```

Options:
- `--sources` — Comma-separated source step IDs
- `--kind` — Merge kind (`single`, `block`)
- `--summary` — Optional merge summary

## Environment Variables

See `.env.example` for local defaults and expected values:

- `THREADOS_BASE_PATH` — Base directory for `.threados/` data
- `THREADOS_MPROCS_PATH` — Custom mprocs binary path
- `THREADOS_MODEL` — Model ID (auto-routes to correct backend)
- `OPENAI_API_KEY` — Direct OpenAI access
- `OPENROUTER_API_KEY` — Universal relay for 100+ models
- `ANTHROPIC_API_KEY` — Direct Anthropic access (future)

## Policy Modes

Policy file location: `.threados/policy.yaml`.

- `SAFE` (default): requires confirmation for command execution actions.
- `POWER`: no confirmation prompts, but policy limits still apply.

Full policy reference: `docs/policy.md`.

## Local Verification

```bash
bun run check
bun run verify:m1
```

`verify:m1` generates fresh M1 evidence under the sequential scheduler. Runtime isolation, export privacy, the no-worktree guard, workspace API/CLI/component contracts, production build, and workspace-inspector UI/local proof must all pass. A failed evidence run is diagnostic output, not acceptance.


### Controlled merge transactions (bounded M2)

All commands use the shared runtime service. The normal runtime still refuses apply with `MERGE_APPLY_CAPABILITY_UNAVAILABLE` until an approved protected provider is explicitly configured by the server. `--confirm` is explicit operator confirmation; it does not create or replace a persisted human approval.

```text
thread merge preview <changeSetId>
thread merge inspect <mergePlanId>
thread merge validate <mergePlanId> [--confirm]
thread merge approval-subject <mergePlanId> --confirm
thread merge apply <mergePlanId> <approvalId> <exactDigest> --confirm
thread merge result <mergeResultId>
thread merge recover <mergeResultId> --confirm
thread merge recover-validation <mergePlanId> --confirm
thread merge rollback-subject <mergeResultId> --confirm
thread merge rollback <mergeResultId> <freshApprovalId> <rollbackDigest> --confirm
```

Each accepts `--json` and `--idempotency-key`. Apply that reverses after a verified failure exits nonzero, even when rollback succeeded. Recovery requiring review also exits nonzero. Missing/corrupt process evidence, uncertain helper completion, changed affected files or stale approval bindings never authorize a retry or rollback. A successful manual rollback preserves unrelated later edits and records a new exact approval against its current precondition.
