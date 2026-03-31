---
id: tools
title: Tools
version: 1
capabilities: [tools]
system: true
---

# Tools

Invoke tool-capable workflows and external integrations.

## Intent

Use this skill when a task requires shell commands, APIs, or external integrations rather than pure reasoning.

## When To Use It

- run builds, tests, or linters
- inspect or mutate the local repo through command-line tools
- call an external integration that is already connected and authorized
- validate runtime behavior that cannot be confirmed statically

## Safe Boundaries

- use the narrowest tool that proves the point
- avoid destructive commands unless explicitly approved
- prefer local tools over cloud custody when the work can stay on the machine

## thredOS Examples

- run a build after wiring the surface cards to the side panel
- call the registration API path and verify a canonical agent is created
- inspect a connected billing integration without uploading workspace files
