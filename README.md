# ThreadOS

**AI Agent Sequence Orchestrator** — Manage multi-agent workflows with dependency graphs, policy enforcement, and a visual UI.

ThreadOS lets you define sequences of AI agent steps, wire them with dependencies, enforce safety policies, and monitor execution through a horizontal canvas UI.

## Installation

```bash
bun install
bun link    # registers the 'thread' command globally
```

## Environment

Copy `.env.example` to `.env.local` (UI/API) or `.env` and set values as needed.

| Variable | Required | Default | Purpose |
|------|------|------|------|
| `THREADOS_BASE_PATH` | No | `./` (or `process.cwd()` fallback) | Base directory used by API routes for ThreadOS files |
| `THREADOS_MPROCS_PATH` | No | auto-resolved | Absolute/relative path to `mprocs` binary |
| `ANTHROPIC_API_KEY` | Optional by workflow | unset | Required only for Anthropic-backed chat responses; CLI/thread management works without it |

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

ThreadOS exposes two product paths from a single entrance screen:

- **ThreadOS** — the core engineering environment for building, orchestrating, and inspecting multi-agent thread systems
- **Thread Runner** — a locked advanced proving mode for verified VM-based competitive runs, pack generation, and builder status (requires registration + subscription)

## Architecture

```text
ThreadOS
├── lib/seqctl/           # CLI commands
├── lib/sequence/         # Schema, parser, DAG
├── lib/llm/providers/    # Model provider layer (OpenAI, OpenRouter)
├── lib/thread-surfaces/  # Thread surface domain (types, projections, runtime events)
├── lib/thread-runner/    # Verified-run, race, and eligibility contracts
├── lib/packs/            # Pack and status records (Challenger/Champion/Hero)
├── lib/agents/           # Agent registration, profile builder, stats
├── lib/mprocs/           # Process manager adapter
├── lib/runner/           # Step execution wrapper
├── lib/policy/           # Safety policy engine
├── lib/audit/            # Audit logging
├── lib/chat/             # Chat orchestrator (system prompt, validator)
├── lib/reconciliation/   # State reconciliation
├── app/                  # Next.js UI + API routes
├── components/           # React components (workbench, hierarchy, lanes, inspector, skills)
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
```

Opens the workbench at `http://localhost:3000`:

- **Workbench Shell** — stable top bar, accordion panel, center board region
- **Hierarchy View** — structural thread map with focused trading-card inspection
- **Lane Board** — run-scoped execution surface with merge ordering and timeline context
- **Thread Inspector** — identity, run context, skills (local/inherited), and provenance
- **Skill Inventory** — per-surface skills resolved from agent registration
- **Step Inspector** — edit step/gate properties with dependency management
- **Chat Panel** — floating AI-assisted sequence management
- **Entry Screen** — ThreadOS (active) and Thread Runner (locked) product paths

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

## Policy Modes

Safety policy is loaded from `.threados/policy.yaml` (see [docs/policy.md](docs/policy.md)).

- `SAFE` (default): command execution actions require confirmation
- `POWER`: skips confirmations but still enforces limits (`forbidden_patterns`, concurrency/fanout caps, etc.)

## Local Verification

```bash
bun run check
```

## Testing

```bash
bun test
```

## Acknowledgments

Special thanks to [IndyDevDan](https://youtube.com/@IndyDevDan) (Dan, [@disler](https://github.com/disler)) for the inspiration. His work on agentic engineering patterns, Claude Code skills, and the [Agentic Engineer](https://agenticengineer.com) course helped shape the thinking behind ThreadOS. If you're building with AI agents, his content is essential viewing.

## License

MIT
