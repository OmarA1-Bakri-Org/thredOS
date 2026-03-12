# Layout Restructure: Unified Left Panel with Accordion Inspector

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the ThreadOS workbench from a three-column layout (left rail + board + inspector) to a two-column layout (unified left panel + full-width board) with a floating chat overlay. This eliminates the right inspector rail, merges navigation and inspection into an accordion-based left panel, simplifies roster cards, and extracts the chat panel into a floating chatbot overlay.

**Why:** The current layout dedicates 736px (38%) of a 1920px screen to sidebars. The inspector buries editing controls under 4-5 sections of read-only metadata. The fixed-height chat panel steals 288px of vertical space from the lane board. Users must ping-pong between left and right sides constantly.

**Architecture:** One unified left panel (~380px) with collapsible accordion sections that auto-respond to user context. The board takes all remaining width. Chat becomes a floating overlay that doesn't affect layout flow. The accordion sections follow an edit-first, metadata-second principle.

**Tech Stack:** Same stack — React, TypeScript, shadcn/ui, Radix Accordion primitive, Zustand, lucide-react. No new dependencies required (Radix Accordion is already available through shadcn/ui).

**Branch:** Create `feat/accordion-layout-restructure` from current `feat/ui-consolidation-workflow-plane`.

---

## Pre-Flight: Snapshot Current State

Before any changes, verify the baseline:

```bash
bun run check          # must be GREEN
bun test               # 932+ tests, 0 fail
git status             # clean working tree
```

Create the working branch:

```bash
git checkout -b feat/accordion-layout-restructure
```

---

## Task 1: Extract chat panel into floating overlay

**Rationale:** This is the most independent change. It removes the `h-72` fixed strip from WorkbenchShell without touching the inspector or left rail. The lane board immediately gains 288px of vertical space.

**Files:**
- Modify: `components/chat/ChatPanel.tsx`
- Modify: `components/workbench/WorkbenchShell.tsx`
- Modify: `lib/ui/store.ts`
- Create: `components/chat/FloatingChatTrigger.tsx`
- Test: Update `components/chat/ChatPanel.test.tsx`
- Test: Update `components/workbench/WorkbenchShell.test.tsx`

**Step 1: Update the store**

Add to `UIStore`:
```typescript
chatPosition: { x: number; y: number }
setChatPosition: (pos: { x: number; y: number }) => void
chatSize: { width: number; height: number }
setChatSize: (size: { width: number; height: number }) => void
```

Defaults: `chatPosition: { x: window.innerWidth - 420, y: window.innerHeight - 520 }`, `chatSize: { width: 400, height: 500 }`.

**Step 2: Create FloatingChatTrigger**

Small pill button anchored to bottom-right corner:
- Shows "Ask about your sequence..." text
- Click calls `toggleChat()`
- Position: `fixed bottom-4 right-4 z-40`
- Style: dark surface, subtle glow, monospace label
- Only visible when `chatOpen === false`

**Step 3: Convert ChatPanel to floating overlay**

- Wrap ChatPanel in a `position: fixed` container with `z-50`
- Remove the `h-72 shrink-0 border-t` layout from WorkbenchShell
- Add a drag handle at the top of the panel (cursor: grab)
- Add a resize handle at the bottom-right corner
- Rounded corners, box shadow for floating effect
- Close button in header (X icon)
- Background: `bg-[#08101d]/95 backdrop-blur-sm`

**Step 4: Update WorkbenchShell**

- Remove the conditional `{chatOpen && chat}` block from the main column
- Remove the `chat` prop entirely
- Render `<FloatingChatTrigger />` and `{chatOpen && <ChatPanel />}` at the root level of WorkbenchShell (outside the flex layout)
- The board `div` now takes `flex-1` without any sibling stealing height

**Step 5: Update tests**

- ChatPanel tests: verify `position: fixed`, floating behavior
- WorkbenchShell tests: verify chat no longer in main column flow
- FloatingChatTrigger: new test file for trigger rendering and toggle

**Step 6: Verify**

```bash
bun run check
bun test
```

Visual check: Lane board should now fill the full height below the top bar. Chat should float over content when opened.

---

## Task 2: Build the accordion left panel component

**Rationale:** Create the unified accordion component before wiring it into the shell. This is a new component that can be built and tested in isolation.

**Files:**
- Create: `components/workbench/AccordionPanel.tsx`
- Create: `components/workbench/AccordionPanel.test.tsx`
- Modify: `lib/ui/store.ts`

