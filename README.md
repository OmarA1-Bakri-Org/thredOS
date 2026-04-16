# thredOS

**Local-first operating system for agent work.** Build, inspect, and govern multi-agent workflows with a shared UI + CLI control plane while keeping prompts, skills, threads, surfaces, runs, and artifacts on your machine.

thredOS turns agent work from ad hoc terminal sessions into an explicit operating model:

- define steps, dependencies, gates, and approvals
- execute through the same local-first sequence model from either the UI or CLI
- inspect runtime surfaces, runs, merges, and provenance visually
- keep policy, audit history, and workflow state inside `.threados/`

The cloud is intentionally narrow: activation, billing, and canonical agent registration only.

## Why this project stands out

Most agent workflows still look like prompt fragments, shell history, and tribal knowledge. thredOS is opinionated about making the work:

- **structured** — sequences, dependencies, gates, and thread types are first-class
- **inspectable** — hierarchy, lanes, surfaces, and runs are visible in the workbench
- **governed** — policy, approvals, audit history, and local boundaries are built in
- **local-first** — workflow content stays in the repo/workspace instead of being pushed to a hosted control plane

## Installation

```bash
bun install
bun link    # registers the 'thread' command globally
```

## Environment

Copy `.env.example` to `.env.local` (UI/API) or `.env` and set values as needed.

