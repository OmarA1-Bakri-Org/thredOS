# `thread` CLI Reference

## Global Options

- `-j, --json` — Output as JSON
- `-h, --help` — Show help
- `-w, --watch` — Watch mode (status only)

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

Run one specific step.

```bash
thread run step research
```

### `thread run runnable`

Run all runnable steps.

```bash
thread run runnable
```

### `thread run group <groupId>`

Run a grouped set of steps.

```bash
thread run group group-1
```

### `thread status [--watch]`

Show sequence status.

```bash
thread status
thread status --watch
thread status --json
```

### `thread stop <stepId>`

Stop a running step.

```bash
thread stop research
```

### `thread restart <stepId>`

Restart a step.

```bash
thread restart research
```

### `thread group parallelize <stepId1> <stepId2> [...]`

Mark steps as a parallel group.

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

Generate `.threados/mprocs.yaml` and launch mprocs.

```bash
thread mprocs open
```

### `thread mprocs select <stepId>`

Select a step process in mprocs.

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

### `thread control <action> <stepId>`

Process control operations (stop, restart, signal).

```bash
thread control stop research
thread control restart research
```

### `thread event <stepId> [options]`

Stream or query runtime events for a step.

```bash
thread event research
thread event research --json
```

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
