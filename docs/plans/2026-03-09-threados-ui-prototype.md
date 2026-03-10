# ThreadOS UI Prototype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce a research-backed UI prototype set for ThreadOS, including a component library, a main thread surface HTML mock, a focused thread card HTML mock, a design framework, and a wireframe.

**Architecture:** Keep the output separate from the production app implementation. Prototype in plain HTML/CSS under `docs/prototypes/threados-ui/` so the design can be reviewed without coupling it to React code. Use the design framework document as the source of truth for choices.

**Tech Stack:** Markdown, plain HTML, plain CSS

---

### Task 1: Lock the design framework

**Files:**
- Create: `docs/plans/2026-03-09-threados-ui-design-framework.md`
- Create: `docs/plans/2026-03-09-threados-ui-prototype.md`

**Step 1: Write the design framework**
Include the research references, the shell rules, the board definitions, the card anatomy, the skill model, the Thread Runner positioning, and the rationale behind each choice.

**Step 2: Write this implementation plan**
Capture the prototype file set and keep it independent from production components.

**Step 3: Review for consistency**
Make sure the terminology matches the approved design: `ThreadOS`, `Thread Runner`, `Thread Power`, `Weight`, `Challenger Pack`, `Champion's Pack`, `Hero Pack`.

### Task 2: Build the visual primitives

**Files:**
- Create: `docs/prototypes/threados-ui/prototype.css`
- Create: `docs/prototypes/threados-ui/components.html`

**Step 1: Define the CSS tokens**
Add typography, color, surface, glow, badge, stat-bar, and layout variables.

**Step 2: Build component examples**
Show examples for shell bar, left rail, badges, mode chips, skill inventory icons, focused/compact cards, stat bars, inspector blocks, actions, and competition rows.

**Step 3: Review component consistency**
Check that all components feel like one system, not a parts bin.

### Task 3: Build the main thread surface prototype

**Files:**
- Create: `docs/prototypes/threados-ui/thread-surface.html`

**Step 1: Compose the workbench shell**
Use the shell, left rail, main hierarchy focus area, and right inspector.

**Step 2: Show the focused hierarchy state**
Include the centralized top-trumps card, dimmed background topology, and peeking surrounding cards.

**Step 3: Review against design framework**
Verify that the screen feels like a control-system IDE and not a generic dashboard.

### Task 4: Build the focused card and wireframe artifacts

**Files:**
- Create: `docs/prototypes/threados-ui/thread-card.html`
- Create: `docs/prototypes/threados-ui/wireframe.html`

**Step 1: Build the isolated focused card**
Render the thread card as the primary review object.

**Step 2: Build the low-fidelity wireframe**
Show the shell regions, rail logic, board region, and inspector placement.

**Step 3: Review for readability**
The wireframe should explain layout, not style.

### Task 5: Verify and hand back

**Files:**
- Review only: the files above

**Step 1: Open or inspect the generated files**
Ensure they were written correctly and reference shared CSS where intended.

**Step 2: Run a file-level verification check**
Confirm the artifact set exists.

**Step 3: Return with file locations**
Report the created files and wait for the next instruction.
