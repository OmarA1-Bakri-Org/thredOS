# thredOS Desktop Release Checklist

## Core gates

- `bun run typecheck`
- `bun test test/api/hosted-auth-routes.test.ts`
- `bun test lib/local-first/cloud-boundary.test.ts`
- `bun test lib/local-first/activation-sessions.test.ts`
- `bun test lib/commercial/stripe.test.ts`
- `bun test lib/thread-surfaces/repository.test.ts`
- `bun test test/api/surface-proof-routes.test.ts`
- `bun test components/inspector/ThreadSurfaceInspector.test.tsx`
- `bun test components/workbench/sections/RunSection.test.tsx`
- `bun run build`
- `bun run test:ui`
- `bun run verify:ci`

## Windows launch flow

- Install packaged `thredOS Desktop` build on a clean Windows machine.
- Verify first run creates or selects a local workspace.
- Verify desktop activation opens the external browser flow.
- Verify successful checkout returns to `/desktop/activate` and deep-links back into the desktop app.
- Verify the local workspace opens after activation.
- Verify offline launch works with an active entitlement cache.
- Verify expired or missing entitlement states are clear and non-destructive.

## Verification program

- `bun run dev:wsl` when operating from WSL on a repo mounted under `/mnt/*`; this is the supported desktop beta dev command.
- `bun run verify:local` from a native Linux filesystem copy when validating the deterministic dev flow.
- `bun run verify:ci` on the Linux production-parity runner before release promotion.
- `bun run verify:release-live` only in the gated release environment with real auth and billing secrets.
- Attach the verification evidence bundle from `test-results/verify/<mode>/<timestamp>/` to the release record.
- Evidence bundle must include:
  - Playwright JSON manifest
  - readiness probe output
  - server stdout/stderr logs
  - screenshots and traces for each suite
  - any operator notes required for live checkout completion
- Export evidence for a release-candidate run must include:
  - `.threados/exports/<runId>/bundle.json`
  - copied `trace.ndjson`
  - copied `approvals.ndjson` when present
  - copied `gate-decisions.ndjson`

## Privacy boundary

- Confirm prompts, skills, sequence state, runtime logs, artifacts, and workspace files remain local.
- Confirm cloud payloads are limited to account/billing/activation plus canonical agent registration and performance.
- Confirm `Thread Runner` remains disabled for the Level 2 launch path.

## Visual gate

- Playwright screenshot baselines must pass for:
  - entry surface
  - activation return
  - base workbench hierarchy
  - run section
  - responsive drawer at `1200x800`
  - top-bar `New` confirm dialog
  - top-bar `Run` confirm dialog
  - create step dialog
  - create gate dialog
  - chat panel open state
  - sequence section
  - sequence rename/edit state
  - node + agent overview state
  - node prompt asset state
  - node skills + agent tools state
  - agent roster tab
  - agent tools tab
- Axe checks must pass for:
  - entry surface
  - workbench surface
  - create node dialog
  - chat panel
- Run a final human Windows review at `100%`, `125%`, and `150%` display scaling.
- Manually confirm:
  - top bar stability during resize
  - accordion resize handle behavior
  - drawer open/close behavior
  - canvas hover/selection/detail cards
  - chat panel resize behavior
  - confirm dialog focus and dismissal behavior
  - Node + Agent + Run panel readability in the packaged build
  - live checkout completion and browser return back into desktop activation
  - Thread Surface inspector policy card readability
  - Run panel trace / approvals / export affordances
