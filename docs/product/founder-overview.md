# Founder Overview

## What the product is

thredOS is a local-first control plane for agentic engineering.

Today it is the real product in this repo. It gives a team one place to define work, run it, inspect runtime state, and keep local policy and audit history without splitting that workflow across ad hoc terminals and scripts.

It combines:

- a Next.js workbench for sequence construction, runtime inspection, hierarchy, lanes, and chat
- a local API under `app/api/` that the UI uses for mutations and reads
- a CLI under `lib/seqctl/` for deterministic control over the same underlying state
- local runtime and sequence state stored under `.threados/`

Thread Runner is visible in the product language and codebase, but it is not the primary app today.

## What problem it solves

Without a control plane, multi-agent work usually degrades into:

- terminal sprawl
- unclear step dependencies
- weak or missing approval points
- inconsistent runtime truth
- no durable model for runs, merges, and delegated child work
- poor auditability around what changed and why

thredOS solves that by turning agent work into an explicit, inspectable operating model with:

- steps and dependencies
- gates and approvals
- runtime surfaces and runs
- spawn and merge event history
- local audit and policy enforcement
- a UI and CLI that operate on the same underlying state

## Who it is for

The primary users are:

- founders or technical operators who need visibility and control over agent execution
- staff and principal engineers designing multi-step workflows instead of one-off prompts
- hands-on agentic engineers who want a local-first workbench instead of terminal improvisation

The repo also clearly anticipates a future automated orchestrator that can drive the same model through the CLI and API.

## What is demo-ready today

Today the repo already contains:

- the live thredOS entry path and workbench shell
- a shared local sequence model with step, dependency, gate, group, fusion, run, stop, and restart flows
- workbench-level sequence authoring for naming threads, setting thread type, applying templates, and creating steps and gates
- UI surfaces for hierarchy, lanes, inspection, chat, gate editing, and basic agent assignment
- persistent thread-surface state for surfaces, runs, merges, annotations, and runtime events
- policy and audit foundations around sequence mutation and execution
- early agent, pack, and Thread Runner domain scaffolding

## What is intentionally unfinished

The unfinished areas are not subtle:

- Thread Runner is still a locked coming-soon surface, not a usable product loop
- eligibility, verified VM execution, competitive races, and pack progression are not live as finished user journeys
- some thredOS sub-panels still rely on placeholder metrics or fallback scaffolds
- the chat/apply loop is real, but it still depends on model-produced JSON actions and limited validator coverage
- the proving-layer economy, ranking, and unlock story exists mostly as domain groundwork rather than finished product behavior

## What to say in a demo or interview

The strongest concise framing is:

> thredOS is a local-first operating system for agent work. It replaces prompt sprawl and terminal improvisation with a structured workbench for sequencing, governing, and inspecting multi-agent execution.

It is credible in interviews because the repo already demonstrates:

- a real UI + API + CLI control plane
- a concrete local-first data boundary
- explicit runtime modeling for threads, surfaces, runs, and approvals
- a visible path from authoring to execution to inspection

## Where the architecture lives in the repo

Start with [Architecture Map](./architecture-map.md), then use these anchors:

- `app/` for the product entry and local API routes
- `components/` for the workbench, hierarchy, lanes, inspectors, chat, and entry surfaces
- `lib/ui/` for the UI query layer and client state
- `lib/seqctl/` for the CLI control plane
- `lib/sequence/` for schema, parsing, validation, and template application
- `lib/runner/`, `lib/mprocs/`, and `lib/thread-surfaces/` for execution and runtime state
- `lib/policy/` and `lib/audit/` for guardrails and traceability
- `lib/thread-runner/`, `lib/packs/`, and `lib/agents/` for the future proving-layer model
