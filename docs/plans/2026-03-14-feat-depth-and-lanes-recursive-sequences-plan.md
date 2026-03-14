---
title: "Depth & Lanes — Recursive Sequences + Nested Execution"
type: feat
status: active
date: 2026-03-14
origin: docs/brainstorms/2026-03-14-depth-and-lanes-brainstorm.md
---

# Depth & Lanes — Recursive Sequences + Nested Execution

## Overview

Extend ThreadOS with recursive depth — an agent running inside a phase can spawn a child sequence (with its own phases, nodes, agents, gates), and that child is fully navigable through the same UI patterns. Combined with nested lanes that show child execution inline within parent lanes, and merge convergence that brings runs back together.

This is the architectural expansion from a flat sequence model to a recursive one, touching the data model, runtime, UI store, canvas, lanes, left rail, and hierarchy layers.

## Problem Statement

Today's model is flat: Sequence → Phases → (Node + Agent + Gate), one level deep. Agents cannot spawn subordinate work. There is no way to represent an orchestrator delegating to specialist agents, each running their own sequence of phases.

The infrastructure is 80% there (ThreadSurface tree, spawn runtime, merge events, runtime delegation JSONL) but the remaining 20% — child sequences as full sequences, portal navigation, nested lanes, and left rail re-scoping — blocks the entire recursive execution model.

## Proposed Solution

Seven implementation phases, each independently testable and committable:

1. **Data Model Foundation** — Schema extensions + depth-scoped projections
2. **UI Store + Navigation** — Zustand navigation stack, collapse state, path computation
3. **Canvas Portal Navigation** — Motion animations, path bar, context dimming, depth-scoped rendering
4. **Nested Lanes** — Indented child lanes, connector lines, collapse/expand, summary rollup
5. **Left Rail Re-scoping** — AccordionPanel depth awareness, path bar integration
6. **Merge & Convergence UI** — Gate diamonds in lanes, merge arrows, block merge visualization
7. **Hardening** — Error states, loading states, policy limits, design review fixes

## Technical Approach

### Architecture

The recursive model extends three existing layers:

**Data layer**: `ThreadSurface` gains a `sequenceRef` pointing to a child's sequence data. Each child surface maps to its own sequence file at `.threados/sequences/<surfaceId>/sequence.yaml`. `GateSchema` gains `cascade: boolean`. `RunScope` gains `parentRunId` + `childIndex` for hierarchical run addressing. `PolicySchema` gains depth/spawn limits.

**State layer**: Zustand store gains a `navigationStack: NavFrame[]` with push/pop/jump actions, a `direction` field for animation, and `expandedChildSurfaceIds: Set<string>` for lane collapse state. The path bar is computed from the stack.

**UI layer**: The canvas wraps in a `PortalTransition` component (Motion `AnimatePresence` with directional slides). The lane board extends with nested rows, CSS connector lines, and a 2-level inline cap. The left rail re-scopes all 6 sections based on `currentDepthSurfaceId`.

### Implementation Phases

---

#### Phase 1: Data Model Foundation

**Goal**: All schema and projection extensions, no UI changes. Fully testable with Bun test runner.

**Tasks and deliverables**:

- [ ] **1.1 Extend `ThreadSurface` type** (`lib/thread-surfaces/types.ts`)
  - Add `sequenceRef: string | null` — path to child sequence YAML (e.g., `.threados/sequences/<surfaceId>/sequence.yaml`)
  - Add `spawnedByAgentId: string | null` — tracks which agent spawned this child (distinct from `registeredAgentId` which is the executing agent)

- [ ] **1.2 Extend `GateSchema`** (`lib/sequence/schema.ts`)
  - Add `cascade: z.boolean().default(false)` — when true, child gate failure propagates to parent
  - Add `childGateIds: z.array(z.string()).default([])` — optional explicit binding to child gates

