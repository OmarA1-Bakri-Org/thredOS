# ThreadOS

A local-first thread runtime for orchestrating multi-agent engineering workloads
with typed threads (Base/P/C/F/B/L), dependency graphs, gates, and policy enforcement.

## Quick Start

```bash
bun install
bun test          # run full test suite
bun dev           # Next.js UI at http://localhost:3000
```

## CLI

The `thread` command is the primary interface. Register it globally:

```bash
bun link          # makes 'thread' available in PATH
```

Run `thread --help` for the full command reference.

## Project Structure

```text
lib/seqctl/          # CLI command handlers (thread init, step, run, etc.)
lib/sequence/        # Schema (Zod), YAML parser, DAG validation
lib/runner/          # Step execution wrapper with timeout/capture
lib/mprocs/          # mprocs process manager adapter
lib/policy/          # Safety policy engine (SAFE/POWER modes)
lib/audit/           # Append-only audit logger
lib/chat/            # Chat orchestrator (system prompt, action validator)
lib/templates/       # Thread type template generators (base/p/c/f/b/l)
lib/reconciliation/  # State reconciliation between sequence and mprocs
lib/prompts/         # Prompt file CRUD manager
lib/fs/              # Atomic file operations
lib/errors.ts        # Error class hierarchy
app/                 # Next.js UI + API routes
app/api/             # REST endpoints (sequence, step, gate, group, etc.)
components/          # React components (canvas, inspector, chat, toolbar)
docs/                # CLI reference, thread types guide, policy docs
test/                # Integration and API tests
test/fixtures/       # Shared test data
test/helpers/        # Test utilities (temp dirs, sequence builders)
```

## Architecture

The system has three layers:

**Sequence model** — `.threados/sequence.yaml` is the source of truth. Zod
schema validates all mutations. DAG validation prevents cycles. Gates block
dependent steps until approved.

**CLI (`thread`)** — Deterministic JSON I/O for all operations. Designed to be
called programmatically by LLM orchestrators. All commands support `--json`.

**Runtime** — mprocs manages parallel processes. Runner wrapper standardises
stdout/stderr capture, timeout handling, and artifact collection per step.

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
bun test                         # Full suite
bun test lib/sequence/           # Module-specific
bun test test/integration/       # Integration tests
bun test test/api/               # API route tests
```

Tests use Bun's built-in test runner. Integration tests create temp directories,
run full CLI flows, and verify artifacts. API tests exercise the Next.js route
handlers directly.

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
