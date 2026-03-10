# ThreadOS Production PRD — ThreadOS Core + Thread Runner

> **Version**: 3.0
> **Status**: Product and implementation roadmap
> **Last Updated**: 2026-03-10

---

## 1. Executive Summary

ThreadOS is a local-first agentic engineering system built around registered thread surfaces, run-scoped execution truth, skill inventory, and provenance. It is not just a node canvas. It is a control environment for designing, executing, inspecting, and improving multi-agent engineering workflows.

The product now has two deliberate entry points:

- **ThreadOS**: the core engineering environment for building, orchestrating, and improving thread systems
- **Thread Runner**: a locked advanced proving mode for verified VM-based competitive runs, pack generation, and builder status

ThreadOS remains the primary product. Thread Runner exists to prove and improve agent capability, not to redefine the app as a game.

---

## 2. Current Product Baseline

### 2.1 What Is Real Today

The codebase is no longer at the earlier M0-M2 state described by older roadmap documents. The following foundations now exist or are materially underway:

- Thread-surface domain model: structural `ThreadSurface`, execution `RunScope`, `RunEvent`, and merge history
- Persistent thread-surface repository and APIs
- UI state and prototype hierarchy/lane modeling
- Runtime event contracts for delegated child-surface creation and merge recording
- CLI and API execution paths aligned around runtime event emission and persistence
- Production integration branch work proving green lint, typecheck, test, and build slices
- UI prototype artifacts for the new shell, focused thread card, main thread surface, and wireframes

### 2.2 What Is Still Missing

These are the key remaining production gaps:

- Full production UI implementation of the new shell and boards
- Real VM-backed Thread Runner infrastructure
- Registration, subscription, and eligibility gating for Thread Runner
- Verified competition storage, ranking, and cup flow
- First-class pack/status records and builder profiles
- Complete documentation for the new product split and UI model

### 2.3 Product Positioning

ThreadOS should be presented as:

1. A serious agentic engineering IDE/control surface
2. A provenance-aware runtime for registered agents and threads
3. An improvement system where skills and threads can be measured over time
4. A premium proving layer via Thread Runner for advanced builders

---

## 3. Product Goals

### 3.1 Core Product Goals

1. **Structural clarity**: users can understand parent/child thread structure, run context, and skill inventory quickly
2. **Execution truth**: users can inspect run order, merges, and thread outcomes without ambiguity
3. **Provenance**: all agents are registered through ThreadOS and traceable to builder, parent, run, and pack lineage
4. **Skill visibility**: skills are visible as thread capability and as run-time usage events
5. **Serious usability**: the shell should feel like a premium engineering tool, not a toy canvas
6. **Upgradeable proving layer**: Thread Runner should build on the same runtime truth, not fork into a separate system

### 3.2 UI Upgrade Goals

1. Replace the old horizontal-sequence framing with a stable workbench shell
2. Make `Hierarchy`, `Lanes`, and `Layers` first-class board modes inside ThreadOS
3. Introduce a focused, top-trumps-style thread card as the core comparison object
4. Surface skills, thread power, weight, status, and provenance directly in the UI
5. Preserve one shell across all modes with a persistent inspector and disciplined left rail

### 3.3 Thread Runner Goals

1. Keep Thread Runner locked and explicitly advanced
2. Require registration and paid subscription for entry
3. Run all competitive combatant runs in ThreadOS-managed, pre-configured VMs
4. Use one authoritative time-based race score within a class and division
5. Produce scarce, meaningful status awards and premium pack assets
6. Keep the value and verified evidence inside ThreadOS

---

## 4. Core Product Architecture

### 4.1 Entry Model

The entrance screen exposes exactly two product choices:

- **ThreadOS**
- **Thread Runner** (locked until eligible)

This keeps the product split clean without making Thread Runner the primary identity.

### 4.2 ThreadOS Workbench Shell

Inside ThreadOS, the app should behave like a control-system IDE.

#### Stable shell regions
- **Top bar**: breadcrumbs, active mode, run selector, command/search, options, top-right mode button
- **Left rail**: `Thread Navigator`, `Tools / Activity`, `Skills`
- **Center pane**: active board surface
- **Right rail**: persistent inspector

#### Board modes
- **Hierarchy**: structural truth, zoomable, clickable, focused-card interaction
- **Lanes**: execution truth, structured horizontal lane board, run-scoped ordering and merge visibility
- **Layers**: global map inside the same shell, derived from the same thread/run model
- **Thread Runner**: separate proving mode accessed from the entrance screen or top-right mode control

### 4.3 Data Model

The product model should stay grounded in these first-class objects:

