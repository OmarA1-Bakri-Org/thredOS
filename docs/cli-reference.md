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
- `--cwd` — Working directory for the step

### `thread step edit <stepId> [options]`

Edit an existing step.

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
```