**Step 1: Update the store**

Add to `UIStore`:
```typescript
activeAccordionSections: string[]
setActiveAccordionSections: (sections: string[]) => void
expandAccordionSection: (section: string) => void
collapseAccordionSection: (section: string) => void
```

Default: `activeAccordionSections: ['navigator']` (navigator open on load).

Update `setSelectedNodeId` behavior: when a node is selected, auto-expand `'step-detail'` and collapse `'navigator'`. When node is deselected (null), expand `'navigator'` and collapse `'step-detail'`.

**Step 2: Build AccordionPanel**

Use Radix Accordion (type="multiple") with these sections:

| Section Key | Label | Icon | Content |
|-------------|-------|------|---------|
| `navigator` | NAVIGATOR | `Layers3` | Thread surface tree + search |
| `step-detail` | STEP / GATE DETAIL | `ShieldCheck` | Step identity, badges, edit form, actions |
| `dependencies` | DEPENDENCIES | `GitBranch` | Dependency list + add/remove |
| `thread-context` | THREAD CONTEXT | `Activity` | Run summary, provenance, notes, discussion |
| `skills` | SKILLS | `Sparkles` | Local + inherited skills |
| `structure` | STRUCTURE | `BarChart3` | Phase grid, gates, signals, prerequisites |

Each section header:
- Monospace uppercase label (10px)
- Icon (14px, themed color)
- Chevron rotates on expand
- Subtle bottom border
- Click to toggle

Section content:
- Smooth height animation (CSS transition or Radix built-in)
- Padding: `px-4 py-3`
- Max-height with overflow-y-auto for long content sections

**Step 3: Implement context-aware auto-expand**

Wire the accordion to the store:
```typescript
// In AccordionPanel, subscribe to selectedNodeId changes
useEffect(() => {
  if (selectedNodeId) {
    expandAccordionSection('step-detail')
    collapseAccordionSection('navigator')
  } else {
    expandAccordionSection('navigator')
    collapseAccordionSection('step-detail')
  }
}, [selectedNodeId])
```

**Step 4: Write tests**

- Renders all 6 section headers
- Clicking section header toggles content visibility
- Auto-expands step-detail when selectedNodeId is set
- Auto-expands navigator when selectedNodeId is cleared
- Multiple sections can be open simultaneously
- Section content scrolls when overflowing

**Step 5: Verify**

```bash
bun test components/workbench/AccordionPanel.test.tsx
```

---

## Task 3: Migrate navigator content into accordion

**Rationale:** Move the thread navigator and skills from the standalone LeftRail into the accordion's `navigator` and `skills` sections.

**Files:**
- Modify: `components/workbench/AccordionPanel.tsx`
- Modify: `components/workbench/LeftRail.tsx` (extract reusable content)
- Create: `components/workbench/ThreadNavigatorContent.tsx`
- Create: `components/workbench/SkillsContent.tsx`
- Test: Update existing LeftRail tests

**Step 1: Extract navigator content from LeftRail**

LeftRail currently renders:
1. Header ("NAVIGATOR" / "Thread surfaces")
2. Thread navigator tree
3. Skills section (LOCAL + INHERITED)

Extract the tree content (without the header/container chrome) into `ThreadNavigatorContent.tsx`. Extract skills content into `SkillsContent.tsx`. These are pure content components with no layout opinions.

**Step 2: Wire content into accordion sections**

In AccordionPanel:
- `navigator` section renders `<ThreadNavigatorContent />`
- `skills` section renders `<SkillsContent />`

**Step 3: Update LeftRail**

LeftRail becomes a thin wrapper that either:
- Renders the old layout (for mobile drawer use only), OR
- Is deprecated in favor of AccordionPanel

Keep LeftRail for now as the mobile drawer fallback. The desktop layout will use AccordionPanel directly.

**Step 4: Test**

- ThreadNavigatorContent renders thread surface list
- SkillsContent renders local and inherited skills
- AccordionPanel navigator section shows thread tree
- AccordionPanel skills section shows skill inventory

**Step 5: Verify**

```bash
bun run check
bun test
```

---

## Task 4: Migrate inspector content into accordion

**Rationale:** Move StepForm, StepActions, dependencies, thread context, and structure stats into accordion sections. This is the core change — the inspector rail content becomes accordion content.

