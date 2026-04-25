# Apollo Pack Bootstrap Notes

## What was completed

- Created clean worktree:
  - `/mnt/c/Users/albak/xdev/thredOS-worktrees/apollo-pack`
  - branch: `feat/apollo-pack`
- Added starter pack manifest:
  - `.threados/packs/apollo-segment-builder/1.0.0/pack.yaml`
- Added 20 prompt stubs under:
  - `.threados/prompts/*.md`
- Copied the 7 required shared reference documents under:
  - `shared_references/*.md`
- Verified pack loader succeeds.
- Verified pack install succeeds after normalizing step IDs from snake_case to kebab-case.
- Extended pack schema to support:
  - `prerequisites`
  - `shared_references`
  - `rate_limits`
  - `timeouts`
  - `gates`
  - step `execution`
  - step `timeout_ms`
  - step `condition`
  - step `actions`
- Updated the Apollo pack draft to actually use those new fields.
- Added/ran loader tests proving the new schema fields parse correctly.
- Updated `compilePack` so compiled sequences now carry:
  - real sequence gates derived from pack gates
  - step `timeout_ms`
  - step `execution`
  - step `condition`
  - step `actions`
  - inferred `side_effect_class`
- Added/ran compiler tests proving those fields survive compile-time projection.
- Updated runtime selection/execution so it now consumes more compiled step metadata:
  - `run runnable` evaluates simple compiled conditions against `.threados/state/runtime-context.json`
  - `run step` / `run runnable` include a structured `THREADOS ACTION CONTRACT` block in the dispatched prompt when actions are present
- Added/ran runtime command tests for conditional runnable selection and action-contract prompt injection.
- Added/ran a dedicated Apollo pack integration test covering:
  - referenced asset existence
  - real pack load
  - real pack compile
  - real pack install
  - persisted gates and execution metadata after install

## Important finding

Current pack schema accepts step IDs that the sequence schema later rejects.

Observed failure before normalization:
- `ZodError: Step ID must contain only lowercase letters, numbers, and hyphens`

Implication:
- `lib/packs/pack-schema.ts` should eventually enforce the same step-id format as `lib/sequence/schema.ts`
- OR `lib/packs/compiler.ts` should sanitize/normalize IDs deterministically

## Task 1 smoke evidence

- Ran `bun .tmp/run_apollo_pack_smoke.ts` against the installed Apollo pack in a temp workspace; `run runnable` completed 10 steps and advanced through `review-approval` (`context7-review`, `health-check`, `register-agent`, `setup-workspace`, `pre-session`, `input-collection`, `apollo-saved-contacts-search`, `apollo-discovery`, `merge-dedup-comply`, `review-approval`).
- Ran a focused native-action smoke on `update-apollo-stages`; the runtime invoked native `APOLLO_UPDATE_CONTACT_STAGE`, persisted `stage_update_result` to `.threados/state/runtime-context.json`, and still dispatched the step prompt with the action contract block attached.

## Current installed Apollo draft

Installed sequence name:
- `Apollo Segment Builder Draft`

Installed pack:
- `apollo-segment-builder@1.0.0`

Installed shape:
- 20 steps
- 21 surfaces (root + 20 step surfaces)
- 7 phases
- policy ref: `SAFE`

## What the current pack captures successfully

- canonical pack identity
- phase ordering
- DAG dependency structure
- surface-class assignments
- prompt asset registration
- install/compile path into active sequence + surfaces

## What still needs schema/runtime work for faithful Apollo execution

### 1. Workflow prerequisites
Need pack-authored support for:
- required connections
- env vars
- health checks
- static key IDs

### 2. Real action contracts
Need step-level execution config for:
- CLI commands
- composio tools
- conditional branches
- approval actions
- sub-agent prompts / roles

### 3. Real gates
Need pack-authored gates with:
- `id`
- `type`
- `check`
- `on_fail`
- `message`
- retry semantics

### 4. Shared references
Need pack references for:
- compliance rules
- persona routing
- state management
- prospect selection
- cross-channel intel
- company info
- Context7 docs

### 5. Budgets and timing
Need runtime policy support for:
- workflow timeout
- step timeout
- Apollo credit ceilings
- contact volume caps

## Recommended next step

Extend the pack schema incrementally rather than jumping straight into full workflow execution:

1. add pack metadata for prerequisites + shared references
2. add pack gate definitions
3. add step action contracts
4. re-encode Apollo from `workflow.json` into those new fields
5. only then wire pack execution to actual CLI/tool runners