- [ ] **1.3 Extend `RunScope` type** (`lib/thread-surfaces/types.ts`)
  - Add `parentRunId: string | null` — links to parent run (null for root runs)
  - Add `childIndex: number | null` — position among siblings
  - Keep `id` as UUID primary key — the scoped ID `parentRunId:childIndex` is a computed property, not the PK (see brainstorm: docs/brainstorms/2026-03-14-depth-and-lanes-brainstorm.md, decision #11)

- [ ] **1.4 Extend `PolicySchema`** (`lib/sequence/schema.ts`)
  - Add `max_spawn_depth: z.number().default(10)` — hard limit on recursive depth
  - Add `max_children_per_surface: z.number().default(20)` — max child surfaces per parent
  - Add `max_total_surfaces: z.number().default(200)` — global surface cap

- [ ] **1.5 Add depth-scoped projections** (`lib/thread-surfaces/projections.ts`)
  - `projectChildrenOf(threadSurfaces, parentSurfaceId)` — returns only direct children of a surface
  - `projectAncestryPath(threadSurfaces, surfaceId)` — returns root → ... → surfaceId path for path bar
  - `projectDepthScopedLaneBoard(threadSurfaces, runs, mergeEvents, parentSurfaceId)` — lane board filtered to a specific parent's children

- [ ] **1.6 Extend `createChildThreadSurfaceRun`** (`lib/thread-surfaces/mutations.ts`)
  - Accept `sequenceRef` parameter and write to child surface
  - Accept `parentRunId` + `childIndex` and write to child run
  - Enforce policy limits (`max_spawn_depth`, `max_children_per_surface`, `max_total_surfaces`)
  - Throw `SpawnDepthExceededError` or `SpawnLimitExceededError` (add to `lib/errors.ts`)

- [ ] **1.7 Add child sequence provisioning** (`lib/thread-surfaces/step-run-runtime.ts`)
  - When `persistRuntimeDelegationEvents()` processes a `spawn-child` event, also provision a `.threados/sequences/<surfaceId>/sequence.yaml` with the child's initial sequence definition
  - The sequence definition is either provided in the spawn event payload or generated from a template based on thread type

- [ ] **1.8 Write tests for all extensions**
  - Depth-scoped projections: ancestry path, children-of, depth-scoped lane board
  - Mutation limits: spawn depth exceeded, children limit exceeded, total surface limit
  - Gate cascade schema validation
  - Run ancestry: parentRunId + childIndex propagation

**Success criteria**: All new types compile, all projections return correct data, all mutations enforce limits, all tests pass.

**Estimated files**: 4 modified + 1 new test file

---

#### Phase 2: UI Store + Navigation

**Goal**: Zustand store extensions for depth navigation and lane collapse state. No rendering changes.

**Tasks and deliverables**:

- [ ] **2.1 Add navigation stack to store** (`lib/ui/store.ts`)
  ```typescript
  interface NavFrame {
    threadSurfaceId: string
    surfaceLabel: string
    depth: number
  }

  // New state
  navigationStack: NavFrame[]     // [root, ...ancestors, current]
  portalDirection: 'forward' | 'back' | null

  // New actions
  pushDepth: (frame: NavFrame) => void     // drill into child
  popDepth: () => void                      // back one level
  jumpToDepth: (index: number) => void      // path bar click
  resetNavigation: (root: NavFrame) => void // initialize
  ```

- [ ] **2.2 Derive `currentDepthSurfaceId` as computed** (`lib/ui/store.ts`)
  - `currentDepthSurfaceId` = last element of `navigationStack`'s `threadSurfaceId`
  - `currentDepthLevel` = last element's `depth`
  - `pathSegments` = `navigationStack.map(f => ({ id: f.threadSurfaceId, label: f.surfaceLabel, depth: f.depth }))`

- [ ] **2.3 Add lane collapse state** (`lib/ui/store.ts`)
  ```typescript
  expandedChildSurfaceIds: Set<string>  // which child lanes are manually expanded
  toggleChildSurfaceExpanded: (surfaceId: string) => void
  collapseAllChildSurfaces: () => void
  ```
  Auto-expand logic: running or failed children are expanded by default. Completed children are collapsed by default (see brainstorm: decision #13).

- [ ] **2.4 Integrate navigation with existing view actions**
  - `openLaneViewForThreadSurface()` should also push a nav frame if switching depth
  - `selectPhaseAndFocus()` should respect current depth
  - When `selectedThreadSurfaceId` changes, sync with `navigationStack` if the new surface is at a different depth

- [ ] **2.5 Write tests for navigation stack** (`lib/ui/store.test.ts`)
  - Push/pop/jump operations
  - Direction tracking (forward on push, back on pop/jump)
  - Reset behavior
  - Integration with existing view mode switching
  - Collapse state: toggle, auto-expand rules

**Success criteria**: Store compiles, all navigation operations work correctly, direction is tracked, existing tests still pass.

**Estimated files**: 1 modified + 1 test file extended

---

#### Phase 3: Canvas Portal Navigation

**Goal**: Animated depth navigation on the canvas with path bar and context dimming.

**Tasks and deliverables**:

- [ ] **3.1 Install Motion** (`package.json`)
  - `bun add motion`
  - Use `LazyMotion` with `domAnimation` features for tree-shaking (~17kb instead of ~33kb)
  - Import from `"motion/react"` and `"motion/react-m"`

- [ ] **3.2 Create `PortalTransition` wrapper** (`components/canvas/PortalTransition.tsx`)
  - Wraps the canvas content in `AnimatePresence` with directional slide variants
  - `custom={portalDirection}` on BOTH `AnimatePresence` AND `motion.div` (gotcha: without this on AnimatePresence, exit animation uses stale direction)
  - Slide-right = deeper (forward), slide-left = shallower (back)
  - Duration: 250ms enter, 200ms exit, ease: `[0.32, 0.72, 0, 1]`
  - `mode="sync"` for simultaneous enter/exit
  - `will-change: transform` only on actively-animating elements

- [ ] **3.3 Create `ContextDimOverlay` component** (`components/canvas/ContextDimOverlay.tsx`)
  - `motion.div` with opacity 0 → 0.5 when depth > 0
  - `pointer-events-none`, `absolute inset-0`, `bg-black`
  - Fades in when drilling deeper, fades out when returning to root

- [ ] **3.4 Create `PathBar` component** (`components/navigation/PathBar.tsx`)
  - Reads `pathSegments` from store via `useShallow` selector
  - Renders clickable segments with chevron separators
  - Collapse strategy: depth ≤ 4 shows full path; depth > 4 shows first + "..." dropdown + last 2 segments
  - Each segment is a `<button>` with `onClick={() => jumpToDepth(index)}`
  - `max-w-[120px] truncate` per segment with tooltip on hover
  - Keyboard: Escape pops one level (not return to root — see brainstorm: Houdini "U to go up" pattern)
  - Mounts in both canvas top bar AND left rail header

- [ ] **3.5 Add "has children" indicator to `StepNode`** (`components/canvas/StepNode.tsx`)
  - Pass `childCount` through node data from `useSequenceGraph`
  - When `childCount > 0`, show a small depth badge (nested squares icon + count) at bottom-right of node
  - Double-click handler: if node has children, call `pushDepth()` with child surface info

- [ ] **3.6 Depth-scoped canvas rendering** (`components/canvas/SequenceCanvas.tsx`)
  - When `currentDepthSurfaceId` is not root, load the child's sequence status
  - Create a `useDepthScopedStatus()` hook that reads from `.threados/sequences/<surfaceId>/sequence.yaml`
  - Pass depth-scoped status to `useSequenceGraph()` instead of root status
  - Wrap `SequenceFlowGraph` in `PortalTransition` keyed by `currentDepthSurfaceId`

- [ ] **3.7 Keyboard navigation** (`components/canvas/SequenceCanvas.tsx`)
  - `Escape` → `popDepth()` (one level back, not root)
  - `Home` → `jumpToDepth(0)` (return to root)
  - Only active when canvas has focus

- [ ] **3.8 Write tests**
  - PortalTransition: renders children, applies direction variants
  - PathBar: renders segments, handles click-to-jump, handles overflow
  - StepNode: shows children indicator when childCount > 0
  - Keyboard: Escape pops, Home jumps to root

**Success criteria**: Double-clicking a node with children triggers slide-right animation into child canvas. Escape returns with slide-left. Path bar shows and navigates depth. Context dims at depth > 0.

**New dependencies**: `motion`

**Estimated files**: 4 new + 3 modified

---

#### Phase 4: Nested Lanes

**Goal**: Child execution shown inline within parent lanes, with connector lines and collapse/expand.

**Tasks and deliverables**:

- [ ] **4.1 Extend `LaneBoardRow` with depth info** (`components/lanes/useLaneBoard.ts`)
  - Add `parentRowId: string | null`, `depth: number`, `childCount: number` to `LaneBoardRow`
  - Build tree structure: parent rows contain child rows
  - Flatten tree respecting collapse state from store
  - Enforce 2-level inline limit: rows at depth > 2 relative to current view are not shown inline

- [ ] **4.2 Nested lane roster rendering** (`components/lanes/LaneBoardView.tsx`)
  - Indented child rows with `padding-left: ${depth * 20}px`
  - CSS connector lines using `border-left` + `::before` pseudo-elements (NOT whitespace-only — Zipkin's documented failure)
  - Last-child uses `└─` connector, others use `├─`
  - Disclosure triangle (▶/▼) toggle on parent rows

- [ ] **4.3 Collapse/expand behavior**
  - Collapsed-by-default for completed/successful children (brainstorm decision #13)
  - Auto-expand running or failed children
  - Manual toggle via disclosure triangle
  - State stored in `expandedChildSurfaceIds` from Phase 2

- [ ] **4.4 Summary rollup bar for collapsed parents**
  - When collapsed, show single bar spanning children's time range
  - Stacked progress segments: green (completed) + blue (running) + red (failed)
  - Status badge (overall status) + child count pill (e.g., "5 phases")
  - Duration shown as relative time (e.g., "15m 22s"), wall-clock on hover

- [ ] **4.5 Numbered pills for high-cardinality children**
  - When > 4 children at same depth, show first 3-4 + "+N more" pill
  - Clicking "+N more" expands to show all
  - Color by agent/role, not depth (brainstorm decision #15)

- [ ] **4.6 Portal trigger at 2-level limit**
  - When inline nesting hits 2 levels, show "View full sequence →" button on the deepest child
  - Clicking triggers `pushDepth()` and switches to hierarchy view mode for that child
  - Same slide-right animation as canvas portal

- [ ] **4.7 Write tests**
  - Nested row building: parent/child relationships, depth enforcement
  - Collapse state: auto-expand rules, manual toggle
  - 2-level cap: rows beyond cap hidden, portal trigger shown
  - Connector lines: CSS classes applied correctly per depth

**Success criteria**: Lane view shows indented child lanes with tree connectors. Collapsed parents show rollup. Running/failed children auto-expand. 2-level cap enforced.

**Estimated files**: 2 modified + 1 new test file

---

#### Phase 5: Left Rail Re-scoping

**Goal**: AccordionPanel sections show data for the current depth level, not always root.

**Tasks and deliverables**:

- [ ] **5.1 Mount `PathBar` in AccordionPanel header** (`components/workbench/AccordionPanel.tsx`)
  - Place between tab buttons and section content
  - Only visible when depth > 0
  - Same PathBar component from Phase 3

- [ ] **5.2 Scope `SequenceSection` to current depth** (`components/workbench/sections/SequenceSection.tsx`)
  - When `currentDepthSurfaceId` is set, filter thread surfaces to show only children of that surface
  - Thread type picker shows the child sequence's type
  - Phase overview shows the child sequence's phases

- [ ] **5.3 Create `useDepthScopedStatus` hook** (`lib/ui/hooks/useDepthScopedStatus.ts`)
  - Reads sequence status from the depth-appropriate sequence file
  - Returns the same shape as `useStatus()` but scoped to the current depth
  - Falls back to root status when at depth 0

- [ ] **5.4 Scope all 6 sections** (`components/workbench/sections/*.tsx`)
  - Each section receives depth-scoped status via `useDepthScopedStatus()`
  - PHASE, NODE, AGENT, GATE sections show data from the current depth's sequence
  - RUN section shows runs for the current depth's thread surface

- [ ] **5.5 Write tests**
  - PathBar visibility: hidden at depth 0, visible at depth > 0
  - Section scoping: sections render child sequence data when drilled in
  - Depth change triggers section re-render

**Success criteria**: Drilling into a child sequence causes all 6 left rail sections to show that child's data. Path bar visible in header when depth > 0.

**Estimated files**: 2 modified + 1 new hook file

---

#### Phase 6: Merge & Convergence UI

**Goal**: Visual convergence in the lane view — gate diamonds, merge arrows, terminal state styling.

**Tasks and deliverables**:

- [ ] **6.1 Gate diamonds in lane view** (`components/lanes/LaneBoardView.tsx`)
  - Render gate convergence points as diamond shapes (CSS `rotate-45` on a square, matching `GateNode` canvas pattern)
  - Position at the point where child lanes converge
  - Show gate ID and status inside the diamond

- [ ] **6.2 Merge connector lines**
  - SVG or CSS lines from child sub-lanes to the gate diamond
  - Single merge: one line from source to destination
  - Block merge: multiple lines converging to one point
  - Merged source lanes get distinct styling: muted opacity, "merged" label, green dot

- [ ] **6.3 Block merge visualization**
  - When multiple child lanes merge into a synthesis node, show visual grouping
  - Bracket or funnel visual connecting source lanes to the synthesis point
  - Count badge: "3 → 1 merge"

- [ ] **6.4 Terminal state styling for merged lanes**
  - Merged lanes show `mergedIntoThreadSurfaceId` as a link
  - Muted/faded appearance (opacity 0.5)
  - "Merged into [label]" text

- [ ] **6.5 Write tests**
  - Diamond rendering at convergence points
  - Merge line drawing for single and block merges
  - Terminal state styling

**Success criteria**: Gate diamonds appear where child work converges. Connector lines show merge relationships. Merged lanes are visually distinct.

**Estimated files**: 2 modified + 1 new test file

---

#### Phase 7: Hardening

**Goal**: Error handling, loading states, design review fixes, policy enforcement.

**Tasks and deliverables**:

- [ ] **7.1 Portal navigation error handling**
  - If child sequence fails to load: show error state inside the portal with "Return to parent" button
  - If child surface doesn't exist: show toast and stay on current level
  - Loading state: skeleton canvas during sequence load

- [ ] **7.2 Loading states during depth transitions**
  - Show loading spinner inside the portal transition while child sequence loads
  - Path bar shows the target segment with a loading indicator

- [ ] **7.3 Cross-depth spawn notifications**
  - When a spawn event occurs at a different depth than the user is viewing: subtle badge on the relevant path bar segment
  - Badge shows count of new children spawned since last visit to that depth

- [ ] **7.4 Fix N-M1: ThreadFlowPlane edge rendering** (`components/hierarchy/ThreadFlowPlane.tsx`)
  - Actually render SVG path connectors between parent and child nodes using the `edges` prop
  - Curved bezier paths matching the canvas edge style

- [ ] **7.5 Fix N-m5: Dynamic layer labels** (`components/hierarchy/ThreadFlowPlane.tsx`)
  - Replace hardcoded `layerLabels` (Champion/Frontline/Mini) with dynamic labels
  - Accept optional `layerLabels` prop; default to depth-numbered labels: "Level 0", "Level 1", etc.
  - Or derive from ThreadSurface metadata (role, surfaceLabel)

- [ ] **7.6 Spawn rate limiting** (`lib/thread-surfaces/mutations.ts`)
  - Enforce `max_spawn_depth` from policy before creating child surfaces
  - Enforce `max_children_per_surface` before creating additional children
  - Enforce `max_total_surfaces` global cap
  - Emit soft warning at 80% of any limit (via RunEvent)
  - Hard-block at 100% with `SpawnLimitExceededError`

- [ ] **7.7 Gate cascade propagation** (`lib/thread-surfaces/mutations.ts`)
  - When a child gate status changes and parent gate has `cascade=true`:
    - Emit `gate-cascade` RunEvent
    - Update parent gate status to reflect aggregated child status
    - If child gate fails and cascade is on, parent gate status becomes `blocked`

- [ ] **7.8 Empty states**
  - N-S2: Lane board empty state ("No lanes yet — run a sequence to see execution lanes")
  - Portal target empty state (child sequence has no phases yet)

- [ ] **7.9 Write tests**
  - Error recovery: portal navigation with missing child
  - Spawn limits: depth exceeded, children exceeded, total exceeded
  - Gate cascade: single-level propagation, multi-level chain
  - Empty states render correctly

**Success criteria**: All error states handled gracefully. Policy limits enforced. Design review issues fixed. All tests pass.

**Estimated files**: 4 modified + 2 test files

---

## Alternative Approaches Considered

**1. Single sequence file with nested structure** — Instead of per-child sequence files, store child sequences as nested objects inside the parent `sequence.yaml`. Rejected because: (a) large sequences become unwieldy, (b) atomic writes to deeply nested structures are error-prone, (c) ThreadOS's "file-first truth" design principle favors discrete files per entity.

**2. React ViewTransition API** — Instead of Motion for portal animations. Rejected because: (a) still unstable in React 19 stable, (b) lacks Firefox cross-document support, (c) Motion's `AnimatePresence` + directional `custom` prop is purpose-built for this exact use case.

**3. Dagre for nested layout** — Instead of ELK. Rejected because: dagre does NOT support compound/nested graphs. ELK with `elk.hierarchyHandling: "INCLUDE_CHILDREN"` handles parent-child groups in a single layout pass. ELK is already installed.

**4. URL-based depth routing (Next.js params)** — Encode depth in the URL: `/canvas/[surfaceId]`. Rejected because: (a) depth navigation is a local UI state concern, not a route concern, (b) URL changes would cause full page re-renders defeating the animation purpose, (c) Zustand navigation stack is simpler and more performant.

**5. Breadcrumb trail instead of path bar** — Traditional multi-line breadcrumb. Rejected per brainstorm research: breadcrumb trails sprawl at depth, don't fit in one line, and waste vertical space. The Blender/Houdini compact path bar with overflow dropdown is the proven pattern (see brainstorm: docs/brainstorms/2026-03-14-depth-and-lanes-brainstorm.md, decision #3).

## System-Wide Impact

### Interaction Graph

- Portal navigation triggers: `pushDepth()` → store update → `PortalTransition` re-key → `AnimatePresence` exit/enter → `useDepthScopedStatus()` fetch → `useSequenceGraph()` re-layout → AccordionPanel re-scope
- Spawn event triggers: runtime JSONL → `persistRuntimeDelegationEvents()` → `createChildThreadSurfaceRun()` → policy limit check → child surface created → child sequence file provisioned → API cache invalidation → UI re-fetch
- Gate cascade triggers: child gate status change → `cascade` check → parent gate mutation → `gate-cascade` RunEvent → parent lane status update

### Error Propagation

- Child sequence load failure: `useDepthScopedStatus()` returns error → `PortalTransition` renders error state → user clicks "Return to parent" → `popDepth()` → slide-left animation back
- Spawn limit exceeded: `createChildThreadSurfaceRun()` throws `SpawnLimitExceededError` → runtime event log records failure → agent receives error in stdout → UI shows error badge on parent node
- Gate cascade failure: child gate → parent gate `blocked` status → lane board row status update → auto-expand if collapsed

### State Lifecycle Risks

- **Orphaned child surfaces**: If parent sequence is deleted while children exist, child surfaces become orphaned. Mitigation: `deleteSequence()` should recursively clean up child surfaces and their sequence files.
- **Stale navigation stack**: If a child surface is deleted while the user is viewing it, the navigation stack becomes invalid. Mitigation: navigation stack entries should validate surface existence on each render; invalid entries trigger `popDepth()`.
- **Concurrent depth edits**: User modifies parent sequence while child is executing. No conflict — parent and child have separate sequence files. Merge events are append-only and idempotent.

### API Surface Parity

- All depth-scoped projections must be available via API routes (not just in-memory projections)
- New routes needed: `GET /api/sequence/:surfaceId` for depth-scoped sequence status
- Existing routes unaffected: `/api/thread-surfaces`, `/api/thread-runs`, `/api/thread-merges` already return all surfaces regardless of depth

### Integration Test Scenarios

1. **Full spawn-navigate-merge cycle**: Root agent spawns child → user drills into child via portal → child sequence executes → child merges back into parent → user navigates back → parent lane shows merged result
2. **2-level inline lanes then portal**: Parent spawns child, child spawns grandchild → lane view shows 2-level inline nesting → user clicks "View full sequence" on grandchild → portal navigation into grandchild canvas
3. **Gate cascade chain**: Grandchild gate fails → cascade propagates to child gate → cascade propagates to parent gate → user at parent level sees gate blocked with cascade indicator
4. **Spawn limit enforcement**: Agent tries to spawn beyond `max_children_per_surface` → spawn rejected → error recorded → user sees limit badge
5. **Cross-depth search**: User at depth 0 uses search → finds a node at depth 2 → clicking result triggers portal navigation directly to depth 2

## Acceptance Criteria

### Functional Requirements

- [ ] Agents can spawn child sequences during execution via JSONL events
- [ ] Child sequences support all 6 thread types (base/p/c/f/b/l)
- [ ] Double-clicking a node with children triggers portal navigation with slide animation
- [ ] Escape returns one level, Home returns to root
- [ ] Path bar shows compact clickable depth path in canvas top bar and left rail header
- [ ] Parent context dims when viewing child (not disappears)
- [ ] Left rail 6 sections re-scope to show current depth's data
- [ ] Lane view shows nested child lanes with connector lines (├─, └─)
- [ ] Maximum 2 levels of inline lane nesting; deeper triggers portal
- [ ] Completed children collapsed by default, running/failed auto-expand
- [ ] Collapsed parent shows summary rollup bar with time range + status + child count
- [ ] High-cardinality children show "+N more" pill
- [ ] Color by agent/role, not by depth
- [ ] Gate diamonds at convergence points in lane view
- [ ] Single and block merge visualization with connector lines
- [ ] Merged lanes show terminal state styling
- [ ] Gate cascade propagation configurable per gate
- [ ] Scoped sub-run IDs: `parentRunId` + `childIndex` on child runs
- [ ] User defines spawn capability (not autonomous agent decision)

### Non-Functional Requirements

- [ ] Portal animation: ≤250ms enter, ≤200ms exit
- [ ] Lane board renders smoothly with 50+ inline rows (virtualize if needed)
- [ ] Motion bundle impact: ≤17kb (using LazyMotion + domAnimation)
- [ ] No layout shift during portal transitions
- [ ] Spawn policy limits enforced in SAFE and POWER modes

### Quality Gates

- [ ] All existing tests pass (regression)
- [ ] New unit tests for all projections, mutations, and store actions
- [ ] Integration test for full spawn-navigate-merge cycle
- [ ] Visual verification of portal animation, context dimming, path bar
- [ ] Visual verification of nested lane connector lines and collapse/expand
- [ ] `bun run check` passes after each phase

## Success Metrics

- Portal navigation latency: < 300ms from double-click to child canvas rendered
- Lane nesting: correctly represents 3+ depth levels with 2-level inline cap
- Gate cascade: correctly propagates across 3 depth levels
- Zero regression in existing test suite

## Dependencies & Prerequisites

### Existing Branch Code (All Production-Ready)

| Branch | What It Provides | Status |
|--------|-----------------|--------|
| `feat/thread-surface-lifecycle` | Mutations, repository, API routes (1,311 LOC) | Ready to merge |
| `feat/thread-surface-runtime-merge` | Merge derivation logic (231 LOC) | Ready to merge |
| `feat/thread-surface-runtime-child` | Step-to-surface mapping (256 LOC) | Ready to merge |
| `coord/thread-surface-subagent-spawns` | Runtime event persistence (243 LOC) | Ready to merge |
| `feat/threados-lanes-inspector` | Lane board + inspector UI (1,010 LOC) | Ready to merge |
| `feat/reviewfix-runtime-core` | Error classes, CLI lifecycle (483 LOC) | Ready to merge |
| `feat/thread-surface-runtime-ui` | Fixture data + integration test (381 LOC) | Ready to merge |
| `feat/thread-surface-ui-data` | UI data hooks + scaffolding (588 LOC) | Ready to merge |

**Recommended merge order before starting Phase 1**:
1. `feat/thread-surface-runtime-merge` + `feat/thread-surface-runtime-child` (foundation)
2. `feat/thread-surface-lifecycle` (lifecycle layer)
3. `feat/reviewfix-runtime-core` (polish)
4. `feat/thread-surface-ui-data` + `feat/thread-surface-runtime-ui` (UI data)
5. `feat/threados-lanes-inspector` (UI components)
6. `coord/thread-surface-subagent-spawns` (spawn integration)

### New Dependencies

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `motion` | 11.x | Portal animations, context dimming | ~17kb (LazyMotion) |
| `@tanstack/react-virtual` | 3.x | Lane row virtualization (if needed) | ~10-15kb |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Branch merge conflicts (8 branches diverged from main) | High | Medium | Merge in dependency order; resolve conflicts per-branch before starting new work |
| Portal animation performance on large canvases | Medium | Medium | Use `will-change` sparingly; profile with React DevTools; fall back to instant transition if FPS < 30 |
| Child sequence file I/O overhead | Low | Medium | Lazy-load child sequences only when navigated to; cache in memory |
| Zustand navigation stack memory with deep recursion | Low | Low | Navigation stack is tiny (one NavFrame per depth level, each ~100 bytes) |
| ELK layout time for large child sequences | Medium | Medium | Cache layout results per sequence hash; show skeleton during initial layout |
| CSS connector line rendering at scale (50+ nested rows) | Medium | Medium | Virtualize with `@tanstack/react-virtual`; connector lines drawn via absolute-positioned overlay, not per-row pseudo-elements |

## Future Considerations

- **Max depth guard UX**: Soft warning dialog at depth N (brainstorm open question #1). For now, hard limit in PolicySchema is sufficient. UI warning can be added later.
- **Hierarchy view scoping**: (brainstorm open question #2). For now, hierarchy view shows the full tree. Scoping to current drill-in level can be added in a follow-up.
- **Agent color palette management**: Auto-assign from 12-color palette based on `registeredAgentId` hash. Customization can be added later.
- **Cross-depth search**: User searches at depth 0, finds node at depth 3. For now, show result with depth indicator. Direct navigation to search result's depth is Phase 3+ territory.
- **Undo/redo navigation**: `zundo` middleware for Zustand (~700 bytes) can add undo/redo to the navigation stack. Not required for MVP.
- **Env var propagation to child sequences**: Child sequences may need different env vars. For now, child inherits parent's env. Scoped env overrides can be added later.

## Documentation Plan

- Update `CLAUDE.md` project structure section with new files
- Update `docs/thread-types.md` to document recursive capability
- Add `docs/depth-navigation.md` explaining portal navigation for users
- Update API docs for new `/api/sequence/:surfaceId` route

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-14-depth-and-lanes-brainstorm.md](docs/brainstorms/2026-03-14-depth-and-lanes-brainstorm.md) — 15 key decisions carried forward:
  1. Phase = Node + Agent + Gate at every depth
  2. Full type system at every depth
  3. Portal + path bar + context dimming (not breadcrumbs)
  4. Left rail scoped to current level
  5. Nested lanes with 2-level inline limit
  6. Gates as diamond milestones
  7. ThreadSurface as the bridge
  8. Color by role, not depth
  9. Collapsed-by-default for completed children
  10. User defines spawn capability
  11. Scoped sub-run IDs (parentRunId + childIndex)
  12. Configurable gate cascade
  13. No artificial depth limit
  14. Numbered pills for parallel agents
  15. Connector lines required (not whitespace)

### Internal References

- Data model: [`lib/thread-surfaces/types.ts`](lib/thread-surfaces/types.ts)
- Projections: [`lib/thread-surfaces/projections.ts`](lib/thread-surfaces/projections.ts)
- Mutations: [`lib/thread-surfaces/mutations.ts`](lib/thread-surfaces/mutations.ts) (on `feat/thread-surface-lifecycle` branch)
- Spawn runtime: [`lib/thread-surfaces/spawn-runtime.ts`](lib/thread-surfaces/spawn-runtime.ts)
- UI store: [`lib/ui/store.ts`](lib/ui/store.ts)
- Canvas: [`components/canvas/SequenceCanvas.tsx`](components/canvas/SequenceCanvas.tsx)
- Lane board: [`components/lanes/LaneBoardView.tsx`](components/lanes/LaneBoardView.tsx)
- Accordion: [`components/workbench/AccordionPanel.tsx`](components/workbench/AccordionPanel.tsx)
- Design review: [`.ui-design/reviews/hierarchy-lanes-review_20260311.md`](.ui-design/reviews/hierarchy-lanes-review_20260311.md)

### External References

- Motion library: `motion` (formerly Framer Motion) — `AnimatePresence`, `LazyMotion`
- Direction-aware animations: [sinja.io/blog/direction-aware-animations-in-framer-motion](https://sinja.io/blog/direction-aware-animations-in-framer-motion)
- ELK hierarchical layout: `elk.hierarchyHandling: "INCLUDE_CHILDREN"`
- TanStack Virtual: row virtualization for nested lanes
- CSS tree views: [iamkate.com/code/tree-views/](https://iamkate.com/code/tree-views/)
- Blender node groups (Tab in/out, path gadget)
- Houdini network editor (I/Enter dive, U go up)
- Jaeger/Datadog waterfall (indentation + connector lines + color by service)

### Related Work

- Layout restructure plan: [`docs/plans/2026-03-12-layout-restructure-accordion-inspector.md`](docs/plans/2026-03-12-layout-restructure-accordion-inspector.md)
- Spawn plan: [`docs/plans/2026-03-09-thread-surface-subagent-spawns.md`](docs/plans/2026-03-09-thread-surface-subagent-spawns.md)
- Runtime delegation plan: [`docs/plans/2026-03-09-runtime-delegation-events.md`](docs/plans/2026-03-09-runtime-delegation-events.md)