**Files:**
- Modify: `components/workbench/AccordionPanel.tsx`
- Modify: `components/inspector/StepInspector.tsx` (extract sections)
- Create: `components/inspector/StepDetailContent.tsx`
- Create: `components/inspector/DependenciesContent.tsx`
- Create: `components/inspector/ThreadContextContent.tsx`
- Create: `components/inspector/StructureContent.tsx`
- Test: Update StepInspector tests

**Step 1: Extract inspector sections**

StepInspector currently renders (in order):
1. Thread/run context panel (blue bg)
2. Structure stats grid
3. Prerequisites
4. Step detail (ID, badges)
5. Thread Context / Provenance tabs
6. StepForm (edit fields)
7. StepActions (run/stop/restart)
8. Dependencies
9. Operational Guidance

Extract into content components:

| Component | Content | Accordion Section |
|-----------|---------|-------------------|
| `StepDetailContent` | Step ID + badges + StepForm + StepActions | `step-detail` |
| `DependenciesContent` | Dependency list + add/remove from StepForm | `dependencies` |
| `ThreadContextContent` | Run summary, provenance, notes, discussion, operational guidance | `thread-context` |
| `StructureContent` | Phase grid, gates, signals, prerequisites | `structure` |

**Step 2: Reorder for edit-first principle**

The accordion section ORDER already implements the edit-first principle:
1. Navigator (browse)
2. **Step Detail (identity + edit + actions)** ← first thing you see on selection
3. **Dependencies** ← structural relationships
4. Thread Context ← reference data (collapsible)
5. Skills ← reference data (collapsible)
6. Structure ← reference data (collapsible)

The user never scrolls past metadata to reach the edit form. They click the step, the Step Detail section opens at the top of the panel, and the edit pencil icon is right there.

**Step 3: Handle gate vs step vs thread-surface context**

- When a **step** is selected: step-detail shows StepDetailContent, dependencies shows deps
- When a **gate** is selected: step-detail shows GateDetailContent (approve/block actions, gate status)
- When a **thread surface** is selected (no step): step-detail shows ThreadSurfaceInspector content
- When **nothing** selected: step-detail section is empty/hidden, navigator expanded

**Step 4: Wire into AccordionPanel**

```tsx
<AccordionSection key="step-detail" label="STEP DETAIL">
  {selectedGate ? <GateDetailContent /> :
   selectedStep ? <StepDetailContent /> :
   selectedThreadSurface ? <ThreadSurfaceContent /> :
   <EmptyState message="Select a node to inspect" />}
</AccordionSection>
```

**Step 5: Test**

- Step selected: step-detail shows name, type, model, edit button, actions
- Gate selected: step-detail shows gate status, approve/block
- Thread surface selected: thread-context auto-expands
- Edit form fields render correctly within accordion width
- Actions (run/stop/clone/delete) are accessible
- Dependencies add/remove works

**Step 6: Verify**

```bash
bun run check
bun test
```

---

## Task 5: Replace WorkbenchShell layout (three-column → two-column)

**Rationale:** Swap the shell from left-rail + board + inspector to accordion-panel + board. This is the structural change that removes the right rail entirely.

**Files:**
- Modify: `components/workbench/WorkbenchShell.tsx`
- Modify: `components/workbench/InspectorRail.tsx` (deprecate for desktop)
- Modify: `app/page.tsx` (update props)
- Test: Update WorkbenchShell tests

**Step 1: Update WorkbenchShell layout**

Current:
```
[LeftRail w-72] [Board flex-1] [InspectorRail w-md]
```

New:
```
[AccordionPanel w-[380px]] [Board flex-1]
```

- Replace the left rail `div` with `<AccordionPanel />`
- Remove the inspector rail `div` from desktop layout
- Remove `inspectorOpen` conditional from desktop (accordion handles it)
- Board takes `flex-1 min-w-0` (gains ~356px)
- AccordionPanel: `w-[380px] shrink-0` with `overflow-y-auto`

**Step 2: Handle mobile/responsive**

For screens below `xl`:
- AccordionPanel becomes a slide-in drawer (same as current LeftRail drawer)
- Accessed via hamburger menu or swipe
- Inspector drawer is removed entirely — accordion covers both functions

**Step 3: Remove inspector toggle from TopBar**

- Remove the "INSPECTOR" button from TopBar (no longer needed — accordion is always visible)
- Keep "CHAT" button (now toggles floating overlay)
- Simplify store: `inspectorOpen` can be deprecated or repurposed for mobile drawer

**Step 4: Update page.tsx**

