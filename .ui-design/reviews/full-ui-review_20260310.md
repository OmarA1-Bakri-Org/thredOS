# Design Review: ThreadOS Full UI

**Review ID:** full-ui-review_20260310
**Reviewed:** 2026-03-10
**Target:** All UI components (components/**, app/globals.css)
**Focus:** Visual, Usability, Code Quality, Performance
**Branch:** feat/ui-consolidation-workflow-plane
**Prior review:** .kombai/resources/design-review-verification-2026-03-10.md

---

## Summary

The ThreadOS UI has a strong, cohesive dark-terminal aesthetic with consistent use of a custom Button system (CVA), mono-spaced label conventions, and a well-structured layout shell. However, there are **design token inconsistencies** (hardcoded hex vs. CSS variables), a **split personality** between new components (dark hex) and legacy components (semantic tokens), several **usability dead-ends**, and **performance gaps** in the chat system. The prior review resolved 8 of 22 issues; this review identifies 18 issues (6 carried forward, 12 new).

**Issues Found:** 18

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Major | 5 |
| Minor | 7 |
| Suggestion | 4 |

---

## Critical Issues

### C1: Design Token Split Personality

**Severity:** Critical
**Category:** Visual / Code Quality
**Location:** [EmptyState.tsx](components/EmptyState.tsx), [LoadingSpinner.tsx](components/LoadingSpinner.tsx) vs all other components

**Problem:**
`EmptyState` and `LoadingSpinner` use semantic Tailwind tokens (`text-muted-foreground`, `bg-muted`, `border-primary`) while every other component in the app uses hardcoded dark hex values (`#050c17`, `#08101d`, `bg-slate-950/65`). These two components will render with the light-mode `:root` palette unless `.dark` class is applied, and even then they'll look visually disconnected from the rest of the UI.

**Impact:**
Visual jarring when these states appear. They look like they belong to a different app.

**Recommendation:**
Align both components to the established dark hex palette, or migrate the entire app to use CSS variable tokens consistently (preferred long-term).

```tsx
// EmptyState.tsx — Before
<pre className="mt-3 px-4 py-2 bg-muted rounded text-sm font-mono">

// After
<pre className="mt-3 border border-slate-800/90 bg-[#08101d] px-4 py-3 text-sm font-mono text-slate-200">
```

---

### C2: Chat `handleDiscard` Is a Silent No-Op

**Severity:** Critical
**Category:** Usability
**Location:** [ChatPanel.tsx:142-144](components/chat/ChatPanel.tsx#L142-L144)

**Problem:**
The "Discard" button on ActionCard calls `handleDiscard` which is `() => {}`. User clicks discard, nothing happens — the action card stays visible with no feedback.

**Impact:**
Users will click "Discard" and think the UI is broken. This is a trust-destroying interaction.

**Recommendation:**
At minimum, remove the action card from view. Ideally, add a visual confirmation.

```tsx
const handleDiscard = useCallback((messageId: string) => {
  setMessages(prev => prev.map(m =>
    m.id === messageId ? { ...m, actions: undefined } : m
  ))
}, [])
```

---

## Major Issues

### M1: `font-['Inter']` Inline Override (Carried Forward)

**Severity:** Major
**Category:** Visual
**Location:** [FocusedThreadCard.tsx:93](components/hierarchy/FocusedThreadCard.tsx#L93)

**Problem:**
`font-['Inter']` is set inline but Inter is never loaded in the app. The global `--font-sans` is `Geist Mono`. This title will render in browser fallback sans-serif, not Inter.

**Recommendation:**
Remove the inline font override. Use the theme font or explicitly load Inter via `next/font`.

---

### M2: Search Bar Styling Inconsistent (Carried Forward)

**Severity:** Major
**Category:** Visual
**Location:** [TopBar.tsx:114-126](components/workbench/TopBar.tsx#L114-L126)

**Problem:**
The search bar uses `border-[#16417C]/70 bg-[#16417C]/18` with no `rounded-full`, while all adjacent button clusters use `border-slate-800 bg-[#0a101a]`. It's the only element in the TopBar with a blue-tinted background, making it look like it belongs to a different component family.

**Recommendation:**
Match the cluster styling: `border-slate-800 bg-[#0a101a]`, or give all clusters a consistent treatment.

---

### M3: ActionCard Renders Raw JSON

**Severity:** Major
**Category:** Usability
**Location:** [ActionCard.tsx:32](components/chat/ActionCard.tsx#L32)

**Problem:**
`{action.command} {JSON.stringify(action.args)}` renders raw JSON in the UI, e.g. `addStep {"id":"step-1","name":"build"}`. This is developer-facing output, not user-facing.

**Recommendation:**
Format the action args into a readable layout — key-value pairs or a mini table.

---

### M4: StatBar Visual Distinction Too Narrow (Carried Forward)

**Severity:** Major
**Category:** Visual / Usability
**Location:** [FocusedThreadCard.tsx:61-74](components/hierarchy/FocusedThreadCard.tsx#L61-L74)

**Problem:**
Most rubric values are 5-9 so the bars all look "mostly full". A score of 6 and 9 are nearly indistinguishable visually.

**Recommendation:**
Add color gradation (e.g. red-yellow-green range), or show percentage text more prominently, or use a wider visual scale.

---

### M5: No Apply Loading State

**Severity:** Major
**Category:** Usability
**Location:** [ChatPanel.tsx:108-140](components/chat/ChatPanel.tsx#L108-L140)

**Problem:**
When user clicks "Apply" on an ActionCard, the `handleApply` function makes a fetch call but shows no loading indicator. The button stays enabled, inviting double-clicks.

**Recommendation:**
Add an `applying` state that disables the Apply button and shows a loading indicator during the request.

---

## Minor Issues

### m1: CompactThreadCard Icons Are Static Decoration (Carried Forward)

**Severity:** Minor
**Category:** Usability
**Location:** [CompactThreadCard.tsx:14](components/hierarchy/CompactThreadCard.tsx#L14)

**Problem:**
`const compactIcons = [Search, Globe, Bot, Folder]` — same four icons for every card regardless of actual thread capabilities.

---

### m2: Thread Runner "Locked" Dead Space (Carried Forward)

**Severity:** Minor
**Category:** Usability
**Location:** [LeftRail.tsx:55-60](components/workbench/LeftRail.tsx#L55-L60)

**Problem:**
Non-interactive "Locked" section in the LeftRail footer with no unlock path. Takes permanent space.

---

### m3: Button Base `rounded-none` Fights `rounded-full` Overrides

**Severity:** Minor
**Category:** Code Quality
**Location:** [button.tsx:8](components/ui/button.tsx#L8), [TopBar.tsx:88,107](components/workbench/TopBar.tsx#L88)

**Problem:**
Button component base class is `rounded-none`, but TopBar product-entry and view-mode buttons add `rounded-full` via className override. This is fighting the base style rather than using a variant.

**Recommendation:**
Add a `shape` variant to the Button CVA config (`square` | `pill`) instead of className overrides.

---

### m4: Chat Scroll Lacks Smooth Behavior

**Severity:** Minor
**Category:** Usability
**Location:** [ChatPanel.tsx:26](components/chat/ChatPanel.tsx#L26)

**Problem:**
`scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })` jumps instantly. No smooth scroll.

**Recommendation:**
Add `behavior: 'smooth'`.

---

### m5: EmptyState Shows CLI Command

**Severity:** Minor
**Category:** Usability
**Location:** [EmptyState.tsx:14-16](components/EmptyState.tsx#L14-L16)

**Problem:**
Shows `seqctl init my-project` — a raw CLI command that assumes CLI familiarity. The CLI was renamed to `thread`.

---

### m6: `'use client'` Inconsistency

**Severity:** Minor
**Category:** Code Quality
**Location:** [ActionCard.tsx:1](components/chat/ActionCard.tsx#L1) vs [MessageBubble.tsx](components/chat/MessageBubble.tsx), [DiffPreview.tsx](components/chat/DiffPreview.tsx)

**Problem:**
`ActionCard` has `'use client'` but only uses `memo`. `MessageBubble` and `DiffPreview` also use `memo` but don't have `'use client'`. Inconsistent — either all need it or none do (they don't, since `memo` works in server components).

---

### m7: Uncontrolled Search Input Won't Sync

**Severity:** Minor
**Category:** Code Quality
**Location:** [TopBar.tsx:119-125](components/workbench/TopBar.tsx#L119-L125)

**Problem:**
Search input uses `defaultValue={searchQuery}` making it uncontrolled. If `searchQuery` in the Zustand store is updated externally, the input won't reflect the change.

---

## Suggestions

### S1: Extract SSE Streaming Logic

**Location:** [ChatPanel.tsx:40-91](components/chat/ChatPanel.tsx#L40-L91)

60+ lines of imperative SSE parsing inline. Extract to a `useChatStream` hook for reusability and testability.

---

### S2: Add Loading Skeletons

**Location:** [LoadingSpinner.tsx](components/LoadingSpinner.tsx)

Replace the generic spinner with shimmer/skeleton states that match the layout shape of what's loading. This improves perceived performance significantly.

---

### S3: Memoize Card Components

**Location:** [FocusedThreadCard.tsx](components/hierarchy/FocusedThreadCard.tsx), [CompactThreadCard.tsx](components/hierarchy/CompactThreadCard.tsx)

Neither card component is memoized. Wrapping in `memo` prevents unnecessary re-renders when parent state changes (e.g. search, chat toggle).

---

### S4: Virtualize Long Lists

If thread surfaces or chat messages grow large, both `LeftRail` thread list and `ChatPanel` message list would benefit from virtualization (e.g. `@tanstack/react-virtual`).

---

## Positive Observations

- **Cohesive dark aesthetic** — The dark hex palette (`#060a12`, `#08101d`, `#050c17`) with blue/emerald/amber accents creates a distinctive, professional look
- **Button CVA system** — 7 semantic variants with consistent hover/focus states, well-implemented
- **Mono-label convention** — `font-mono text-[11px] uppercase tracking-[0.2em]` labels throughout give a strong identity
- **Responsive drawer pattern** — LeftRail/Inspector mobile drawers with backdrop are well-structured
- **Chat message differentiation** — User (blue border) vs assistant (slate border) bubbles are immediately distinguishable
- **WorkbenchShell tests** — Good structural tests verifying data-regions and accessibility labels
- **Error boundary pattern** — Chat panel has inline error display with semantic rose coloring

---

## Priority Action Order

1. **Fix `handleDiscard` no-op** (C2) — 5 min fix, high UX impact
2. **Align EmptyState + LoadingSpinner tokens** (C1) — 15 min, eliminates visual split
3. **Remove `font-['Inter']` override** (M1) — 2 min fix
4. **Add Apply loading state** (M5) — 10 min fix
5. **Format ActionCard args** (M3) — 15 min fix
6. **Align search bar styling** (M2) — 5 min fix
7. **Improve StatBar visual range** (M4) — 30 min design + implementation

---

_Generated by UI Design Review. Run `/ui-design:design-review` again after fixes._
