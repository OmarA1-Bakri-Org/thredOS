# Apollo Segment Builder — thredOS Pack

## Purpose

This is the first serious thredOS-native workflow pack migrated from the legacy Claude Code Automations workflow JSON format.

Canonical pack path:
- `.threados/packs/apollo-segment-builder/1.0.0/pack.yaml`

Supporting assets:
- prompts: `.threados/prompts/*.md`
- shared references: `shared_references/*.md`

## What this pack now encodes

- prerequisites
- shared references
- phase order
- step graph / dependencies
- rate limits
- timeouts
- gate definitions
- step execution mode
- step conditions
- step action contracts
- compiled sequence gates
- inferred side-effect class

## What the runtime now understands

- `run runnable` respects compiled gate dependencies via approved gate IDs
- `run runnable` evaluates simple compiled conditions from `.threados/state/runtime-context.json`
- `run step` and `run runnable` inject a structured `THREADOS ACTION CONTRACT` block into dispatched prompts when actions exist

## Current limitations

The Apollo pack is structurally finished, but runtime execution is still only partially native.

Not fully native yet:
- `composio_tool` actions are represented but not executed as first-class runtime operations
- `approval` actions are represented but not driven by a dedicated pack-action engine
- `conditional` actions are represented but only step-level conditions are runtime-aware today
- gate `acceptance_conditions` are compiled into the sequence, but there is not yet a full automatic gate-evaluation engine consuming them

## Why this matters

This pack is the reference implementation for how legacy workflow documents should be translated into thredOS.

The important lesson is:
- the workflow document must carry enough structured information that thredOS can compile and eventually execute it without relying on hidden operator knowledge

That means every serious workflow should provide:
- clear prerequisites
- explicit references
- explicit step graph
- explicit actions
- explicit gates
- explicit budgets and timeouts
- conditions for branching / selection

## Validation status

Validated in this worktree with:
- pack loader tests
- compiler tests
- install tests
- Apollo-specific pack integration test
- runtime command tests for condition handling and action-contract prompt injection
