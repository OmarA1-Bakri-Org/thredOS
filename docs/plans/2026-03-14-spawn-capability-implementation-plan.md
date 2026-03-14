# Spawn Capability as Agent Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make spawn a user-granted skill on the agent definition. If an agent has the spawn skill, the runtime automatically creates a child thread surface (new plane, new type) when that agent's step executes. Agents without spawn are denied.

**Architecture:** Spawn becomes a `ThreadSkillBadge` entry (`{ id: 'spawn', label: 'Spawn', inherited: false }`) in the agent's `metadata.skills` array. The runtime checks for this skill at step execution time and auto-creates child surfaces. The existing `SpawnChildEventSchema` runtime events from non-spawn agents are rejected. UI uses existing `SkillBadgeRow` with a new icon.

**Tech Stack:** TypeScript, Zod, Bun test runner, React (lucide-react icons)

---

### Task 1: Add `hasSpawnSkill` helper to projections

**Files:**
- Modify: `lib/thread-surfaces/projections.ts:261-270`
- Test: `lib/thread-surfaces/projections.test.ts`

**Step 1: Write the failing test**

Add to `lib/thread-surfaces/projections.test.ts`:

```typescript
import { hasSpawnSkill } from './projections'
import type { AgentRegistration } from '../agents/types'

describe('hasSpawnSkill', () => {
  test('returns true when agent has spawn in metadata.skills', () => {
    const agent: AgentRegistration = {
      id: 'agt-1',
      name: 'Spawner',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: {
        skills: [
          { id: 'search', label: 'Search', inherited: false },
          { id: 'spawn', label: 'Spawn', inherited: false },
        ],
      },
    }
    expect(hasSpawnSkill(agent)).toBe(true)
  })

  test('returns false when agent has no spawn skill', () => {
    const agent: AgentRegistration = {
      id: 'agt-2',
      name: 'Worker',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: {
        skills: [
          { id: 'search', label: 'Search', inherited: false },
        ],
      },
    }
    expect(hasSpawnSkill(agent)).toBe(false)
  })

  test('returns false when agent is null', () => {
    expect(hasSpawnSkill(null)).toBe(false)
  })

  test('returns false when agent has no metadata', () => {
    const agent: AgentRegistration = {
      id: 'agt-3',
      name: 'Bare',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
    }
    expect(hasSpawnSkill(agent)).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/projections.test.ts`
Expected: FAIL — `hasSpawnSkill` is not exported

**Step 3: Write minimal implementation**

Add to `lib/thread-surfaces/projections.ts` after `resolveSkillsForAgent`:

```typescript
/**
 * Check whether an agent has been granted the spawn skill.
 * Spawn-skilled agents automatically create child thread surfaces
 * when their step executes.
 */
export function hasSpawnSkill(agent: AgentRegistration | null): boolean {
  const skills = resolveSkillsForAgent(agent)
  return skills.some(s => s.id === 'spawn')
}
```

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/projections.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/projections.ts lib/thread-surfaces/projections.test.ts
git commit -m "feat(spawn): add hasSpawnSkill helper to projections"
```

---

### Task 2: Guard `deriveSpawnSpecsForStep` with spawn skill check

**Files:**
- Modify: `lib/thread-surfaces/spawn-runtime.ts:20-65`
- Test: `lib/thread-surfaces/spawn-runtime.test.ts`

**Step 1: Write the failing test**

Add to `lib/thread-surfaces/spawn-runtime.test.ts`:

```typescript
import type { AgentRegistration } from '../agents/types'

function makeAgent(overrides: Partial<AgentRegistration> & { skills?: Array<{ id: string; label: string; inherited: boolean }> } = {}): AgentRegistration {
  const { skills, ...rest } = overrides
  return {
    id: 'agt-test',
    name: 'Test Agent',
    registeredAt: '2026-03-14T00:00:00.000Z',
    builderId: 'omar',
    builderName: 'Omar',
    threadSurfaceIds: [],
    metadata: skills ? { skills } : undefined,
    ...rest,
  }
}

