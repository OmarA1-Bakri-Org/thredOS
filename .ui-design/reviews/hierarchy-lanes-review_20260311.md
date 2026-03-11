# Design Review: ThreadOS Hierarchy + Lanes (Post-Iteration)

**Review ID:** hierarchy-lanes-review_20260311
**Reviewed:** 2026-03-11
**Target:** components/hierarchy/**, components/lanes/**, components/workbench/**, components/chat/**, components/EmptyState.tsx, components/LoadingSpinner.tsx
**Focus:** Visual, Usability, Code Quality, Performance
**Branch:** feat/ui-consolidation-workflow-plane
**Prior review:** .ui-design/reviews/full-ui-review_20260310.md

---

## Resolution Summary (Prior Review)

The March 10 review flagged 18 issues. **12 are now resolved**, 6 remain.

### Resolved Issues (12/18)

| ID | Issue | How Fixed |
|----|-------|-----------|
| C1 | Design token split personality | EmptyState/LoadingSpinner migrated to dark hex palette |
| C2 | handleDiscard silent no-op | ChatPanel:145-149 now clears actions+diff from message |
| M1 | font-['Inter'] override | Removed from FocusedThreadCard title |
| M2 | Search bar styling mismatch | TopBar:116 now `border-slate-800 bg-[#0a101a]` |
| M3 | ActionCard raw JSON | `formatArgs()` renders key-value pairs |
| M5 | No Apply loading state | `applyingMessageId` state + disabled button + "Applying..." text |
| m1 | CompactThreadCard static icons | `deriveIcons()` now condition-driven |
| m2 | Thread Runner locked dead space | Removed from LeftRail |
| m4 | Chat scroll no smooth | `behavior: 'smooth'` added |
| m5 | EmptyState wrong CLI name | Now shows `thread init` |
| m6 | 'use client' inconsistency | ActionCard directive removed; consistent |
| S2 | Loading skeletons missing | `LoadingSkeleton` component added |

### Remaining Issues (6/18)

| ID | Issue | Severity | Notes |
|----|-------|----------|-------|
| M4 | StatBar visual distinction | Major → Minor | Color ranges added (rose/amber/sky/emerald by score), but adjacent ranges still close |
| m3 | Button rounded-none vs rounded-full | Minor | TopBar still uses className overrides |
| m7 | Uncontrolled search input | Minor | Still `defaultValue={searchQuery}` |
| S1 | Extract SSE streaming logic | Suggestion | 60+ lines still inline in ChatPanel |
| S3 | Memoize card components | Suggestion | FocusedThreadCard/CompactThreadCard still unwrapped |
| S4 | Virtualize long lists | Suggestion | Not yet needed at current scale |

---

## New Issues

**Issues Found:** 13 (0 critical, 3 major, 6 minor, 4 suggestions)

---

## Major Issues

### N-M1: ThreadFlowPlane Accepts `edges` But Never Renders Them

**Severity:** Major
**Category:** Code Quality / Usability
**Location:** [ThreadFlowPlane.tsx:8,38](components/hierarchy/ThreadFlowPlane.tsx#L8)

**Problem:**
The component accepts an `edges` prop with `{ source: string; target: string }[]` but the prop is destructured and then **never used**. The visual only renders generic arrows between layer columns — it doesn't draw actual parent→child connections between specific nodes.

**Impact:**
The hierarchy graph data (from `useHierarchyGraph`) provides real parent→child edges, but the flow plane shows a misleading "every node in layer N connects to every node in layer N+1" visual. For hierarchies with selective parent→child relationships, this misrepresents the DAG structure.

**Recommendation:**
Either render actual edge paths between source→target node pairs (SVG lines or CSS connectors), or remove the `edges` prop entirely and document that the plane shows layer grouping only, not actual edge topology.

---

### N-M2: Lane Roster Scroll Constraint Missing

**Severity:** Major
**Category:** Usability
**Location:** [LaneBoardView.tsx:48-58](components/lanes/LaneBoardView.tsx#L48-L58)

**Problem:**
The `<aside>` containing the lane roster has no flex column layout:

```tsx
<aside className="w-104 shrink-0 border-r border-slate-800/80 bg-[#08101d]">
  <div className="border-b ...">header</div>
  <div className="flex max-h-full flex-col gap-2 overflow-y-auto px-3 py-3">buttons</div>
</aside>
```

Without `flex flex-col h-full` on the aside, the inner `max-h-full` has no constrained parent height to reference. With many lane rows, the button container will grow beyond the viewport and not scroll.

**Recommendation:**
```tsx
<aside className="flex w-104 shrink-0 flex-col border-r border-slate-800/80 bg-[#08101d]">
  <div className="shrink-0 border-b ...">header</div>
  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">buttons</div>
</aside>
```

---

### N-M3: FocusedLanePlane Hardcodes Workflow

**Severity:** Major
**Category:** Code Quality
**Location:** [FocusedLanePlane.tsx:5,113](components/lanes/FocusedLanePlane.tsx#L5)

**Problem:**
`contentCreatorWorkflow` is imported directly and passed to `WorkflowBlueprintPanel`. This couples the focused lane UI to a single specific workflow definition. Any other workflow type (e.g. QA pipeline, deployment workflow) cannot be displayed.

**Impact:**
When ThreadOS supports multiple workflow types, this component will need refactoring. The coupling is unnecessary since `SequenceCanvas` already resolves workflows per-thread-surface.

**Recommendation:**
Accept `workflow` as a prop instead of importing it:

```tsx
export function FocusedLanePlane({
  detail,
  workflowStep,
  workflow,       // add this
  sequenceView,
}: {
  detail: ThreadSurfaceFocusedDetail
  workflowStep?: WorkflowStep
  workflow?: Workflow  // add this
  sequenceView?: ReactNode
}) {
  // ...
  <WorkflowBlueprintPanel workflow={workflow ?? contentCreatorWorkflow} />
```

---

## Minor Issues

### N-m1: MessageBubble Renders Plain Text Only

**Severity:** Minor
**Category:** Usability
**Location:** [MessageBubble.tsx:24](components/chat/MessageBubble.tsx#L24)

**Problem:**
`<div className="leading-6">{content}</div>` renders raw text. Any markdown formatting from the LLM (code blocks, lists, bold) appears as literal characters.

**Recommendation:**
Use a lightweight markdown renderer (e.g. `react-markdown` with minimal plugins) for assistant messages.

---

### N-m2: FocusedThreadCard deriveProfile Returns Static Skills

**Severity:** Minor
**Category:** Usability
**Location:** [HierarchyView.tsx:55-63](components/hierarchy/HierarchyView.tsx#L55-L63)

**Problem:**
The `deriveProfile` function always returns the same 6 skills (search, browser, model, tools, files, orchestration) regardless of the thread's actual capabilities. The skill inventory section looks data-driven but is decorative.

**Recommendation:**
Either derive skills from actual thread metadata (if available), or label the section as "Default skill template" to set correct expectations.

---

### N-m3: HierarchyView `backdrop-blur` Performance

**Severity:** Minor
**Category:** Performance
**Location:** [HierarchyView.tsx:80-81](components/hierarchy/HierarchyView.tsx#L80-L81)

**Problem:**
Two `absolute inset-0` layers — a grid pattern overlay and a `backdrop-blur-[5px]` overlay — cover the entire scrollable area. `backdrop-blur` triggers GPU compositing on every pixel, and the grid pattern adds paint complexity.

**Impact:**
On large screens or lower-end hardware, scrolling the hierarchy view may jank. The blur also applies to the grid lines it sits on top of, so the grid is barely visible.

**Recommendation:**
Remove the blur layer and reduce the grid opacity, or apply the grid as a CSS background on the parent container (avoiding extra DOM layers).

---

### N-m4: WorkbenchShell Left Rail Drawer Width Mismatch

**Severity:** Minor
**Category:** Visual
**Location:** [WorkbenchShell.tsx:38,61](components/workbench/WorkbenchShell.tsx#L38)

**Problem:**
Desktop left rail: `w-64` (256px) / `2xl:w-72` (288px).
Mobile drawer: `w-[22rem]` (352px).

The drawer is 64-96px wider than the desktop rail, which means content may reflow or look different when resizing across the `xl` breakpoint.

**Recommendation:**
Use a consistent width, e.g. `w-72` for desktop and `w-72 max-w-[90vw]` for the drawer.

---

### N-m5: ThreadFlowPlane Layer Labels Are Hardcoded

**Severity:** Minor
**Category:** Code Quality
**Location:** [ThreadFlowPlane.tsx:13-17](components/hierarchy/ThreadFlowPlane.tsx#L13-L17)

**Problem:**
```tsx
const layerLabels: Record<number, string> = {
  0: 'Champion',
  1: 'Frontline',
  2: 'Mini',
}
```

Only three depth values are mapped. Depth 3+ shows "Sub". This is fine for the current model but may become confusing if deeper hierarchies are introduced.

**Recommendation:**
Accept `layerLabels` as an optional prop with the current values as defaults, or derive labels from thread metadata.

---

### N-m6: Chat Messages Have No Timestamps

**Severity:** Minor
**Category:** Usability
**Location:** [ChatPanel.tsx:201-214](components/chat/ChatPanel.tsx#L201-L214)

**Problem:**
Messages display with no time indicator. During extended sessions, users cannot tell when a message was sent or how old a response is.

**Recommendation:**
Add a `timestamp` field to `ChatMessage` (set to `Date.now()` on creation) and render a relative time (e.g. "2m ago") in `MessageBubble`.

---

## Suggestions

### N-S1: Add Keyboard Navigation to ThreadFlowPlane

**Location:** [ThreadFlowPlane.tsx:60-81](components/hierarchy/ThreadFlowPlane.tsx#L60-L81)

Nodes are `<button>` elements (good for tab order), but there's no arrow-key navigation between nodes within or across layers. For keyboard-heavy users in a dev tool, arrow keys are expected.

---

### N-S2: Add Empty State to Lane Board

**Location:** [LaneBoardView.tsx:58-118](components/lanes/LaneBoardView.tsx#L58-L118)

If `rows` is empty, the roster renders nothing — no guidance, no empty-state message. Add a "No lanes yet" state with instructions.

---

### N-S3: ThreadFlowPlane Node Width Is Fixed

**Location:** [ThreadFlowPlane.tsx:53](components/hierarchy/ThreadFlowPlane.tsx#L53)

`min-w-[11rem]` gives each layer column a fixed minimum width. Long surface labels will wrap or be clipped. Consider allowing dynamic sizing based on longest label, or adding `truncate` with a tooltip.

---

### N-S4: SequenceCanvas Recomputes Workflow Context Every Render

**Location:** [SequenceCanvas.tsx:134-155](components/canvas/SequenceCanvas.tsx#L134-L155)

The `for (const row of laneBoard.rows)` loop on lines 135-155 calls `resolveThreadSurfaceFocusedDetail` + `resolveWorkflowReferenceStep` + `buildWorkflowLaneContext` for every row on every render. This creates a new `workflowByThreadSurfaceId` object each time, triggering downstream re-renders.

**Recommendation:**
Wrap in `useMemo` keyed on `laneBoard.rows`, `threadSurfaceData`, and `selectedNodeId`.

---

## Positive Observations

- **ThreadFlowPlane fills the "missing main surface" gap** — The left-to-right layer visualization gives immediate structural context that was absent before
- **Card compaction is well-calibrated** — FocusedThreadCard went from dominating the viewport to fitting alongside context; sizing feels proportional
- **ActionCard formatArgs** — Clean key-value rendering replaces raw JSON; much more user-friendly
- **handleDiscard implementation** — Properly clears both `actions` and `diff` from the message, removing the card cleanly
- **LoadingSkeleton addition** — Progressive disclosure with varying-width skeleton lines is a meaningful UX improvement
- **Consistent dark hex palette** — EmptyState and LoadingSpinner now match the rest of the app perfectly
- **Inspector width at w-md (28rem)** — More breathing room for metadata without being excessive
- **Lane roster tightening** — `gap-2 px-3 py-3` reduces visual noise compared to the previous `gap-3 px-4 py-4`

---

## Overall Score

| Category | Previous (Mar 10) | Current (Mar 11) | Trend |
|----------|-------------------|-------------------|-------|
| Critical | 2 | 0 | Resolved |
| Major | 5 | 3 (new) | Improved — old majors fixed, new ones identified |
| Minor | 7 | 6 (3 carry + 3 new) | Stable |
| Suggestion | 4 | 4 (3 carry + 4 new) | Broadened |
| **Total** | **18** | **13** | **-28%** |

## Priority Action Order

1. **Fix lane roster scroll** (N-M2) — 5 min, prevents broken scroll with many lanes
2. **Accept workflow as prop in FocusedLanePlane** (N-M3) — 10 min, decouples from single workflow
3. **Use or remove `edges` prop in ThreadFlowPlane** (N-M1) — 30 min if rendering edges, 2 min if removing
4. **Remove backdrop-blur in HierarchyView** (N-m3) — 5 min performance fix
5. **Add markdown rendering to MessageBubble** (N-m1) — 15 min with react-markdown
6. **Align drawer/desktop left rail width** (N-m4) — 2 min
7. **Add timestamps to chat messages** (N-m6) — 10 min

---

_Generated by UI Design Review. Run `/ui-design:design-review` again after fixes._
