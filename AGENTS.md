# thredOS Agents

This document defines how thredOS turns prompts, skills, tools, model choice, and role into a canonical registered agent.

## Identity Rules

A canonical agent is the combination of:

- `name`
- `role`
- `model`
- selected prompt
- selected skills
- selected tools

The registration system treats an agent as materially changed when its composition changes in a way that should create a new identity rather than silently mutate history.

Material changes:

- model change
- role change
- adding or removing skills
- adding or removing tools

Non-material changes:

- description copy changes
- performance updates
- reassignment of the same registered agent to different steps or surfaces

## Registration Flow

1. Build or refine the loadout in the node/agent panels.
2. Register from the surface agent card or the panel workflow.
3. thredOS writes the canonical agent locally and requests cloud registration.
4. If the composition materially differs from an existing agent, thredOS mints a replacement agent and preserves lineage through `supersedesAgentId`.
5. The selected step is rebound to the returned canonical agent.

## Skill Framework

Skills live under `.threados/skills/<id>/SKILL.md` and should define:

- intent
- when to use the skill
- safe boundaries
- concrete thredOS examples

Current canonical system skills:

- `search`
- `browser`
- `files`
- `tools`
- `spawn`

## Example Agent Archetypes

### orchestrator

- role: `orchestrator`
- model: `claude-code`
- prompt: orchestration prompt
- skills: `spawn`, `search`, `files`
- tools: shell/build validation, sequence inspection, repo read tools

### researcher

- role: `researcher`
- model: `claude-code`
- prompt: research prompt
- skills: `search`, `browser`, `files`
- tools: search, browser, structured extraction

### builder

- role: `builder`
- model: `claude-code`
- prompt: implementation prompt
- skills: `files`, `tools`
- tools: edit, run, test, diff

### reviewer

- role: `reviewer`
- model: `claude-code`
- prompt: review prompt
- skills: `search`, `browser`, `files`, `tools`
- tools: test, lint, screenshot, inspection

## Example Tool Loadouts

### orchestrator loadout

- sequence inspection
- dependency review
- status/build verification

### researcher loadout

- source search
- browser inspection
- local note capture

### builder loadout

- file editing
- shell execution
- build/test commands

### reviewer loadout

- UI/browser validation
- regression checks
- evidence capture

## Local-First Boundary

Workspace content stays local by default. Cloud state is limited to:

- account and entitlement state
- canonical agent registration

Prompts, skills, files, thread state, and artifacts should remain in the workspace unless the user explicitly chooses a different path.
