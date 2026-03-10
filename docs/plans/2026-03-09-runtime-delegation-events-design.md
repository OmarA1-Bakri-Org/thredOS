# Runtime Delegation Events Design

## Summary
The current thread-surface runtime still manufactures child lanes from static sequence metadata (`orchestrator`, `watchdog_for`, `fanout`). That was a necessary bridge, but it is not the product truth we want. The next phase should make delegation a runtime fact: the agent that is actually running must emit a structured event when it creates, delegates to, or merges work into another thread.

## Problem
Today:
- API runtime derives child surfaces via `deriveSpawnSpecsForStep(...)` in [app/api/run/route.ts](C:/Users/OmarAl-Bakri/.config/superpowers/worktrees/THREAD-OS/coord-thread-surface-runtime-events/app/api/run/route.ts)
- CLI runtime mirrors the same inference in [lib/seqctl/commands/run.ts](C:/Users/OmarAl-Bakri/.config/superpowers/worktrees/THREAD-OS/coord-thread-surface-runtime-events/lib/seqctl/commands/run.ts)
- Runner/artifact infrastructure only persists generic process output in [lib/runner/wrapper.ts](C:/Users/OmarAl-Bakri/.config/superpowers/worktrees/THREAD-OS/coord-thread-surface-runtime-events/lib/runner/wrapper.ts) and [lib/runner/artifacts.ts](C:/Users/OmarAl-Bakri/.config/superpowers/worktrees/THREAD-OS/coord-thread-surface-runtime-events/lib/runner/artifacts.ts)

So the hierarchy is still inferred after the fact instead of being emitted by the runtime that actually delegated the work.

## Approaches
### 1. Parse stdout/stderr for structured delegation markers
Pros:
- no extra files
- minimal runner changes

Cons:
- mixes reasoning output with control-plane events
- fragile if models emit malformed or duplicated lines
- forces us to parse user-visible output as protocol

### 2. Add an explicit runtime event log file per step run
Pros:
- durable and deterministic
- keeps agent prose separate from orchestration events
- fits the existing artifact model cleanly
- easy to replay and debug after a run

Cons:
- requires a formal event contract and explicit prompt instructions
- agents must write a file, not just print text

### 3. Wrap agent CLIs in a sidecar controller that owns delegation directly
Pros:
- strongest long-term control
- less reliance on agent compliance

Cons:
- much larger architectural jump
- changes dispatch/runner semantics materially
- too much scope for this phase

## Recommendation
Use approach 2.

Add a JSONL runtime event log under the run artifact directory and make both API and CLI runtimes consume that log after each step finishes. Sequence metadata remains only as compatibility fallback while the new contract is phased in.

This is the smallest change that produces real runtime truth instead of inferred truth.

## Event Contract
Each executing step gets a dedicated event log path through env, for example:
- `THREADOS_EVENT_LOG=.threados/runs/<runId>/<stepId>/events.jsonl`

Each line is one JSON object. Initial event types:
- `spawn-child`
  - emitted when the current agent creates/delegates to a child thread
  - payload fields:
    - `childStepId`
    - `childLabel`
    - `spawnKind` (`orchestrator`, `watchdog`, `fanout`, later extensible)
    - optional `parentStepId` override when needed
- `merge-into`
  - emitted when the current agent merges work into an existing destination lane
  - payload fields:
    - `destinationStepId`
    - `sourceStepIds`
    - `mergeKind` (`single` or `block`)
    - optional `summary`

Invalid lines are ignored with audit visibility rather than crashing the run.

## Ownership Model
- Runner/artifacts own file location and persistence helpers.
- Prompt/compiler layer owns the agent-facing contract telling the model how to write events.
- Runtime event parser owns validation and translation from raw event lines to domain operations.
- API/CLI run handlers own consuming parsed events and mutating `ThreadSurfaceState`.

## Compatibility Strategy
Phase this safely:
1. introduce event log helpers and parser
2. introduce prompt/compiler instructions and env propagation
3. consume real runtime events first
4. keep metadata inference as fallback only when no runtime event log exists
5. once stable, remove fallback derivation

## Testing Strategy
- unit tests for JSONL event parsing and invalid-line handling
- runner/artifact tests for event-log path creation
- prompt compiler tests for the runtime event contract text
- API/CLI runtime tests proving runtime-emitted events win over static metadata
- regression test proving plain steps produce no child lanes unless an actual event was emitted

## Success Criteria
- child surfaces are created only from real runtime-emitted `spawn-child` events or temporary fallback when no event log exists
- merge events are created from runtime-emitted `merge-into` events
- API and CLI use the same event parsing path
- hierarchy/lane views continue to render from persisted thread-surface state with no UI-side fabrication
