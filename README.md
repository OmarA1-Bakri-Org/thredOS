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
| `THREADOS_MODEL` | No | `gpt-4o` | Model ID — auto-routes to correct backend (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
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

ThreadOS exposes two product paths from a single entrance screen:

- **ThreadOS** — the core engineering environment for building, orchestrating, and inspecting multi-agent thread systems
- **Thread Runner** — a locked advanced proving mode for verified VM-based competitive runs, pack generation, and builder status (requires registration + subscription)

## Architecture

```text
ThreadOS
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
```

Opens the workbench at `http://localhost:3000`:

- **Workbench Shell** — stable top bar, left-rail accordion panel, center board region
- **Canvas** — React Flow-based sequence editor with nodes, gates, edges, and context menus
- **Hierarchy View** — structural thread map with focused trading-card inspection
- **Lane Board** — run-scoped execution surface with merge ordering and timeline context
- **Left Rail** — 6-section accordion: Sequence, Phase, Node, Agent, Gate, Run
- **Thread Inspector** — identity, run context, skills (local/inherited), and provenance
- **Chat Panel** — floating AI-assisted sequence management
- **Entry Screen** — ThreadOS (active) and Thread Runner (locked) product paths

## Documentation

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
bun test             # Full test suite
bun test:ui          # Playwright E2E tests
bun run check        # Lint + typecheck + test
```

## Acknowledgments

Special thanks to [IndyDevDan](https://youtube.com/@IndyDevDan) (Dan, [@disler](https://github.com/disler)) for the inspiration. His work on agentic engineering patterns, Claude Code skills, and the [Agentic Engineer](https://agenticengineer.com) course helped shape the thinking behind ThreadOS. If you're building with AI agents, his content is essential viewing.

## License

MIT
