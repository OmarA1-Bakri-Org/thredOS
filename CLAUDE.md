# ThreadOS

A local-first thread runtime for orchestrating multi-agent engineering workloads
with typed threads (Base/P/C/F/B/L), dependency graphs, gates, and policy enforcement.

## Quick Start

```bash
bun install
bun run check     # local verification (lint/tests/type checks as configured)
bun dev           # Next.js UI at http://localhost:3000
```

## Environment Variables

Use `.env.example` as the source of truth for local setup.

| Variable | Required | Default | Notes |
|------|------|------|------|
| `THREADOS_BASE_PATH` | No | `./` / `process.cwd()` fallback | API routes resolve `.threados/` data from this base path |
| `THREADOS_MPROCS_PATH` | No | auto-resolved (`mprocs` or vendored path) | Override when `mprocs` is not on PATH |
| `THREADOS_MODEL` | No | `gpt-4o` | Model ID — auto-routes to correct backend (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `OPENAI_API_KEY` | By model | unset | Required for OpenAI models (gpt-*, o1-*, o3-*, o4-*) |
| `OPENROUTER_API_KEY` | By model | unset | Universal relay — supports 100+ models including Claude, Llama, Gemini |
| `ANTHROPIC_API_KEY` | Optional | unset | Direct Anthropic access (future — currently routed via OpenRouter) |

## Policy (SAFE/POWER)

Policy config file: `.threados/policy.yaml` (full reference: `docs/policy.md`).

- `SAFE` is the default mode and requires confirmation for command execution.
- `POWER` removes confirmation prompts but still enforces policy limits.

## CLI

The `thread` command is the primary interface. Register it globally:

```bash
bun link          # makes 'thread' available in PATH
```

Run `thread --help` for the full command reference.

## Project Structure

```text
lib/agents/          # Agent registration, profile builder, stats tracking
lib/audit/           # Append-only audit logger
lib/chat/            # Chat orchestrator (system prompt, action validator)
lib/fs/              # Atomic file operations
lib/llm/             # LLM abstraction layer (model registry, provider routing)
lib/mprocs/          # mprocs process manager adapter
lib/packs/           # Pack and status records (Challenger/Champion/Hero)
lib/policy/          # Safety policy engine (SAFE/POWER modes)
lib/prompts/         # Prompt file CRUD manager
lib/provenance/      # Provenance tracking for thread artifacts
lib/reconciliation/  # State reconciliation between sequence and mprocs
lib/runner/          # Step execution wrapper with timeout/capture
lib/seqctl/          # CLI command handlers (thread init, step, run, etc.)
lib/sequence/        # Schema (Zod), YAML parser, DAG validation
lib/templates/       # Thread type template generators (base/p/c/f/b/l)
lib/thread-runner/   # Verified-run, race, and eligibility contracts
lib/thread-surfaces/ # Thread surface runtime (events, mutations, projections, spawn)
lib/ui/              # UI state management (React Query hooks, Zustand store, phases)
lib/workflows/       # Workflow templates and content-creator definitions
lib/errors.ts        # Error class hierarchy
app/                 # Next.js UI + API routes
app/api/             # REST endpoints (21 route groups — see below)
components/          # React components (14 directories — see below)
docs/                # CLI reference, thread types guide, policy docs
test/                # Integration and API tests
test/fixtures/       # Shared test data
test/helpers/        # Test utilities (temp dirs, sequence builders)
```

### API Routes

```text
app/api/agent-profile/    # Agent profile builder
app/api/agents/           # Agent registry and stats
app/api/apply/            # Apply chat-proposed actions
app/api/audit/            # Audit log queries
app/api/chat/             # Chat orchestrator endpoint
app/api/dep/              # Dependency management
app/api/fusion/           # Fusion pattern operations
app/api/gate/             # Gate insert/approve/block/rm
app/api/group/            # Parallel group management
app/api/packs/            # Pack and status records
app/api/restart/          # Restart stopped steps
app/api/run/              # Step/group execution
app/api/sequence/         # Sequence CRUD (read/reset)
app/api/status/           # Sequence status queries
app/api/step/             # Step CRUD operations
app/api/stop/             # Stop running steps
app/api/thread-annotations/ # Thread surface annotations
app/api/thread-merges/    # Thread merge/convergence
app/api/thread-runner/    # Thread Runner eligibility + runs
app/api/thread-runs/      # Thread run lifecycle
app/api/thread-surfaces/  # Thread surface runtime state
```

### Component Directories

```text
components/canvas/        # React Flow canvas (nodes, edges, context menu, detail cards)
components/chat/          # Chat panel and message rendering
components/command/       # Command palette
components/entry/         # Entry screen (ThreadOS / Thread Runner paths)
components/hierarchy/     # Hierarchy view with focused thread cards
components/inspector/     # Step/gate inspector and detail panels
components/lanes/         # Lane board view (run-scoped execution surface)
components/navigation/    # Navigation components
components/skills/        # Skill inventory display
components/thread-runner/ # Thread Runner UI components
components/toolbar/       # Toolbar components
components/ui/            # Shared UI primitives (shadcn/ui-style)
components/workbench/     # Workbench shell (top bar, accordion, sections)
components/workflows/     # Workflow template UI
```

## Architecture

The system has four layers:

**Sequence model** — `.threados/sequence.yaml` is the source of truth. Zod
schema validates all mutations. DAG validation prevents cycles. Gates block
dependent steps until approved.

**CLI (`thread`)** — Deterministic JSON I/O for all operations. Designed to be
called programmatically by LLM orchestrators. All commands support `--json`.

**Runtime** — mprocs manages parallel processes. Runner wrapper standardises
stdout/stderr capture, timeout handling, and artifact collection per step.
Thread surfaces track runtime events, spawn child sequences, and manage
merge/convergence across depth levels.

**LLM layer** — Model-agnostic provider routing. `THREADOS_MODEL` selects any
model by ID; the registry auto-routes to OpenAI, OpenRouter, or Anthropic
backends. Provider abstraction in `lib/llm/` keeps the rest of the system
model-agnostic.

## Key Design Decisions

- **File-first truth** — sequence state lives in YAML, not in memory
- **Atomic writes** — all file mutations go through `writeFileAtomic` (write to
  temp, rename)
- **Safe env filtering** — inherited env vars are filtered through an allowlist;
  user-provided env vars pass through
- **Global flag extraction** — the CLI extracts `--json`/`--help`/`--watch` at
  the top level and passes all other flags through to subcommand handlers
- **Policy enforcement** — SAFE mode requires confirmation for all mutations;
  POWER mode allows direct execution with limits still enforced

## Testing

```bash
bun run check                    # Local verification command
bun test                         # Full suite
bun test lib/sequence/           # Module-specific
bun test test/integration/       # Integration tests
bun test test/api/               # API route tests
bun test:ui                      # Playwright E2E tests
```

Tests use Bun's built-in test runner. Integration tests create temp directories,
run full CLI flows, and verify artifacts. API tests exercise the Next.js route
handlers directly.

## Testing Gotchas

- **`mock.module` requires ALL exports** — Bun's `mock.module('@/lib/ui/api', ...)` replaces the entire module. Every hook used by any transitive import of the component under test must be in the mock, not just direct imports. When adding a new hook to `lib/ui/api.ts`, update ALL test mocks that mock this module.
- **Current API export count: 49** — see `lib/ui/api.ts` exports (46 functions + 3 interfaces). 17 test files mock this module; run `grep -rl "mock.module('@/lib/ui/api'" components/` to find them all. When adding a new export, update every one.
- **`@tanstack/react-query` must be mocked separately** — components importing `useQueryClient` directly need `mock.module('@tanstack/react-query', ...)` in addition to the API mock
- **Store selectors are named exports** — `selectPathSegments`, `selectCurrentDepthSurfaceId`, `selectCurrentDepthLevel` must be included in `mock.module('@/lib/ui/store', ...)`

## Adding a New CLI Command

1. Create `lib/seqctl/commands/<n>.ts` with the handler function
2. Add the command to the `commands` map in `lib/seqctl/index.ts`
3. Add help text to the help string in `index.ts`
4. Write tests in `lib/seqctl/commands/<n>.test.ts`
5. If the command has a corresponding API route, add it in `app/api/`

## Adding a New Thread Type Template

1. Create `lib/templates/<type>.ts` exporting a `generate<Type>` function
2. Register it in `lib/templates/index.ts` and the `TEMPLATE_TYPES` array
3. Add a test case in `lib/templates/templates.test.ts`
4. Document the type in `docs/thread-types.md`

## Conventions

- Step IDs: lowercase alphanumeric + hyphens, max 64 chars
- Gate IDs: same format as step IDs
- All CLI output: JSON when `--json` is passed, human-readable otherwise
- Error handling: custom error classes from `lib/errors.ts` with error codes
- File paths: relative to project root, `.threados/` prefix for runtime data

## Context Window Management

The `context-checkpoint` skill manages context window lifecycle automatically via hookify.

- **Daemon start**: `python "%USERPROFILE%\.claude\skills\context-checkpoint\scripts\daemon_ctl.py" start --project-dir C--Users-OmarAl-Bakri-THREAD-OS`
- **Daemon status**: `python "%USERPROFILE%\.claude\skills\context-checkpoint\scripts\daemon_ctl.py" status`
- **Sentinel**: `%USERPROFILE%\.claude\.context_checkpoint_needed` (WSL: `/mnt/c/Users/OmarAl-Bakri/.claude/.context_checkpoint_needed`)
- **Hookify rules** in `.claude/` fire automatically on every prompt — pre-compaction (checkpoint + /compact + delete sentinel) and post-compaction (read checkpoint + /task-router:task-router + verify daemon)
- **Checkpoints** written to `%USERPROFILE%\.claude\projects\C--Users-OmarAl-Bakri-THREAD-OS\checkpoint-*.md`
