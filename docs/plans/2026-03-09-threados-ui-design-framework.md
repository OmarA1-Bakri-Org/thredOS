# ThreadOS UI Design Framework

## Purpose
ThreadOS should present itself first as a serious agentic engineering environment and only second as a proving layer. The UI therefore needs to behave like a premium control-system IDE: stable shell, dense but legible surfaces, fast commandability, and clearly separated structural and execution views.

## Product Split
### Entrance
The entrance screen exposes exactly two choices:
- `ThreadOS`
- `Thread Runner` (locked until registration/subscription eligibility)

### Positioning
- `ThreadOS` is the core product
- `Thread Runner` is an advanced proving and improvement mode
- Thread Runner is not the primary identity of the app

## Design Principles
1. Structure before spectacle: the hierarchy board must be understandable in seconds.
2. One shell, multiple operating modes: `Hierarchy`, `Lanes`, `Layers`, and `Thread Runner` should live inside one disciplined workbench.
3. Premium dark materiality: dark graphite surfaces, crisp edges, restrained glow, no cheap cyberpunk effects.
4. Capability is visible: skill inventory belongs on cards, not buried in the inspector.
5. Operational truth stays separate from structural truth: hierarchy is structure; lanes are execution; inspector is interpretation and control.
6. Competition is advanced: `Thread Runner` is locked, deliberate, VM-verified, and clearly for expert builders.
7. Geometry must feel engineered: hard-corner containers everywhere except top informational pills.

## Research References And What To Borrow
### Linear
- Borrow: shell discipline, contextual command flow, dense but controlled workbench framing.
- Avoid: issue-tracker interaction metaphors.

### VS Code
- Borrow: workbench container model, stable sidebars, command palette posture, mode switching in the center pane.
- Avoid: extension-marketplace identity.

### Honeycomb And Grafana
- Borrow: topology focus, isolate/search/filter mechanics, details outside the node, status legibility.
- Avoid: observability-dashboard sprawl.

### n8n
- Borrow: discoverable left-rail and nearby actions.
- Avoid: generic automation-builder styling.

### shadcn/ui
- Borrow: implementation primitives for shell, sidebar, command surfaces, tabs, tables, scroll regions, resizable panels.
- Avoid: default rounded-everything SaaS softness.

### 21st.dev
- Borrow: accelerators for shell primitives, restrained animation ideas, practical composition shortcuts.
- Avoid: landing-page components, hero sections, soft marketing cards.

### Premium Visual Reference
- Borrow only material qualities: deep dark surface, strong focal cards, subtle glow, sharp contrast.
- Do not borrow structure; the reference image is mood, not IA.

## UI Architecture
### Workbench Shell
Inside ThreadOS, the shell remains stable:
- top bar: breadcrumbs, active mode, run selector, command/search, options, top-right mode button
- left rail: `Thread Navigator`, `Tools / Activity`, `Skills`
- center pane: current board
- right rail: persistent inspector

### Boards
#### Hierarchy
- structural home surface
- compact cards at rest
- selected thread card centralizes in a top-trumps-style focus state
- surrounding topology dims/blurs slightly, but remains legible

#### Lanes
- horizontal structured timeline board
- rows ordered by execution meaning, not aesthetic rearrangement
- destination lanes stay above merged source lanes

#### Layers
- separate global system map inside the same shell
- remains clickable, but is not the main operating surface

#### Thread Runner
- advanced proving/improvement mode
- entered from entrance screen or top-right mode control
- kept visually aligned with the same product shell, but clearly gated

## Focused Thread Card Anatomy
The focused card is a large rectangular operational dossier.
- top row: rounded pill badges only
  - division badge
  - class badge
  - placement badge
  - verification badge
- identity block: thread name, builder attribution, pack attribution
- score row: `Thread Power`, `Weight`
- skill inventory: icon-first chips with inherited vs local distinction
- rubric block: fixed 10-segment comparison bars
- stats row: children, merges, alerts, latest run
- provenance row: registered agent identity and run provenance

### Card Behavior
- compact in the map by default
- centralizes on selection
- remains the primary comparison object in hierarchy mode
- stays shareable and legible without opening the inspector

## Skill Model In The UI
- skills are both capability and runtime signal
- on card: icon-first inventory
- in inspector: available skills, local skills, used-in-this-run
- child skill inheritance is optional at the thread level
- skills are assets and can accrue value through impact on outcomes, model affinity, and thread-type affinity

## Status And Pack Model In The UI
- class win -> `Challenger Pack` + `Challenger status`
- division win -> `Champion's Pack` + `Champion status`
- Open Champion -> `Hero Pack` + `Hero status`
- show highest status only on primary builder surfaces
- use pack and status as premium, provenance-backed objects, not decorative badges

## Typography
Recommended implementation stack:
- primary UI sans: `IBM Plex Sans`
- technical / numeric: `Noto Sans Mono`
- large focal titles: `Inter 300`

Reasoning:
- IBM Plex Sans keeps the shell disciplined and readable.
- Noto Sans Mono keeps runtime labels, IDs, stats, and meta text technical without feeling as clichéd as JetBrains Mono.
- Inter at a thin 300 weight gives the focal thread titles authority without becoming ornate.

## Color And Material System
- canvas background: near-black graphite
- raised surfaces: charcoal / slate
- active / verified accents: acid green
- structural navigation accents: blue
- awards / division accents: amber
- destructive states: restrained red only

Reasoning:
- this supports serious engineering tone first, competition layer second
- the green accent can bridge ThreadOS core and Thread Runner without creating arcade visuals
- the card should pop more than the shell, not the other way around

## Geometry Rules
- hard corners for panels, cards, rails, containers, action surfaces, and structural objects
- rounded pills only for top informational tags, badges, and mode chips
- this is a required system rule, not a suggestion

## Interaction Rules
- clicking a hierarchy card centralizes the focused card and updates inspector immediately
- lane rows remain structured, never carousel-like
- command interactions should be reachable globally from the shell
- the inspector never changes purpose across modes
- advanced proving remains accessible, but clearly gated

## What The Prototype Files Should Demonstrate
- a beginning component library for the visual grammar
- one realistic thread surface / plane
- one isolated focused card
- one low-fidelity wireframe for layout communication
- one combined review surface that keeps the outputs visible together
