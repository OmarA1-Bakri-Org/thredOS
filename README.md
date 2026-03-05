# ThreadOS

**AI Agent Sequence Orchestrator** — Manage multi-agent workflows with dependency graphs, policy enforcement, and a visual UI.

ThreadOS lets you define sequences of AI agent steps, wire them with dependencies, enforce safety policies, and monitor execution through a horizontal canvas UI.

## Installation

```bash
bun install
bun link    # registers the 'thread' command globally
```

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

## Architecture

```text
ThreadOS
├── lib/seqctl/        # CLI commands
├── lib/sequence/      # Schema, parser, DAG
├── lib/mprocs/        # Process manager adapter
├── lib/runner/        # Step execution wrapper
├── lib/policy/        # Safety policy engine
├── lib/audit/         # Audit logging
├── lib/chat/          # Chat orchestrator (system prompt, validator)
├── lib/reconciliation/# State reconciliation
├── app/               # Next.js UI + API routes
├── components/        # React components (canvas, inspector, chat)
└── docs/              # Extended documentation
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

Opens the horizontal canvas UI at `http://localhost:3000` with:

- **Sequence Canvas** — Visual DAG of steps and dependencies
- **Step Inspector** — Edit step properties
- **Chat Panel** — AI-assisted sequence management
- **Toolbar** — Run, stop, status controls

## Documentation

- [CLI Reference](docs/cli-reference.md)
- [Thread Types Guide](docs/thread-types.md)
- [Policy Configuration](docs/policy.md)

## Testing

```bash
bun test
```

## Acknowledgments

Special thanks to [IndyDevDan](https://youtube.com/@IndyDevDan) (Dan, [@disler](https://github.com/disler)) for the inspiration. His work on agentic engineering patterns, Claude Code skills, and the [Agentic Engineer](https://agenticengineer.com) course helped shape the thinking behind ThreadOS. If you're building with AI agents, his content is essential viewing.

## License

MIT
