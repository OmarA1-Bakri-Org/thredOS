# Design: Spawn Capability as Agent Skill

**Date:** 2026-03-14
**Status:** Approved
**Author:** Omar Al-Bakri + Claude

---

## Problem

No per-agent spawn permission exists. Any agent can write `spawn-child` to its runtime event log and children get created, subject only to global policy limits. The user has no way to control which agents produce child thread planes.

The user's directive: **the agent does not decide to spawn children. The user grants the agent the ability. If spawn is assigned, the agent will use it — it is not optional.**

## Decision

Spawn is a **skill** on the agent definition, using the existing `ThreadSkillBadge` system in `metadata.skills`.

```typescript
{ id: 'spawn', label: 'Spawn', inherited: false }
```

## Semantics

- **Granting spawn** = the user saying "this agent WILL produce a child thread plane when it runs"
- **No spawn skill** = the agent cannot spawn, period. Runtime events requesting spawn are denied.
- **`inherited: false`** (default) = child agents do NOT automatically get spawn. Each agent must be explicitly granted.
- **`inherited: true`** = child agents inherit spawn from parent (opt-in by user).

## Execution Model

When a step runs and its agent has the `spawn` skill:

1. Runtime resolves agent skills via `resolveSkillsForAgent(agent)`
2. If `'spawn'` is present → **automatically create child thread surface**
3. The child gets:
   - A new **thread surface** (new plane) with its own `threadSurfaceId`
   - A new **thread type** derived from the step's fields (`orchestrator` → orchestrated, `watchdog_for` → watchdog, `fanout` → parallel, etc.)
   - Its own sequence YAML provisioned on disk
4. If `'spawn'` is NOT present and the agent emits a `spawn-child` runtime event → **denied**, `spawn-denied` RunEvent emitted

## Enforcement Points

| Location | File | Action |
|----------|------|--------|
| Step start | `lib/thread-surfaces/step-run-runtime.ts` | Check spawn skill, create child surface if present |
| Runtime event processing | `lib/thread-surfaces/step-run-runtime.ts` | Reject `spawn-child` events from non-spawn agents |
| Static derivation | `lib/thread-surfaces/spawn-runtime.ts` | Only derive spawn specs for spawn-skilled agents |

## Data Model

No new schema. Uses existing infrastructure:

- **Storage:** `metadata.skills` array in `AgentRegistration` (`agents.json`)
- **Resolution:** `resolveSkillsForAgent()` in `lib/thread-surfaces/projections.ts`
- **Default skills:** Spawn is NOT in `DEFAULT_SKILLS` — must be explicitly granted

## UI

Existing skill UI handles it with no new components:

- `SkillBadgeRow` renders the spawn badge (icon: `GitBranch` from lucide-react)
- `SkillInventoryPanel` shows spawn in local/inherited sections
- `FocusedThreadCard` displays spawn on the agent trading card
- Toggle in agent skill section to grant/revoke

## Policy Interaction

Global policy limits still apply on top of spawn skill:
- `max_spawn_depth: 10` — maximum nesting depth
- `max_children_per_surface: 20` — maximum children per parent
- `max_total_surfaces: 200` — global surface cap
- Warning events emitted at 80% of limits

## Files to Modify

1. `lib/thread-surfaces/projections.ts` — Add `'spawn'` to skill icon mapping
2. `lib/thread-surfaces/step-run-runtime.ts` — Add spawn skill check + auto-create child surface
3. `lib/thread-surfaces/spawn-runtime.ts` — Guard `deriveSpawnSpecsForStep` with spawn skill check
4. `components/skills/SkillBadgeRow.tsx` — Add `GitBranch` icon for spawn skill
5. `lib/agents/repository.ts` — No changes needed (metadata.skills already supports arbitrary skills)
6. Tests for all modified files
