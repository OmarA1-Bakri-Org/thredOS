# Developer Onboarding

## What You Are Joining

This repo is building ThreadOS first.

When you run the app today:

- ThreadOS is the active workbench
- Thread Runner is visible, but locked

Do not assume the repo is centered on Thread Runner just because the domain types exist.

## Fast Path

If you just need to get productive quickly:

```bash
bun install
bun link
thread init
bun dev
```

Then open `http://localhost:3000`, enter `ThreadOS`, and run:

```bash
bun run check
```

## Prerequisites

- Node.js 22 or newer (`package.json` sets `engines.node` to `>=22.0.0`)
- Bun
- optional: `mprocs` available on your machine, unless you point `THREADOS_MPROCS_PATH` at a binary
- API keys only if you want live LLM-backed chat behavior

## Install

```bash
bun install
bun link
```

`bun link` registers the `thread` CLI from `lib/seqctl/index.ts`.

## Environment Setup

Use `.env.example` as the source of truth.

Typical local setup:

1. copy `.env.example` to `.env.local` for the UI/API or `.env` for a repo-local shell workflow
2. set `THREADOS_BASE_PATH` if you want the app to read `.threados/` data from somewhere other than the repo root
3. set `THREADOS_MPROCS_PATH` if `mprocs` is not on your `PATH`
4. set `THREADOS_MODEL` plus the matching provider key if you want live model responses

Important environment variables:

- `THREADOS_BASE_PATH`
- `THREADOS_MPROCS_PATH`
- `THREADOS_MODEL`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_APP_URL`
- `OPENROUTER_APP_TITLE`
- `ANTHROPIC_API_KEY` (documented as future/direct access, currently routed through OpenRouter in repo docs)

## Run The App

Start the UI:

```bash
bun dev
```

Open `http://localhost:3000`.

You will land on the product entry screen. Enter `ThreadOS` to reach the workbench. `Thread Runner` is intentionally locked.

Useful current UI behavior:

- `New` in the top bar prompts for a thread name before clearing the sequence
- the Sequence section lets you rename the sequence inline
- thread type selection persists to `.threados/sequence.yaml`
- applying a template replaces the current sequence and writes placeholder prompt files for generated steps
- creating a step or gate auto-focuses the relevant phase in the left rail after status refresh
- gate criteria are editable from the Gate section
- agent registration and assignment are available from the Agent section

## Use The CLI

Initialize local ThreadOS state:

```bash
thread init
```

From there, the main CLI areas are:

- `thread step ...`
- `thread dep ...`
- `thread gate ...`
- `thread group ...`
- `thread fusion ...`
- `thread run ...`
- `thread stop ...`
- `thread restart ...`
- `thread status`

The CLI and the UI operate on the same local `.threados/` state.

## Working Assumptions

Keep these mental models straight while developing:

- `.threados/sequence.yaml` is the control-plane source of truth for the active sequence
- `.threados/state/` stores runtime-facing state like thread surfaces, runs, and related projections
- the UI and CLI are two faces on the same local model, not separate systems
- template application is destructive to the current sequence by design
- Thread Runner code exists in the repo, but normal product work still centers on ThreadOS

## Test And Verify

Available commands from `package.json`:

```bash
bun run lint
bun run typecheck
bun test
bun test:ui
bun run check
```

Current repo reality:

- `bun run check` passes on this repo state
- the combined check runs `bun run lint && bun run typecheck && bun test`
- `bun test:ui` is still a separate command when you want browser-level coverage

Do not assume that baseline will stay green across local changes. Re-run the checks before relying on it.

## Repo Navigation

Use this map when orienting yourself:

- `app/page.tsx`: top-level product entry
- `components/entry/`: entry screen
- `components/workbench/`: shell and left rail
- `components/canvas/`, `components/hierarchy/`, `components/lanes/`, `components/inspector/`, `components/chat/`: main ThreadOS UI surfaces
- `lib/ui/api.ts`: React Query bridge to the API routes
- `lib/ui/store.ts`: client UI state
- `app/api/`: local API routes used by the UI
- `lib/seqctl/`: CLI command layer
- `lib/sequence/`: sequence schema, parser, and DAG logic
- `lib/runner/`: prompt compilation, dispatch, wrapper, artifacts
- `lib/thread-surfaces/`: runtime surface model
- `lib/policy/` and `lib/audit/`: policy and audit behavior
- `lib/thread-runner/`, `lib/packs/`, `lib/agents/`: early Thread Runner and builder domain model
- `.threados/`: local sequence, prompts, runs, state, and policy data

If you are tracing the main product loop, follow this path:

1. `app/page.tsx`
2. `components/entry/ProductEntryScreen.tsx`
3. `components/workbench/WorkbenchShell.tsx`
4. `lib/ui/api.ts`
5. `app/api/sequence/route.ts` and `app/api/run/route.ts`
6. `lib/sequence/`, `lib/runner/`, and `lib/thread-surfaces/`

## Current Caveats You Should Know Up Front

- Chat can fall back to a stub response if no provider client is configured. See `app/api/chat/route.ts`.
- The chat apply loop is real, but it still depends on extracting JSON actions from free-form model output and on the limited command coverage in `lib/chat/validator.ts`. See `lib/chat/extract-actions.ts`, `app/api/apply/route.ts`, and `lib/chat/validator.ts`.
- Some ThreadOS sub-panels still contain placeholder-only data, especially gate quality metrics and agent performance cards. See `components/workbench/sections/GateSection.tsx` and `components/workbench/sections/AgentSection.tsx`.
- The canvas can still fall back to a status-derived scaffold instead of full thread-surface runtime data. See `components/canvas/threadSurfaceScaffold.ts`.
- Thread Runner is not ready for normal development work beyond its early domain contracts and locked gate.

## Read Next

- [Product Documentation Pack](./README.md)
- [Current State of the Product](./current-state.md)
- [Architecture Map](./architecture-map.md)
- [Product Narrative](./product-narrative.md)
