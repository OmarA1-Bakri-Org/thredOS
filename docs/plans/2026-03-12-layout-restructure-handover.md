# Handover Note: Layout Restructure Implementation

> **For the next Claude session.** This document contains everything you need to start implementing immediately. Read this first, then read the plan.

---

## What You're Doing

Restructuring the ThreadOS workbench from a three-column layout to a two-column layout with accordion-based navigation+inspection on the left and a floating chat overlay.

**Plan document:** `docs/plans/2026-03-12-layout-restructure-accordion-inspector.md`

---

## Current State (Verified 2026-03-12 05:40 UTC)

| Metric | Value |
|--------|-------|
| Branch | `feat/ui-consolidation-workflow-plane` (37 commits ahead of main) |
| PR | https://github.com/OmarA1-Bakri-Org/THREAD-OS/pull/23 |
| Tests | 932 pass / 0 fail / 115 files |
| Coverage | 90.28% function, 95.73% line |
| Lint + Typecheck | GREEN |
| Uncommitted changes | None (only untracked screenshots + runtime files) |

**First action:** Create branch `feat/accordion-layout-restructure` from current HEAD.

---

## The Four Changes (Summary)

1. **Chat → Floating overlay** — Extract from layout flow into `position: fixed` panel at bottom-right. Free 288px vertical space.
2. **Accordion left panel** — New `AccordionPanel.tsx` with 6 collapsible sections: Navigator, Step Detail, Dependencies, Thread Context, Skills, Structure.
3. **Inspector → Merged left** — StepInspector content decomposed into accordion sections. Right rail removed. Edit-first ordering.
4. **Roster cleanup** — Truncated UUIDs, step name as primary label, better spacing, narrower width.

---

## Key Files to Read First

These are the files you will be modifying. Read them FULLY before starting.

### Layout Shell
- `components/workbench/WorkbenchShell.tsx` — Three-column flex layout. This is where you remove the right rail.
- `components/workbench/LeftRail.tsx` — Current left rail with navigator + skills. Content gets extracted into accordion sections.
- `components/workbench/InspectorRail.tsx` — Current right rail wrapper. Gets deprecated for desktop.
- `components/workbench/TopBar.tsx` — Has inspector toggle button that needs removing.

### Inspector (content to decompose)
- `components/inspector/StepInspector.tsx` — The big one. Renders 9+ sections for steps, gates, and thread surfaces. Each section becomes an accordion content component.
- `components/inspector/StepForm.tsx` — Edit form for step name/type/model. Goes into `step-detail` accordion section.
- `components/inspector/StepActions.tsx` — Run/stop/restart/clone/delete buttons. Goes into `step-detail` accordion section.
- `components/inspector/ThreadSurfaceInspector.tsx` — Thread surface detail view. Sections distribute across accordion.

### Chat
- `components/chat/ChatPanel.tsx` — Currently inline in layout flow. Convert to floating.
- `components/chat/ChatInput.tsx` — Input component inside ChatPanel. No changes needed.

### Lanes
- `components/lanes/LaneBoardView.tsx` — Roster cards are rendered here. Clean up card layout and spacing.
- `components/lanes/FocusedLanePlane.tsx` — Right side of lane board. Gets more width.

### State
- `lib/ui/store.ts` — Zustand store. Add accordion state, chat position/size state. Update auto-expand logic.

### Entry Point
- `app/page.tsx` — Passes inspector/chat props to WorkbenchShell. Update prop contract.

---

## Architecture Decisions Already Made

1. **Radix Accordion** (type="multiple") — Multiple sections can be open. Already available via shadcn/ui.
2. **Panel width: 380px** — Wider than current left rail (288px) but narrower than left+right combined (736px). Net gain: ~356px for the board.
3. **Context-aware auto-expand** — Selecting a node auto-opens Step Detail and collapses Navigator. Deselecting reverses it. Driven by `useEffect` on `selectedNodeId`.
4. **Mobile: existing drawer pattern** — Keep LeftRail as mobile drawer fallback. Accordion is desktop-only initially.
5. **Floating chat: fixed position with drag/resize** — Not a complex library. Just `position: fixed` + mouse event handlers for drag/resize.
6. **Edit-first inspector ordering** — Step identity + edit form + actions are the FIRST thing in the accordion, not the last.

---

## Parallelization Strategy

Tasks 1 (floating chat), 2 (accordion component), and 6 (roster cleanup) are fully independent. Run them as parallel sub-agents.

Tasks 3 and 4 depend on Task 2 completing first.

Task 5 (shell swap) depends on Tasks 1, 3, and 4.

Task 7 (polish) is the final gate.

```
Parallel batch 1: Task 1 + Task 2 + Task 6
Sequential:       Task 3 (needs Task 2)
Sequential:       Task 4 (needs Task 2)
Sequential:       Task 5 (needs Tasks 1, 3, 4)
Final:            Task 7 (needs all)
```

---

## Quality Gates (From CLAUDE.md — Non-Negotiable)

- `bun run check` GREEN after every task
- `bun test` all pass after every task
- No uncommitted changes spanning >5 files (commit after each task)
- Never edit on `main` — use the feature branch
- Visual verification via Playwright or dev server for layout changes
- EP-2: Every "it works" claim needs tool output as proof

---

## What NOT to Do

- Do NOT delete LeftRail.tsx or InspectorRail.tsx — they serve as mobile drawer fallbacks. Extract content, deprecate for desktop, keep for mobile.
- Do NOT add new npm dependencies — Radix Accordion is already available.
- Do NOT change the Zustand store API in breaking ways — add new fields, don't rename existing ones. Existing tests depend on current field names.
- Do NOT touch any files outside the layout/UI layer — the runtime, CLI, API routes, and domain logic are frozen and passing all tests.
- Do NOT change the color palette, typography, or visual system — this is a layout restructure, not a redesign.

---

## Omar's Preferences (From Memory)

- Always run in parallel mode when possible
- Always use sub-agents to preserve context window
- Quality gates on all tasks — no task is done without verification
- No deletions without explicit permission
- Full file reads always — not truncated
- Honest about tool failures — if something breaks, say so
- Commit after every logical unit of work

---

## Test Files That Will Need Updates

These existing test files assert layout structure and will need modification:

| Test File | Why |
|-----------|-----|
| `components/workbench/WorkbenchShell.test.tsx` | Layout structure changes from 3-col to 2-col |
| `components/workbench/LeftRail.test.tsx` | Content extraction into separate components |
| `components/workbench/InspectorRail.test.tsx` | Desktop deprecation |
| `components/workbench/TopBar.test.tsx` | Inspector toggle button removed |
| `components/chat/ChatPanel.test.tsx` | Floating positioning instead of inline |
| `components/inspector/StepInspector.test.tsx` | Content decomposed into new components |
| `components/inspector/StepForm.test.tsx` | May need width-aware rendering tests |
| `components/lanes/LaneBoardView.test.tsx` | Roster card structure changes |

---

## Start Command

```bash
cd /c/Users/OmarAl-Bakri/THREAD-OS
git checkout -b feat/accordion-layout-restructure
cat docs/plans/2026-03-12-layout-restructure-accordion-inspector.md
```

Then execute Task 1, Task 2, and Task 6 in parallel.
