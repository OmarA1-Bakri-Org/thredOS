# Surface / Panel Audit

Date: 2026-03-25

## Checked

- sample naming on the default local sequence
- canvas step-node click path
- canvas agent card and node card visibility
- surface-to-panel deep linking
- agent registration and assignment path
- skill framework placeholder content
- local-first launch boundary in visible docs/examples

## Fixed

- renamed the visible sample sequence labels from `orch orchestrator` / `orch worker` to `orchestrator` / `worker`
- restored the old on-surface agent card while keeping the latest node companion card and latest surface
- added shared panel-navigation state so the canvas cards can open the correct side-panel views
- moved the current agent-loadout draft into shared UI state so the node panel and agent panel stop drifting
- added on-surface agent-card actions for open, implement, register, and assign/reassign
- replaced placeholder skill docs with real thredOS examples and safety boundaries
- added `AGENTS.md` as the canonical guide for agent identity and registration rules

## Deferred

- clamping the old above-node agent card to viewport bounds when the selected node is very high on the canvas
- any deeper ID migration away from `orch-*` internal sample IDs

## Validation Targets

- clicking a step node shows both cards
- clicking the agent card routes into the agent panel
- clicking the node card routes into the node panel
- registering from the surface card creates and assigns a canonical agent
- build and UI validation remain green