- `ThreadSurface`: structural identity and parent/child relationships
- `RunScope`: one execution attempt for a thread surface
- `RunEvent`: spawn, step, merge, completion, cancellation, failure, skill-use events
- `MergeEvent`: destination run plus source surface/run identities
- `SkillAttachment`: capability available to a thread
- `SkillUsage`: skill actually invoked during a run
- `AgentRegistration`: canonical identity and provenance for each agent
- `Pack`: premium asset assembled from verified build outputs and evidence
- `BuilderProfile`: public/private author identity, highest earned status, pack ownership

### 4.4 Provenance Rule

All new agents must be registered through ThreadOS. No ad hoc or unregistered child agents should be allowed to participate in the hierarchy, run history, scoring, or proving layer.

---

## 5. UI Requirements

### 5.1 Visual Direction

The UI should feel precise, serious, and premium.

#### Required characteristics
- dark graphite shell
- crisp hard-corner containers
- rounded top informational pills only
- restrained accent palette
- strong focus hierarchy
- fast, legible density

#### Typography
- shell/body UI: `IBM Plex Sans`
- focal titles: `Inter` at thin 300 weight
- technical/meta text: `Noto Sans Mono`

#### Color system
- neutral surfaces: graphite / charcoal / slate
- active and verified accent: green
- structural navigation accent: blue
- award accent: amber
- destructive accent: restrained red only

### 5.2 Focused Thread Card

The focused card is the visual center of the hierarchy surface. It is a large rectangular dossier, comparable across threads and shareable as a premium artifact.

#### Card anatomy
1. top pill row
   - division badge
   - classification badge
   - placement badge
   - verification badge
2. identity block
   - thread name
   - pack attribution
   - builder attribution
3. headline scores
   - `Thread Power`
   - `Weight`
4. skill inventory
   - icon-first
   - local vs inherited distinction
5. rubric bars
   - fixed 10-segment comparison bars
6. operational stats
   - children
   - merges
   - alerts
   - run context
7. provenance block
   - registered agent
   - created-by run
   - source / verification context

### 5.3 Hierarchy Board

At rest, the hierarchy board shows compact cards in a structural map. On selection:

- the chosen card centralizes
- the topology dims and blurs slightly
- adjacent cards remain visible as context
- the inspector updates immediately

This interaction is specific to hierarchy mode and should not be reused in lane mode.

### 5.4 Lane Board

The lane board is a structured scrollable execution surface.

#### Rules
- one row per thread lane
- left-to-right sequence
- row order is run-scoped and execution-based
- destination lane remains above merged source lanes
- merged source lanes stay visible as completed rows

### 5.5 Inspector

The inspector remains persistent across all modes. It should show:

- selected thread
- selected run
- notes
- AI discussion
- artifacts
- skill inventory
- skills used in this run
- actions
- provenance

### 5.6 Left Rail

The left rail has three stable sections:

1. **Thread Navigator**
2. **Tools / Activity**
3. **Skills**

This should not collapse into a generic toolbar dump.

---

## 6. Skill and Scoring Requirements

### 6.1 Skill Model

Skills are dual-truth objects:

- **Capability truth**: skills attached to a thread and optionally inherited by child threads
- **Execution truth**: skills actually used during a run

#### Rules
- skills attach at the thread level
- child threads may inherit skills if the parent allows it
- child threads may add more local skills
- inherited skills are not explicitly dropped
- skills are visible on thread cards as icon inventory

### 6.2 Thread Power and Weight

#### Thread Power
- live evolving score
- changes over time based on demonstrated performance, not only static configuration
- should reflect accumulated capability and operational outcomes

#### Weight
- operational burden, not prestige
- influenced by model class, orchestration complexity, tool stack, and runtime burden
- should help compare powerful but expensive builds against leaner builds

### 6.3 Rubric

Thread Power should be supported by visible rubric dimensions, rendered as 10-segment bars on the focused card. Candidate dimensions include:

- tools
- model
- autonomy
- coordination
- reliability
- economy
- specialization
- complexity

The exact rubric formula can evolve, but the card should always explain the score through consistent dimensions.

### 6.4 Skill Value

Skill value should be driven primarily by impact on thread outcomes, not mere frequency. It must be able to reflect contextual affinity, especially:

- model-to-skill pairing quality
- thread-type-to-skill pairing quality
- contribution to successful verified outcomes

This creates the basis for long-term pack value and monetizable skill intelligence inside ThreadOS.

### 6.5 Model Provider And Tracing Requirements

ThreadOS needs a first-class provider layer rather than ad hoc model clients.

#### Required providers
- **OpenAI** via the official `openai` JavaScript SDK
- **OpenRouter** as an alternate provider for model alternatives and routing, wired through the same provider abstraction

