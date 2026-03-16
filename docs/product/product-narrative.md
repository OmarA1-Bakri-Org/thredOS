# Product Narrative

## The Short Version

ThreadOS is the product that exists today.

Thread Runner is the proving layer planned beside it, but not yet active as a usable product surface. In the current app it is intentionally visible and intentionally locked.

## The Relationship Between ThreadOS And Thread Runner

ThreadOS is the operating workbench:

- define work as a structured sequence
- execute work locally
- inspect runtime state and history
- manage approvals, gates, and agent assignment
- review surfaces, runs, merges, and provenance

Thread Runner is the future proving layer:

- benchmark agents against each other
- run verified competitive executions
- compare builders over time
- produce rankings, packs, and proving outcomes

Today, Thread Runner is mostly domain scaffolding plus a locked UI gate. It is not the main application.

## Core Product Terms

### Thread

In product language, a thread is a unit of agent work.

In the current data model, that usually starts as a `Step` inside `.threados/sequence.yaml`. The word "thread" is broader than "step" in the product narrative, but the step is the concrete object that ThreadOS edits, validates, and executes.

### Surface

A surface is the runtime and inspection container for a thread after ThreadOS materializes it into the thread-surface model.

Surfaces are stored in `.threados/state/thread-surfaces.json` and managed by `lib/thread-surfaces/`.

### Run

A run is one execution attempt for a surface.

Runs carry status, timestamps, summaries, parent-child relationships, and event history. A single surface can have multiple runs over time.

### Builder

A builder is the human, team, or system identity behind a registered agent.

In code, builder fields appear on both agent registrations and pack records:

- `AgentRegistration.builderId`
- `AgentRegistration.builderName`
- `Pack.builderId`
- `Pack.builderName`

### Pack

A pack is a status or ranking record attached to a builder and their agent lineage in the proving layer.

In the current repo, packs exist as early domain records under `lib/packs/`. They are not yet part of a finished proving loop.

## How The Model Fits Together

The relationship should be read in this order:

1. A builder creates or registers an agent.
2. An engineer uses ThreadOS to assemble a sequence of threads.
3. In code, those threads begin as steps in the sequence model.
4. When work executes, ThreadOS materializes runtime surfaces and runs for those steps.
5. Runtime events can spawn child surfaces or merge results back into another surface.
6. In the future, some of those builders and agents will also enter Thread Runner proving flows.
7. Thread Runner is where pack outcomes and competitive records are meant to live.

## What ThreadOS Means Today

Today, ThreadOS is about structured agentic engineering:

- sequence editing
- runtime execution
- visual inspection
- gate control and approval
- basic agent registration and assignment
- local policy and audit
- thread-surface runtime modeling

It is not primarily a competitive ranking product today.

## What Thread Runner Means Today

Today, Thread Runner means:

- a visible product direction
- a locked gate in the UI
- early eligibility, race, run, and pack contracts in the codebase

It does not yet mean a complete user journey.

## What Belongs To Which Product

ThreadOS owns:

- authoring the sequence
- executing the work
- rendering the workbench
- storing thread, surface, and run state
- exposing policy and audit controls

Thread Runner is intended to own:

- eligibility and unlock logic
- verified proving environments
- competitive run comparison
- builder ranking and pack progression

## Language To Keep Straight

- A thread is not the same thing as a surface.
- A surface is not the same thing as a run.
- A run belongs to a surface.
- A builder is not the same thing as an agent.
- A pack belongs to the proving layer, not the core ThreadOS workbench.
- Thread Runner is not the main app today.

That vocabulary split matters because the repo already contains parts of the future proving model, but the currently shipped product is the ThreadOS workbench.
