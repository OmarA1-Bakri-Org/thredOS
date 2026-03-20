# thredOS Desktop Release Checklist

## Core gates

- `bun run typecheck`
- `bun test test/api/hosted-auth-routes.test.ts`
- `bun test lib/local-first/cloud-boundary.test.ts`
- `bun test lib/local-first/activation-sessions.test.ts`
- `bun run build`
- `bun run test:ui`

## Windows launch flow

- Install packaged `thredOS Desktop` build on a clean Windows machine.
- Verify first run creates or selects a local workspace.
- Verify desktop activation opens the external browser flow.
- Verify successful checkout returns to `/desktop/activate` and deep-links back into the desktop app.
- Verify the local workspace opens after activation.
- Verify offline launch works with an active entitlement cache.
- Verify expired or missing entitlement states are clear and non-destructive.

## Privacy boundary

- Confirm prompts, skills, sequence state, runtime logs, artifacts, and workspace files remain local.
- Confirm cloud payloads are limited to account/billing/activation plus canonical agent registration and performance.
- Confirm `Thread Runner` remains disabled for the Level 2 launch path.

## Visual gate

- Capture Playwright screenshot baselines for entry, activation, workbench, and runtime states.
- Run a final human Windows review at 100% and 125% display scaling.
- Confirm Node + Agent + Run panel readability in the launch build.