| Variable | Required | Default | Purpose |
|------|------|------|------|
| `THREADOS_BASE_PATH` | No | `./` (or `process.cwd()` fallback) | Base directory used by API routes for thredOS files |
| `THREADOS_MPROCS_PATH` | No | auto-resolved | Absolute/relative path to `mprocs` binary |
| `THREADOS_MODEL` | No | `gpt-4o` | Model ID — auto-routes to correct backend (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `THREDOS_CLERK_SIGN_IN_URL` | Launch | unset | Hosted Clerk sign-in URL used by thredOS Desktop browser activation |
| `THREDOS_STRIPE_SECRET_KEY` | Launch | unset | Stripe secret key for desktop checkout and webhook processing |
| `THREDOS_STRIPE_PRICE_ID` | Launch | unset | Stripe price id for the desktop public beta plan |
| `THREDOS_STRIPE_WEBHOOK_SECRET` | Launch | unset | Stripe webhook verification secret |
| `OPENAI_API_KEY` | By model | unset | Required for direct OpenAI models (gpt-*, o1-*, o3-*, o4-*) |
| `OPENROUTER_API_KEY` | By model | unset | Universal relay — supports 100+ models including Claude, Llama, Gemini |
| `ANTHROPIC_API_KEY` | Optional | unset | Direct Anthropic access (future — currently routed via OpenRouter) |

## Quick Start

```bash
# Initialize a new sequence
thread init

# Add steps
thread step add research --name "Research" --type base --model claude-code --prompt prompts/research.md
thread step add implement --name "Implement" --type base --model claude-code --prompt prompts/implement.md

# Add dependencies
thread dep add implement research

# Insert a review gate
thread gate insert review --name "Review Research" --depends-on research
thread dep add implement review

# Check status
thread status

# Approve the gate and run
thread gate approve review
thread run runnable
```

## Product Entry Points

thredOS is presented in three product layers:

- **thredOS Desktop** — the local-first engineering environment for building, orchestrating, and inspecting agent systems
- **thredOS Node** — the follow-on stronger-machine/self-hosted runtime path for users who want their own infrastructure
- **Thread Runner** — the separate cloud proving layer for verified competitive runs and pack progression

## Local-First Boundary

Cloud-permitted data:

- account identity
- billing state
- activation state
- canonical agent registration

Cloud-forbidden data:

- prompt markdown
- skill markdown
- sequence state
- thread surfaces and runtime logs
- workspace files
- artifacts and user workflow content

## Architecture

```text
thredOS
├── lib/agents/           # Agent registration, profile builder, stats
├── lib/audit/            # Append-only audit logger
├── lib/chat/             # Chat orchestrator (system prompt, validator)
├── lib/fs/               # Atomic file operations
├── lib/llm/              # LLM abstraction (model registry, provider routing)
├── lib/mprocs/           # Process manager adapter
├── lib/packs/            # Pack and status records (Challenger/Champion/Hero)
├── lib/policy/           # Safety policy engine
├── lib/prompts/          # Prompt file CRUD manager
├── lib/provenance/       # Provenance tracking for thread artifacts
├── lib/reconciliation/   # State reconciliation
├── lib/runner/           # Step execution wrapper
├── lib/seqctl/           # CLI commands (12 handlers)
├── lib/sequence/         # Schema, parser, DAG validation
├── lib/templates/        # Thread type templates (base/p/c/f/b/l)
├── lib/thread-runner/    # Verified-run, race, and eligibility contracts
├── lib/thread-surfaces/  # Thread surface runtime (events, spawn, projections)
├── lib/ui/               # UI state (React Query hooks, Zustand store)
├── lib/workflows/        # Workflow templates and content definitions
├── app/                  # Next.js UI + 21 API route groups
├── components/           # React components (14 directories)
└── docs/                 # Extended documentation
```

### Thread Types

| Type | Name | Description |
|------|------|-------------|
| `base` | Base | Single sequential agent |
| `p` | Parallel | Multiple agents, same task |
| `c` | Chained | Sequential pipeline with gates |
| `f` | Fusion | Candidates + synthesis |
| `b` | Baton | Hand-off between agents |
| `l` | Long-autonomy | Extended autonomous operation |

## CLI Reference

See [docs/cli-reference.md](docs/cli-reference.md) for the complete command reference.

Key commands:

- `thread init` — Initialize a sequence
- `thread step add|edit|rm|clone` — Manage steps
- `thread dep add|rm` — Manage dependencies
- `thread gate insert|approve|block|list` — Control gates
- `thread group parallelize|list` — Manage parallel groups
- `thread fusion create` — Create fusion workflows
- `thread run step|runnable|group` — Execute steps
- `thread stop|restart` — Control running steps
- `thread status` — View current state
- `thread template apply <type>` — Apply thread templates

## UI

```bash
bun dev
# WSL mounted repo: bun run dev:wsl
```

If you are running from WSL on a repo mounted under `/mnt/*`, use `bun run dev:wsl` instead. It relays through a native Linux temp copy so Next.js and Turbopack start reliably.

Open the workbench at `http://localhost:3000`:

- **Workbench Shell** — stable top bar, left-rail accordion, center board region
- **Canvas** — React Flow-based sequence editor with nodes, gates, edges, and context menus
- **Hierarchy View** — structural thread map with focused card-based inspection
- **Lane Board** — run-scoped execution surface with merge ordering and timeline context
- **Left Rail** — six sections: Sequence, Phase, Node, Agent, Gate, Run
- **Thread Inspector** — identity, run context, skills, and provenance
- **Chat Panel** — floating AI-assisted sequence management
- **Entry Screen** — thredOS Desktop public beta launch surface

## Interview / review reading path

If you are reviewing the project quickly, start here:

1. [Founder Overview](docs/product/founder-overview.md)
2. [Current State of the Product](docs/product/current-state.md)
3. [Architecture Map](docs/product/architecture-map.md)
4. [Developer Onboarding](docs/product/developer-onboarding.md)

## Documentation

- [Product Documentation Pack](docs/product/README.md)
- [Founder Overview](docs/product/founder-overview.md)
- [Current State of the Product](docs/product/current-state.md)
- [Architecture Map](docs/product/architecture-map.md)
- [Product Narrative](docs/product/product-narrative.md)
- [Developer Onboarding](docs/product/developer-onboarding.md)
- [CLI Reference](docs/cli-reference.md)
- [Thread Types Guide](docs/thread-types.md)
- [Policy Configuration](docs/policy.md)
- [Desktop Release Checklist](docs/launch/desktop-release-checklist.md)
- [Desktop Support Runbook](docs/launch/desktop-support-runbook.md)

## Policy Modes

Safety policy is loaded from `.threados/policy.yaml` (see [docs/policy.md](docs/policy.md)).

- `SAFE` (default): command execution actions require confirmation
- `POWER`: skips confirmations but still enforces limits (`forbidden_patterns`, concurrency/fanout caps, etc.)

## Local Verification



For WSL-mounted repos, prefer  for the interactive app and  for the launch checklist flow. Both now relay through a native Linux temp copy when the repo lives under .```bash
bun run check
```

## Testing

```bash
bun test             # Full test suite
bun test:ui          # Playwright E2E tests
bun run check        # Lint + typecheck + test
```

## Acknowledgments

Special thanks to [IndyDevDan](https://youtube.com/@IndyDevDan) (Dan, [@disler](https://github.com/disler)) for the inspiration. His work on agentic engineering patterns, Claude Code skills, and the [Agentic Engineer](https://agenticengineer.com) course helped shape the thinking behind thredOS. If you're building with AI agents, his content is essential viewing.

## License

MIT