#### Required architecture
- one internal provider interface for model invocation
- provider-specific configuration isolated from UI components
- environment-backed provider credentials
- the ability to select provider, model, and fallback policy per thread or run context

#### OpenRouter requirement
- OpenRouter should be integrated through its OpenAI-compatible API path rather than as a separate product architecture
- model alternatives and routing should be available without duplicating the rest of the runtime model

#### Tracing requirement
- ThreadOS provenance and runtime history remain the source of truth
- if the OpenAI Agents SDK is adopted, native tracing may be used as an additional signal for OpenAI-backed runs
- plain `openai` SDK calls and OpenRouter calls should not be assumed to provide equivalent native tracing automatically
- the system must support external or internal tracing for non-Agents-SDK providers without weakening ThreadOS provenance

#### Product rule
- provider integration must strengthen the runtime model, not bypass it
- OpenAI and OpenRouter are execution providers inside ThreadOS, not separate product surfaces

---

## 7. Thread Runner Requirements

### 7.1 Product Positioning

Thread Runner is the advanced proving layer of ThreadOS. It is deliberately hard. It exists to push agent capability and surface winning engineering setups. It is not for novice users.

### 7.2 Access Rules

- visible from the entrance screen and top-right mode control
- locked until registration and paid subscription are satisfied
- local experimentation remains in ThreadOS core
- all combatant runs must execute in ThreadOS-managed VMs

### 7.3 Verified Environment

A combatant run is valid only when executed in a ThreadOS-controlled VM image with a pre-configured environment. This is required for:

- fair timing
- comparable evidence
- anti-cheat integrity
- authoritative ranking
- credible pack generation

### 7.4 Competitive Structure

#### Base format
- 5 or 6 combatants per race
- top 2 qualify
- class and division constraints applied before the run
- one authoritative time-based race score determines ranking within that race

#### Divisions
- `Micro`
- `Mini`
- `Frontline`
- `Champion`

#### Classifications
- `Open Source`
- `Closed Source`
- `Prompting`
- `Economical`
- additional classes may be introduced later

### 7.5 Status And Pack Ladder

#### Class win
- asset: `Challenger Pack`
- reward: `Challenger status`

#### Division win
- asset: `Champion's Pack`
- reward: `Champion status`

#### Open Champion
- asset: `Hero Pack`
- reward: `Hero status`

Rules:
- only highest status is shown on primary builder surfaces
- pack/status records do not artificially decay; prominence decays organically as new winners emerge
- Open Champion is the apex closed invitational tier

### 7.6 Open Champion

Open Champion is a closed invitational. Entry comes from the top competitive field, not from open casual access. It should remain scarce and prestigious.

### 7.7 Pack Economics

The premium value must remain inside ThreadOS.

- packs are native ThreadOS assets
- public visibility can exist as teaser or status surfaces
- full pack value stays gated
- pack contents include structure, skill inventory, model pairing, provenance, and verified evidence

---

## 8. Non-Functional Requirements

### 8.1 Product Discipline
- ThreadOS remains serious and engineering-first
- Thread Runner never takes over the beginner experience
- scoring and status must always be explainable and provenance-backed

### 8.2 Performance
- UI should remain responsive with 100+ nodes/threads visible
- hierarchy focus transitions should feel immediate
- lane board must support dense but readable execution rows

### 8.3 Reliability
- runtime truth must remain consistent across CLI, API, UI, and proving flows
- all scoring and pack outputs must be traceable to registered runs

### 8.4 Security And Trust
- all combatant runs execute in controlled VMs
- all agents are registered
- provenance is inspectable
- status and packs must not be forgeable through local-only runs

---

## 9. Delivery Sequence

### Phase 1: Backend truth completion
- finalize runtime truth and provenance contracts
- complete registered-agent and run identity rules
- stabilize scoring inputs and pack metadata contracts

### Phase 2: ThreadOS UI upgrade
- implement the stable workbench shell
- implement hierarchy, lanes, layers, inspector, and focused thread card
- integrate skills and provenance into the shell

### Phase 3: Thread Runner foundation
- add entrance gating, registration, and eligibility checks
- add VM-backed verified combatant run infrastructure
- add race storage and qualification flows

### Phase 4: Packs and status system
- persist Challenger, Champion, and Hero assets/statuses
- add builder profile and pack ownership views
- keep premium value inside ThreadOS

### Phase 5: Advanced proving layer
- open cups
- invitation logic for Open Champion
- pack showcase and premium access refinement

---

## 10. Non-Goals For This Stage

- turning ThreadOS into a generic marketplace
- exposing pack internals publicly by default
- making Thread Runner the primary first-run experience
- designing for casual participation over serious capability proof
- allowing unregistered agents or unverified combatant runs into the official proving layer
