# Brainstorm: Depth & Lanes — Recursive Sequences + Nested Execution

**Date:** 2026-03-14
**Status:** Complete

---

## What We're Building

Recursive depth for ThreadOS — an agent running inside a phase can spawn a child sequence (with its own phases, nodes, agents, gates), and that child is fully navigable through the same UI patterns. Combined with nested lanes that show child execution inline within parent lanes, and merging that brings runs back together.

### The Core Idea

Today's model: Sequence → Phases → (Node + Agent + Gate). This is flat — one level.

Tomorrow's model: Same structure, but recursive. A phase's agent can spawn a child sequence during execution. That child sequence has its own phases, each with node + agent + gate. A child's agent can spawn grandchildren. No depth limit.

ThreadSurface already has the data model for this (parent/child tree, depth counter, three spawn kinds: orchestrator/watchdog/fanout). What's missing is:
1. Making a child thread surface a full sequence (not just a surface with runs)
2. UI navigation that lets you drill into and out of depth levels
3. Lanes that nest child execution within parent lanes
4. Merging that correctly converges child runs back into parent context

### Why Full Type System

Child sequences can use any of the 6 thread types (base/p/c/f/b/l). Agents will become more capable over time — build for tomorrow's capability, not today's limitations. A spawned child could be a fusion sequence with candidates and synthesis, or a parallel sequence with multiple agents working simultaneously.

---

## Why This Approach

### Portal Navigation with Context Dimming (Not Breadcrumbs)

Based on research across Blender, Houdini, Unity, Figma, iOS, and distributed tracing tools, the strongest depth navigation pattern is **portal + path bar + context dimming + animated transition**:

**Canvas**: Double-click a node that has children → animated transition (slide-right = deeper) into the child sequence as its own full canvas. Parent context dims behind (not disappears). Back gesture (escape, back arrow, or slide-left) returns to parent level.

**Left rail**: Scoped to current level. When you drill into a child sequence, the 6 sections (SEQUENCE → PHASE → NODE → AGENT → GATE → RUN) re-render to show that child's context.

**Path bar** (not breadcrumbs): A compact, always-one-line, clickable path in both the left rail header and canvas top bar. Shows `Parent > Current` with icons and arrows. Click any segment to jump to that level. This is the Blender/Houdini "path gadget" pattern — NOT a traditional text breadcrumb trail.

**Why this works**:
- Animation direction encodes depth (iOS proves slide-right = deeper, slide-left = shallower)
- Context dimming answers both "what am I editing?" and "where does this live?"
- The path bar is compact and always one line, avoiding the sprawl of breadcrumb trails
- Portal gives each level the full canvas real estate — a child fusion sequence with 5 candidates doesn't get cramped
- Cognitive load stays constant regardless of depth

### Nested Lanes with Waterfall Grammar

Based on research across Jaeger, Datadog, GitHub Actions, GitLab CI, Gantt charts, and DAWs:

Child execution appears as indented/collapsible sub-lanes within the parent lane, using the distributed tracing waterfall grammar:

```
Parent Lane ████████████████████████████
  ├─ Child A     ████████
  ├─ Child B          ████████████
  └─ Child C                    ██████
                                     ◆ Gate
```