test('deriveSpawnSpecsForStep returns empty when agent lacks spawn skill', () => {
  const orchestrator = makeStep({
    id: 'orch-orchestrator',
    name: 'Orchestrator',
    type: 'b',
    orchestrator: 'orch-orchestrator',
  })
  const worker = makeStep({
    id: 'orch-worker-1',
    name: 'Worker 1',
    type: 'b',
    depends_on: ['orch-orchestrator'],
    orchestrator: 'orch-orchestrator',
  })
  const agent = makeAgent({
    id: 'agt-no-spawn',
    metadata: { skills: [{ id: 'search', label: 'Search', inherited: false }] },
  })

  const specs = deriveSpawnSpecsForStep({
    sequence: makeSequence([orchestrator, worker]),
    step: orchestrator,
    agent,
  })

  expect(specs).toEqual([])
})

test('deriveSpawnSpecsForStep returns specs when agent has spawn skill', () => {
  const orchestrator = makeStep({
    id: 'orch-orchestrator',
    name: 'Orchestrator',
    type: 'b',
    orchestrator: 'orch-orchestrator',
  })
  const worker = makeStep({
    id: 'orch-worker-1',
    name: 'Worker 1',
    type: 'b',
    depends_on: ['orch-orchestrator'],
    orchestrator: 'orch-orchestrator',
  })
  const agent = makeAgent({
    id: 'agt-spawner',
    metadata: { skills: [{ id: 'spawn', label: 'Spawn', inherited: false }] },
  })

  const specs = deriveSpawnSpecsForStep({
    sequence: makeSequence([orchestrator, worker]),
    step: orchestrator,
    agent,
  })

  expect(specs).toHaveLength(1)
  expect(specs[0]).toEqual(expect.objectContaining({
    childAgentNodeId: 'orch-worker-1',
    spawnKind: 'orchestrator',
  }))
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/spawn-runtime.test.ts`
Expected: FAIL — `agent` is not a recognized property in `DeriveSpawnSpecsForStepArgs`

**Step 3: Write minimal implementation**

Modify `lib/thread-surfaces/spawn-runtime.ts`:

```typescript
import type { Sequence, Step } from '@/lib/sequence/schema'
import type { AgentRegistration } from '@/lib/agents/types'
import { hasSpawnSkill } from '@/lib/thread-surfaces/projections'

export type SpawnKind = 'orchestrator' | 'watchdog' | 'fanout'

export interface SpawnSpec {
  parentThreadSurfaceId: string
  childThreadSurfaceId: string
  parentAgentNodeId: string
  childAgentNodeId: string
  childSurfaceLabel: string
  spawnKind: SpawnKind
  order: number
}

interface DeriveSpawnSpecsForStepArgs {
  sequence: Sequence
  step: Step
  agent: AgentRegistration | null
}

export function deriveSpawnSpecsForStep({ sequence, step, agent }: DeriveSpawnSpecsForStepArgs): SpawnSpec[] {
  if (!hasSpawnSkill(agent)) {
    return []
  }

  // ... rest of existing logic unchanged
```

**Important:** The existing tests that call `deriveSpawnSpecsForStep` without `agent` will fail. Update them to pass `agent: null`. Since `hasSpawnSkill(null)` returns `false`, those tests that expect non-empty results need an agent with spawn skill. Update the existing tests:

- `makeAgent` helper with spawn skill for tests expecting specs
- Pass `agent: null` for the "plain steps produce no spawn specs" test (already expects `[]`)

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/spawn-runtime.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add lib/thread-surfaces/spawn-runtime.ts lib/thread-surfaces/spawn-runtime.test.ts
git commit -m "feat(spawn): guard deriveSpawnSpecsForStep with spawn skill check"
```

---

### Task 3: Guard `persistRuntimeDelegationEvents` against non-spawn agents

**Files:**
- Modify: `lib/thread-surfaces/step-run-runtime.ts:143-229`
- Test: `lib/thread-surfaces/step-run-runtime.test.ts`

**Step 1: Write the failing test**

Add to `lib/thread-surfaces/step-run-runtime.test.ts`:

```typescript
import type { AgentRegistration } from '../agents/types'

test('finalizeStepRunWithRuntimeEvents rejects spawn-child events from agents without spawn skill', () => {
  const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
    surfaceId: 'thread-root',
    surfaceLabel: 'Sequence',
    createdAt: '2026-03-09T10:00:00.000Z',
    runId: 'run-root',
    startedAt: '2026-03-09T10:00:00.000Z',
    executionIndex: 1,
  }).state

  const agent: AgentRegistration = {
    id: 'agt-no-spawn',
    name: 'No Spawn Agent',
    registeredAt: '2026-03-14T00:00:00.000Z',
    builderId: 'omar',
    builderName: 'Omar',
    threadSurfaceIds: [],
    metadata: { skills: [{ id: 'search', label: 'Search', inherited: false }] },
  }

  const runtimeEvents: RuntimeDelegationEvent[] = [{
    eventType: 'spawn-child',
    createdAt: '2026-03-09T10:01:05.000Z',
    childStepId: 'child-step',
    childLabel: 'Child Step',
    spawnKind: 'orchestrator',
  }]

  const result = finalizeStepRunWithRuntimeEvents(started, {
    step: buildStep(),
    stepRun: null,
    success: true,
    endedAt: '2026-03-09T10:01:10.000Z',
    runtimeEvents,
    nextRunId: () => 'run-generated',
    nextEventId: () => 'event-generated',
    nextMergeId: () => 'merge-generated',
    agent,
  })

  // Spawn-child events should be filtered out — no child surface created
  expect(result.state.threadSurfaces.map(s => s.id)).not.toContain('thread-child-step')
  expect(result.pendingChildSequences).toEqual([])
  // A spawn-denied event should be recorded
  expect(result.state.runEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        eventType: 'spawn-denied',
      }),
    ]),
  )
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/step-run-runtime.test.ts`
Expected: FAIL — `agent` is not a property of `FinalizeStepRunOptions`

**Step 3: Write minimal implementation**

In `lib/thread-surfaces/step-run-runtime.ts`:

1. Add `agent` to `FinalizeStepRunOptions`:
```typescript
interface FinalizeStepRunOptions {
  step: Step
  stepRun: StepRunScope | null
  success: boolean
  endedAt: string
  runtimeEvents: RuntimeDelegationEvent[]
  nextRunId: () => string
  nextEventId: () => string
  nextMergeId: () => string
  agent?: AgentRegistration | null
}
```

2. Import `hasSpawnSkill` and `AgentRegistration`
3. In `persistRuntimeDelegationEvents`, add the agent parameter and filter spawn events:

```typescript
function persistRuntimeDelegationEvents(
  state: ThreadSurfaceState,
  stepRun: StepRunScope,
  step: Step,
  runtimeEvents: RuntimeDelegationEvent[],
  ids: { nextRunId: () => string; nextEventId: () => string; nextMergeId: () => string },
  agent?: AgentRegistration | null,
): { state: ThreadSurfaceState; pendingChildSequences: PendingChildSequence[] } {
  let nextState = state
  const pendingChildSequences: PendingChildSequence[] = []
  const canSpawn = hasSpawnSkill(agent ?? null)

  for (const event of runtimeEvents) {
    if (event.eventType === 'spawn-child') {
      if (!canSpawn) {
        // Record spawn-denied event
        nextState = {
          ...nextState,
          runEvents: [
            ...nextState.runEvents,
            {
              id: ids.nextEventId(),
              eventType: 'spawn-denied',
              runId: stepRun.runId,
              threadSurfaceId: stepRun.threadSurfaceId,
              createdAt: event.createdAt,
              metadata: { reason: 'agent lacks spawn skill', childStepId: event.childStepId },
            },
          ],
        }
        continue
      }
      // ... existing spawn logic unchanged
```

4. Add `'spawn-denied'` to the `RunEvent` eventType union in `lib/thread-surfaces/types.ts`

5. Thread `agent` through from `finalizeStepRunWithRuntimeEvents` to `persistRuntimeDelegationEvents`

**Step 4: Update existing tests**

Existing tests that pass `runtimeEvents` with `spawn-child` need `agent` with spawn skill:

```typescript
// Add to existing spawn tests:
const spawnAgent: AgentRegistration = {
  id: 'agt-spawner',
  name: 'Spawner',
  registeredAt: '2026-03-14T00:00:00.000Z',
  builderId: 'omar',
  builderName: 'Omar',
  threadSurfaceIds: [],
  metadata: { skills: [{ id: 'spawn', label: 'Spawn', inherited: false }] },
}

// Pass agent: spawnAgent in the opts
```

**Step 5: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/step-run-runtime.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add lib/thread-surfaces/step-run-runtime.ts lib/thread-surfaces/step-run-runtime.test.ts lib/thread-surfaces/types.ts
git commit -m "feat(spawn): deny spawn-child events from agents without spawn skill"
```

---

### Task 4: Auto-create child surface for spawn-skilled agents at step start

**Files:**
- Modify: `lib/thread-surfaces/step-run-runtime.ts:33-62`
- Test: `lib/thread-surfaces/step-run-runtime.test.ts`

**Step 1: Write the failing test**

```typescript
test('beginStepRunIfSurfaceExists auto-creates child surface for spawn-skilled agents', () => {
  const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
    surfaceId: 'thread-root',
    surfaceLabel: 'Sequence',
    createdAt: '2026-03-09T10:00:00.000Z',
    runId: 'run-root',
    startedAt: '2026-03-09T10:00:00.000Z',
    executionIndex: 1,
  }).state

  const spawnAgent: AgentRegistration = {
    id: 'agt-spawner',
    name: 'Spawner',
    registeredAt: '2026-03-14T00:00:00.000Z',
    builderId: 'omar',
    builderName: 'Omar',
    threadSurfaceIds: [],
    metadata: { skills: [{ id: 'spawn', label: 'Spawn', inherited: false }] },
  }

  const result = beginStepRunIfSurfaceExists(started, buildStep(), {
    now: '2026-03-09T10:01:00.000Z',
    nextRunId: 'run-step',
    executionIndex: 2,
    agent: spawnAgent,
  })

  // Should have created the thread surface automatically
  expect(result.stepRun).not.toBeNull()
  expect(result.state.threadSurfaces.map(s => s.id)).toContain('thread-step-a')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/step-run-runtime.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Modify `beginStepRunIfSurfaceExists` to accept optional `agent` and auto-create surface:

```typescript
interface BeginStepRunOptions {
  now: string
  nextRunId: string
  executionIndex?: number
  agent?: AgentRegistration | null
}

export function beginStepRunIfSurfaceExists(
  state: ThreadSurfaceState,
  step: Step,
  opts: BeginStepRunOptions,
): { state: ThreadSurfaceState; stepRun: StepRunScope | null } {
  const threadSurfaceId = deriveStepThreadSurfaceId(step.id)
  let existingSurface = state.threadSurfaces.find(surface => surface.id === threadSurfaceId) ?? null
  let nextState = state

  // Auto-create child surface for spawn-skilled agents
  if (existingSurface == null && hasSpawnSkill(opts.agent ?? null)) {
    nextState = createChildThreadSurfaceRun(nextState, {
      parentSurfaceId: ROOT_THREAD_SURFACE_ID,
      parentAgentNodeId: step.id,
      childSurfaceId: threadSurfaceId,
      childSurfaceLabel: step.name,
      createdAt: opts.now,
      runId: opts.nextRunId,
      startedAt: opts.now,
      executionIndex: opts.executionIndex ?? nextState.runs.length + 1,
    }).state
    return {
      state: nextState,
      stepRun: {
        runId: opts.nextRunId,
        startedAt: opts.now,
        executionIndex: opts.executionIndex ?? state.runs.length + 1,
        threadSurfaceId,
      },
    }
  }

  if (existingSurface == null) {
    return { state, stepRun: null }
  }

  // ... existing replacement run logic
```

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/step-run-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/step-run-runtime.ts lib/thread-surfaces/step-run-runtime.test.ts
git commit -m "feat(spawn): auto-create child surface for spawn-skilled agents at step start"
```

---

### Task 5: Add spawn icon to `SkillBadgeRow`

**Files:**
- Modify: `components/skills/SkillBadgeRow.tsx:1-19`
- Test: `components/skills/SkillBadgeRow.test.tsx`

**Step 1: Write the failing test**

Add to `components/skills/SkillBadgeRow.test.tsx`:

```typescript
test('renders spawn skill badge with GitBranch icon', () => {
  const skills = [{ id: 'spawn', label: 'Spawn', inherited: false }]
  const markup = renderToStaticMarkup(<SkillBadgeRow skills={skills} />)
  expect(markup).toContain('skill-badge-spawn')
  expect(markup).toContain('Spawn')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test components/skills/SkillBadgeRow.test.tsx`
Expected: PASS (existing fallback `Box` icon renders) — but we want the specific `GitBranch` icon

**Step 3: Write minimal implementation**

In `components/skills/SkillBadgeRow.tsx`:

```typescript
import { Box, Bot, Folder, GitBranch, Globe, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'

const skillIcons = {
  search: Search,
  browser: Globe,
  files: Folder,
  tools: Wrench,
  model: Bot,
  review: ShieldCheck,
  orchestration: Sparkles,
  spawn: GitBranch,
} as const
```

**Step 4: Run test to verify it passes**

Run: `bun test components/skills/SkillBadgeRow.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add components/skills/SkillBadgeRow.tsx components/skills/SkillBadgeRow.test.tsx
git commit -m "feat(spawn): add GitBranch icon for spawn skill badge"
```

---

### Task 6: Add `spawn-denied` to RunEvent types

**Files:**
- Modify: `lib/thread-surfaces/types.ts`
- Test: `lib/thread-surfaces/types.test.ts`

**Step 1: Write the failing test**

Add to `lib/thread-surfaces/types.test.ts`:

```typescript
test('RunEvent accepts spawn-denied eventType', () => {
  const event: RunEvent = {
    id: 'evt-denied',
    eventType: 'spawn-denied',
    runId: 'run-1',
    threadSurfaceId: 'thread-step-a',
    createdAt: '2026-03-14T00:00:00.000Z',
    metadata: { reason: 'agent lacks spawn skill', childStepId: 'child-1' },
  }
  expect(event.eventType).toBe('spawn-denied')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/thread-surfaces/types.test.ts`
Expected: FAIL — TypeScript type error, `'spawn-denied'` not assignable

**Step 3: Write minimal implementation**

In `lib/thread-surfaces/types.ts`, find the `RunEvent` type and add `'spawn-denied'` to its `eventType` union. The exact location depends on how `eventType` is defined — look for the union type and add the new variant.

**Step 4: Run test to verify it passes**

Run: `bun test lib/thread-surfaces/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/thread-surfaces/types.ts lib/thread-surfaces/types.test.ts
git commit -m "feat(spawn): add spawn-denied RunEvent type"
```

---

### Task 7: Update callers of `deriveSpawnSpecsForStep` to pass agent

**Files:**
- Search for all callers: `grep -r "deriveSpawnSpecsForStep" --include="*.ts" --include="*.tsx"`
- Update each caller to pass the `agent` parameter

**Step 1: Find all callers**

Run: `grep -r "deriveSpawnSpecsForStep" --include="*.ts" --include="*.tsx" lib/ app/ components/`

**Step 2: Update each caller**

For each caller, resolve the agent from the agent repository and pass it through. The exact changes depend on the call sites found.

**Step 3: Run full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(spawn): thread agent through all deriveSpawnSpecsForStep callers"
```

---

### Task 8: Integration verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass, 0 failures

**Step 2: Type check**

Run: `bun run check`
Expected: No type errors

**Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix(spawn): integration fixes from full test suite"
```