- Remove `inspector` prop from WorkbenchShell call
- Remove dynamic import of StepInspector at page level (now inside AccordionPanel)

**Step 5: Test**

- WorkbenchShell renders two columns (panel + board)
- No inspector rail on desktop
- Board takes full remaining width
- Mobile drawer contains AccordionPanel content
- TopBar no longer shows inspector toggle

**Step 6: Verify**

```bash
bun run check
bun test
```

Visual check: The board should now be noticeably wider. On the lanes view, the roster and focused content should have proper breathing room.

---

## Task 6: Simplify roster cards

**Rationale:** With the extra board width from removing the right inspector, clean up the roster cards for better scan-ability.

**Files:**
- Modify: `components/lanes/LaneBoardView.tsx`
- Test: Update `components/lanes/LaneBoardView.test.tsx`

**Step 1: Truncate UUIDs**

- Display only first 8 characters of run IDs and thread surface IDs
- Full ID available on hover (title attribute)
- Monospace, muted color (`text-slate-500`)

**Step 2: Improve card hierarchy**

Each roster card becomes:
```
┌─────────────────────────────────┐
│ ● Step Name                  #1 │  ← status dot + name + index
│   Phase: Setup · SEQUENTIAL     │  ← phase + execution mode
│   92063AC2                      │  ← truncated ID, muted
└─────────────────────────────────┘
```

- **Row 1**: Left-edge status color dot + step name (primary label, `text-slate-100`) + execution index right-aligned
- **Row 2**: Phase badge + execution mode, smaller text (`text-slate-400`)
- **Row 3**: Truncated ID in monospace, muted (`text-slate-600`)
- **Focused card**: Left border accent (2px emerald), slightly lighter background

**Step 3: Increase spacing**

- Card padding: `px-4 py-3` (up from `px-3 py-2`)
- Card gap: `space-y-3` (up from `space-y-2`)
- Roster width: Reduce from `w-104` to `w-80` (the cards are simpler, they need less width, giving even more to the focused content)

**Step 4: Test**

- Roster cards render truncated IDs
- Step name is primary label
- Focused card has emerald border accent
- Spacing is correct

**Step 5: Verify**

```bash
bun run check
bun test
```

---

## Task 7: Polish and final verification

**Files:**
- All modified files from Tasks 1-6

**Step 1: Visual regression check**

Run the dev server and verify via Playwright or manual inspection:
```bash
npx next dev -p 8080
```

Check each view:
- [ ] Entry screen renders correctly
- [ ] Hierarchy view: accordion panel on left, full-width graph
- [ ] Lanes view: accordion panel + roster + focused content
- [ ] Click step node → accordion step-detail auto-expands
- [ ] Click empty canvas → accordion navigator auto-expands
- [ ] Edit form works within accordion width
- [ ] Floating chat opens/closes without affecting layout
- [ ] Chat trigger pill visible when chat is closed
- [ ] Mobile responsive: drawer works for accordion
- [ ] Roster cards: clean, scannable, truncated IDs

**Step 2: Test coverage**

```bash
bun test
```

All existing tests must pass. New tests from Tasks 1-6 must be included. Target: maintain 90%+ function coverage.

**Step 3: Lint + typecheck**

```bash
bun run check
```

Must be GREEN.

**Step 4: Commit and push**

```bash
git add -A
git commit -m "feat: restructure layout — accordion inspector, floating chat, simplified roster"
git push -u origin feat/accordion-layout-restructure
```

---

## Dependency Graph

```
Task 1 (floating chat) ──────────────────────────────┐
Task 2 (accordion component) ── Task 3 (navigator) ──┤── Task 5 (shell swap) ── Task 7 (polish)
                              └─ Task 4 (inspector) ──┘
Task 6 (roster) ──────────────────────────────────────────────────────────────── Task 7 (polish)
```

Tasks 1, 2, and 6 are independent and can be parallelized.
Tasks 3 and 4 depend on Task 2.
Task 5 depends on Tasks 1, 3, and 4.
Task 7 depends on all previous tasks.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Accordion width too narrow for form fields | Test with 380px. Fallback: add drag-to-resize handle on panel edge |
| Mobile drawer becomes too complex | Keep existing LeftRail as mobile-only fallback during transition |
| Existing tests break from layout changes | Run full suite after each task. No batching. |
| Performance regression from accordion animations | Use CSS-only transitions. Measure with React DevTools Profiler |
| Loss of "always visible" inspector | Accordion auto-expand ensures relevant section is always open — no user action needed on selection |
