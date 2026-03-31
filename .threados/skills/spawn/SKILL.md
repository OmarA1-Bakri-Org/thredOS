---
id: spawn
title: Spawn
version: 1
capabilities: [spawn]
system: true
---

# Spawn

Authorize the agent to create lower-tier child agents and delegated surfaces.

## Intent

Use this skill when the current agent should split work across narrower specialists without losing orchestration control.

## When To Use It

- orchestrator -> researcher for evidence gathering
- orchestrator -> builder for implementation
- orchestrator -> reviewer for validation
- create a child surface one tier lower for scoped execution

## Safe Boundaries

- only spawn when the child has a materially narrower responsibility
- keep child scope, outputs, and stop conditions explicit
- do not spawn recursively without a clear need and ownership boundary

## thredOS Examples

- create a researcher child to collect sources for a feature decision
- create a builder child to patch a specific canvas or panel subsystem
- create a reviewer child to audit interaction regressions before closing the thread
