# ThreadOS UI Upgrade + Thread Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the production ThreadOS shell, hierarchy/lane/layer surfaces, provider abstraction, and the first gated Thread Runner foundation on top of the existing thread-surface runtime.

**Architecture:** Keep one product shell with two entry paths: `ThreadOS` and locked `Thread Runner`. First establish a provider layer that supports the official OpenAI SDK and OpenRouter through one internal abstraction while preserving ThreadOS-native provenance and tracing. Then implement the ThreadOS UI on top of the existing thread-surface APIs and runtime truth, followed by Thread Runner gating, verified-run records, and the first proving-layer contracts without forking the underlying domain model.

**Tech Stack:** Next.js, React, TypeScript, shadcn/ui primitives, Radix UI, react-resizable-panels, TanStack Query, Zustand, lucide-react, OpenAI JavaScript SDK, OpenRouter OpenAI-compatible endpoint, existing thread-surface runtime modules

---

### Task 1: Add the provider abstraction and tracing contract

**Files:**
- Create: `lib/llm/providers/types.ts`
- Create: `lib/llm/providers/openai.ts`
- Create: `lib/llm/providers/openrouter.ts`
- Create: `lib/llm/providers/index.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `lib/llm/providers/openai.test.ts`
- Test: `lib/llm/providers/openrouter.test.ts`

**Step 1: Write the failing tests**
- Assert the provider layer can construct an OpenAI-backed client and an OpenRouter-backed client from environment configuration.
- Assert OpenRouter uses the OpenAI-compatible base URL path and does not require a separate runtime model.
- Assert tracing metadata can be attached without bypassing ThreadOS-native provenance.

**Step 2: Run the tests to verify failure**

Run: `bun test lib/llm/providers/openai.test.ts lib/llm/providers/openrouter.test.ts`  
Expected: FAIL because the provider layer does not exist.

**Step 3: Implement the provider layer**
- Add the official `openai` SDK.
- Add an OpenRouter adapter using the same OpenAI-compatible client pattern.
- Keep tracing/provider metadata behind a shared contract so future OpenAI Agents SDK adoption remains optional instead of entangled with the rest of the app.

**Step 4: Run the tests to verify pass**

Run: `bun test lib/llm/providers/openai.test.ts lib/llm/providers/openrouter.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/llm/providers package.json .env.example
git commit -m "feat: add openai and openrouter provider layer"
```

### Task 2: Refresh the product shell contract in code

**Files:**
- Modify: `app/page.tsx`
- Create: `components/workbench/WorkbenchShell.tsx`
- Create: `components/workbench/TopBar.tsx`
- Create: `components/workbench/LeftRail.tsx`
- Create: `components/workbench/InspectorRail.tsx`
- Modify: `lib/ui/store.ts`
- Test: `components/workbench/WorkbenchShell.test.tsx`

**Step 1: Write the failing test**
- Assert the shell renders a top bar, left rail, center board region, and right inspector rail.

**Step 2: Run the test to verify failure**

Run: `bun test components/workbench/WorkbenchShell.test.tsx`  
Expected: FAIL because the shell component does not exist.

**Step 3: Implement the shell**
- Add a stable workbench layout using hard-corner containers and top-pill metadata.
- Extend UI state with active product entry (`threados` vs `thread-runner`) and active board (`hierarchy`, `lanes`, `layers`).

**Step 4: Run the test to verify pass**

Run: `bun test components/workbench/WorkbenchShell.test.tsx`  
Expected: PASS.

**Step 5: Commit**

```bash
git add app/page.tsx components/workbench lib/ui/store.ts
git commit -m "feat: add threados workbench shell"
```

### Task 3: Replace the prototype hierarchy focus with production components

**Files:**
- Modify: `components/hierarchy/HierarchyView.tsx`
- Create: `components/hierarchy/FocusedThreadCard.tsx`
- Create: `components/hierarchy/CompactThreadCard.tsx`
- Modify: `components/hierarchy/useHierarchyGraph.ts`
- Test: `components/hierarchy/FocusedThreadCard.test.tsx`
- Test: `components/hierarchy/HierarchyView.test.tsx`

**Step 1: Write failing tests**
- Cover compact card rendering and focused-card centralization state.
- Assert the focused card includes builder, pack, badges, skill icons, Thread Power, Weight, and rubric bars.

**Step 2: Run tests to verify failure**

Run: `bun test components/hierarchy/FocusedThreadCard.test.tsx components/hierarchy/HierarchyView.test.tsx`  
Expected: FAIL because these components and behaviors are incomplete.

**Step 3: Implement hierarchy production UI**
- Port the approved card anatomy from the prototype.
- Keep top badges rounded and all structural containers square.
- Preserve dim/blur background behavior on focus.

**Step 4: Run tests to verify pass**

Run: `bun test components/hierarchy/FocusedThreadCard.test.tsx components/hierarchy/HierarchyView.test.tsx`  
Expected: PASS.

**Step 5: Commit**

```bash
git add components/hierarchy
git commit -m "feat: implement focused hierarchy cards"
```

### Task 4: Productionize the lane board and inspector pairing

**Files:**
- Modify: `components/lanes/LaneBoardView.tsx`
- Modify: `components/lanes/useLaneBoard.ts`
- Create: `components/inspector/ThreadInspector.tsx`
- Modify: `components/canvas/SequenceCanvas.tsx`
- Test: `components/lanes/LaneBoardView.test.tsx`
- Test: `components/inspector/ThreadInspector.test.tsx`

**Step 1: Write failing tests**
- Assert lane rows remain ordered by run-scoped execution semantics.
- Assert merged lanes remain visible and destination lanes stay above them.
- Assert inspector shows selected thread, run, skills used this run, and provenance.

**Step 2: Run tests to verify failure**

Run: `bun test components/lanes/LaneBoardView.test.tsx components/inspector/ThreadInspector.test.tsx`  
Expected: FAIL.

**Step 3: Implement the production lane board and inspector**
- Align the lane board to the approved structured timeline pattern.
- Promote the inspector from step-only details to thread/run/provenance/skills detail.

**Step 4: Run tests to verify pass**

Run: `bun test components/lanes/LaneBoardView.test.tsx components/inspector/ThreadInspector.test.tsx`  
Expected: PASS.

**Step 5: Commit**

```bash
git add components/lanes components/inspector components/canvas
git commit -m "feat: implement lane board and thread inspector"
```

### Task 5: Add the skills surface to the left rail and inspector

**Files:**
- Create: `components/skills/SkillInventoryPanel.tsx`
- Create: `components/skills/SkillBadgeRow.tsx`
- Modify: `lib/thread-surfaces/types.ts`
- Modify: `lib/thread-surfaces/projections.ts`
- Modify: `lib/ui/api.ts`
- Test: `components/skills/SkillInventoryPanel.test.tsx`
- Test: `lib/thread-surfaces/projections.test.ts`

**Step 1: Write failing tests**
- Assert threads can surface direct and inherited skills distinctly.
- Assert the left rail and inspector can read both available skills and used-in-run skill events.

**Step 2: Run tests to verify failure**

Run: `bun test components/skills/SkillInventoryPanel.test.tsx lib/thread-surfaces/projections.test.ts`  
Expected: FAIL.

**Step 3: Implement the skill UI layer**
- Reuse the icon-first inventory approach from the approved prototype.
- Keep the left rail stable: Thread Navigator, Tools / Activity, Skills.

**Step 4: Run tests to verify pass**

Run: `bun test components/skills/SkillInventoryPanel.test.tsx lib/thread-surfaces/projections.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add components/skills lib/thread-surfaces lib/ui/api.ts
git commit -m "feat: add thread skill inventory surfaces"
```

### Task 6: Add entry gating and locked Thread Runner affordances

**Files:**
- Create: `components/entry/EntranceScreen.tsx`
- Create: `components/thread-runner/ThreadRunnerGate.tsx`
- Create: `app/api/thread-runner/eligibility/route.ts`
- Modify: `app/page.tsx`
- Modify: `lib/ui/store.ts`
- Test: `components/entry/EntranceScreen.test.tsx`
- Test: `test/api/thread-runner-eligibility-route.test.ts`

**Step 1: Write failing tests**
- Assert the entrance screen shows `ThreadOS` and locked `Thread Runner`.
- Assert the eligibility endpoint returns locked/unlocked state based on registration and subscription records.

**Step 2: Run tests to verify failure**

Run: `bun test components/entry/EntranceScreen.test.tsx test/api/thread-runner-eligibility-route.test.ts`  
Expected: FAIL.

**Step 3: Implement the gate**
- Add the entrance screen and top-right mode affordance.
- Keep Thread Runner visible but inaccessible until eligibility is satisfied.

**Step 4: Run tests to verify pass**

Run: `bun test components/entry/EntranceScreen.test.tsx test/api/thread-runner-eligibility-route.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add components/entry components/thread-runner app/api/thread-runner lib/ui/store.ts app/page.tsx
git commit -m "feat: add thread runner entry gating"
```

### Task 7: Introduce verified-run and competition domain records

**Files:**
- Create: `lib/thread-runner/types.ts`
- Create: `lib/thread-runner/repository.ts`
- Create: `app/api/thread-runner/races/route.ts`
- Create: `app/api/thread-runner/results/route.ts`
- Test: `lib/thread-runner/repository.test.ts`
- Test: `test/api/thread-runner-races-route.test.ts`

**Step 1: Write failing tests**
- Cover verified combatant run persistence, race enrollment, and time-based result ordering.

**Step 2: Run tests to verify failure**

Run: `bun test lib/thread-runner/repository.test.ts test/api/thread-runner-races-route.test.ts`  
Expected: FAIL.

**Step 3: Implement minimal verified-run contracts**
- Add combatant runs, race records, division/classification fields, and qualifying placements.
- Do not build full cups or leagues yet.

**Step 4: Run tests to verify pass**

Run: `bun test lib/thread-runner/repository.test.ts test/api/thread-runner-races-route.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/thread-runner app/api/thread-runner
git commit -m "feat: add verified thread runner records"
```

### Task 8: Add pack and status surfaces to the model

**Files:**
- Create: `lib/packs/types.ts`
- Create: `lib/packs/repository.ts`
- Modify: `lib/thread-surfaces/types.ts`
- Create: `app/api/packs/route.ts`
- Test: `lib/packs/repository.test.ts`
- Test: `test/api/packs-route.test.ts`

**Step 1: Write failing tests**
- Assert pack records and highest-status display rules support:
  - Challenger Pack / Challenger status
  - Champion's Pack / Champion status
  - Hero Pack / Hero status

**Step 2: Run tests to verify failure**

Run: `bun test lib/packs/repository.test.ts test/api/packs-route.test.ts`  
Expected: FAIL.

**Step 3: Implement minimal pack/status persistence**
- Store builder attribution, pack type, classification/division scope, and highest status.
- Keep full history available without surfacing every status on primary views.

**Step 4: Run tests to verify pass**

Run: `bun test lib/packs/repository.test.ts test/api/packs-route.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/packs app/api/packs lib/thread-surfaces/types.ts
git commit -m "feat: add pack and status records"
```

### Task 9: Apply the approved visual system to the real app shell

**Files:**
- Modify: `app/globals.css`
- Create: `components/ui/threados-tokens.css` or equivalent styling module
- Modify: `components/workbench/*`
- Modify: `components/hierarchy/*`
- Modify: `components/lanes/*`
- Test: `test/ui/threados-shell.e2e.ts`

**Step 1: Write the failing UI verification test**
- Assert the real app renders the ThreadOS shell, hierarchy surface, focused card, and hard-corner geometry with rounded top pills only.

**Step 2: Run it to verify failure**

Run: `bun test test/ui/threados-shell.e2e.ts`  
Expected: FAIL.

**Step 3: Implement the production visual system**
- Bring the approved prototype decisions into the live app.
- Use shadcn/ui and existing primitives only as the implementation base, not as the visual identity.

**Step 4: Run tests to verify pass**

Run: `bun test test/ui/threados-shell.e2e.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add app/globals.css components/ui components/workbench components/hierarchy components/lanes test/ui/threados-shell.e2e.ts
git commit -m "feat: apply threados visual system"
```

### Task 10: Full verification and documentation pass

**Files:**
- Modify: `README.md`
- Modify: `PRODUCTION-PRD.md`
- Modify: relevant `docs/plans/*.md`
- Review: all files above

**Step 1: Update product documentation**
- Document ThreadOS vs Thread Runner.
- Document locked access, verified runs, packs, and status ladder.

**Step 2: Run full verification**

Run:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
```

Expected: all pass.

**Step 3: Commit final documentation and verification updates**

```bash
git add README.md PRODUCTION-PRD.md docs/plans
git commit -m "docs: finalize threados ui and thread runner plan"
```