**Key rules**:
- **Maximum 2 levels** of inline nesting in the lane view. Deeper → portal drill-down
- **Connector lines** (`├─`, `└─`) — not whitespace-only indentation (Zipkin's acknowledged failure)
- **Collapsed-by-default** for completed/successful children. Auto-expand failed or running only
- **Summary rollup bar** on collapsed parents spanning children's time range + status badge + child count pill
- **Numbered pills** for high-cardinality children: 8 parallel agents → show 3-4 + a "+4 more" pill
- **Color by agent/role**, not by depth level

### Gates as Diamond Milestones at Convergence Points

Borrowed from Gantt chart conventions — gates render as diamond shapes at the point where child work converges. Connector lines from child lanes converge on the gate diamond.

### Merging Converges Depth

When child runs complete, they merge back into the parent context:
- **Single merge**: One child lane merges its result into the parent node
- **Block merge**: Multiple child lanes (e.g. fusion candidates) converge into a synthesis node
- **Terminal state**: Merged source lanes become `'merged'` terminal state with `mergedIntoThreadSurfaceId`
- **Nested visualization**: Merge arrows connect child sub-lanes to the gate diamond / parent continuation point

---

## Key Decisions

1. **Phase = Node + Agent + Gate** — atomic unit at every depth level, no exceptions
2. **Full type system at every depth** — child sequences can be base/p/c/f/b/l
3. **Portal + path bar + context dimming** — animated drill-in/out, compact path bar (not breadcrumbs), dimmed parent context
4. **Left rail scoped to current level** — 6 sections re-render for whichever sequence you're viewing
5. **Nested lanes with 2-level inline limit** — waterfall grammar with connector lines; deeper = portal
6. **Gates as diamond milestones** — convergence points where child work meets quality checks
7. **ThreadSurface is the bridge** — existing parent/child tree extended so each child surface maps to a full sequence
8. **Provenance tracks through depth** — agent rubric scores include spawned children's outcomes
9. **No depth limit** — recursive by design, practically bounded by agent capability
10. **Gate cascade is configurable** — each gate has a `cascade` flag; some propagate child failures upward, others don't
11. **Scoped sub-runs** — child gets a sub-run ID formatted as `parentRunId:childIndex`, single namespace but hierarchically addressable
12. **User defines spawn capability** — the user creates the sequence and defines whether an agent can spawn children; not an autonomous agent decision
13. **Collapsed-by-default** — completed children auto-collapse; running/failed auto-expand
14. **Numbered pills for parallel agents** — group identical children with count badge, show 3-4 + "+N more"
15. **Color by role, not depth** — agents keep their assigned color across all nesting levels

---

## Resolved Questions

1. **Gate inheritance**: Configurable per gate. Each gate has a `cascade` flag — some propagate child failures upward, others are independent. Decided at gate configuration time by the user.

2. **Run scope**: Scoped sub-run. Child gets a sub-run ID formatted as `parentRunId:childIndex`. Single namespace but hierarchically addressable.

3. **Spawn trigger**: The user defines whether an agent can spawn children. It's the user who creates the sequence and decides which agents have spawn capability. This is not an autonomous agent decision.

4. **Depth navigation**: Portal + compact path bar + context dimming + animated transitions. NOT traditional breadcrumb trails. Research confirmed this is the strongest pattern (Blender, Houdini, Unity, iOS).

5. **Merge visualization**: Gates rendered as diamond milestones at convergence points. Connector lines from child lanes converge on the gate diamond. Merged source lanes get `'merged'` terminal state.

## Open Questions

1. **Max depth guard**: No artificial limit, but should there be a soft warning at depth N? "This agent has spawned 5 levels deep — review?"

2. **Hierarchy view integration**: The HierarchyView already groups by depth (Champion/Frontline/Mini). With recursive sequences, does the hierarchy view show the full tree across all depth levels, or does it also scope to the current drill-in level?

---

## Existing Infrastructure

### What Already Works (branches in git)

| Branch | What It Does |
|--------|--------------|
| `coord/thread-surface-subagent-spawns` | Spawn-driven child surface creation, runtime event persistence |
| `feat/thread-surface-runtime-merge` | Merge event derivation from synth steps |
| `feat/thread-surface-runtime-child` | Map executed steps to thread runtime state |
| `feat/thread-surface-lifecycle` | Thread surface navigation scaffold |
| `feat/threados-lanes-inspector` | Lane board + inspector integration |

### Data Model (Already Implemented)

- **ThreadSurface**: `id`, `parentSurfaceId`, `depth`, `childSurfaceIds[]`, `registeredAgentId`
- **RunScope**: `id`, `threadSurfaceId`, `runStatus`, `executionIndex`
- **MergeEvent**: `destinationThreadSurfaceId`, `sourceThreadSurfaceIds[]`, `mergeKind` (single/block), `executionIndex`
- **RuntimeDelegationEvent**: `spawn-child` and `merge-into` JSONL events emitted by agents
- **SpawnSpec**: `orchestrator`, `watchdog`, `fanout` spawn kinds with parent/child surface IDs

### Merge Model (Already Implemented)

- **MergeKind**: `single` (1-to-1) or `block` (many-to-1)
- **Recording**: `recordMergeEvent()` validates sources/destination exist, appends to state
- **Projection**: `projectLaneBoard()` sorts rows by merge cluster, marks source rows as terminal `'merged'`
- **Runtime**: Agents emit `merge-into` events via JSONL; `finalizeStepRunWithRuntimeEvents()` processes them
- **Visualization**: FocusedLanePlane shows incoming/outgoing merge groups per lane

### Known Issues (from design review 2026-03-11)

- N-M1: ThreadFlowPlane accepts `edges` but never renders actual parent→child connections
- N-M2: Lane roster scroll constraint missing (no flex column layout on aside)
- N-m5: Layer labels hardcoded to 3 depths only (Champion/Frontline/Mini)
- N-S2: No empty state on lane board

---

## Research References

### Depth Navigation Patterns
- Blender node groups (Tab in/out, path bar in header)
- Houdini network editor (I/Enter to dive, U to go up, path gadget)
- Unity Prefab Mode (context dimming: greyed/hidden surroundings)
- iOS UINavigationController (animated slide transitions, back button shows parent title)
- Figma frames (double-click to enter, Escape to exit)
- Miller columns (macOS Finder — columns encode depth spatially)

### Nested Timeline Patterns
- Jaeger/Datadog waterfall (indentation + connector lines + color by service)
- GitHub Actions (collapsed-by-default for completed steps)
- GitLab CI (numbered pills for job groups, DAG connector lines)
- Gantt charts (diamond milestones at convergence, summary rollup bars)
- GoCD Value Stream Map (fan-in convergence as first-class concept)
- Ableton/Logic (track groups with disclosure triangles, color inheritance)
- Premiere Pro/DaVinci Resolve (portal drill-down for nested sequences)
