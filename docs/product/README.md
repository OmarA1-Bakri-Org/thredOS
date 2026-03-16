# Product Documentation Pack

This folder is the repo-truth documentation set for the product as it exists now.

Use it when you need to answer four questions quickly:

- what ThreadOS is
- what is actually built
- what is still partial or coming soon
- where the important architecture lives in the repo

## Ground Rules

- ThreadOS is the active product today.
- Thread Runner is intentionally visible, but still a locked future product surface.
- When older PRDs, plans, or prototype notes conflict with the live app and code, trust this pack and then verify against the repo.

## Recommended Reading Order

1. [Founder Overview](./founder-overview.md)
2. [Current State of the Product](./current-state.md)
3. [Product Narrative](./product-narrative.md)
4. [Architecture Map](./architecture-map.md)
5. [Developer Onboarding](./developer-onboarding.md)

## What Each Doc Does

- [Founder Overview](./founder-overview.md): the short business and product explanation
- [Current State of the Product](./current-state.md): the blunt implementation status page
- [Architecture Map](./architecture-map.md): the technical subsystem map and data flow
- [Product Narrative](./product-narrative.md): the canonical vocabulary for ThreadOS, Thread Runner, threads, surfaces, runs, packs, and builders
- [Developer Onboarding](./developer-onboarding.md): how to install, run, verify, and navigate the codebase

## Primary Repo Anchors

- `app/page.tsx` is the top-level product entry and shell switch.
- `components/` contains the workbench, hierarchy, lanes, inspector, chat, and entry UI.
- `app/api/` exposes the local API used by the UI.
- `lib/ui/` contains the React Query bridge and UI store.
- `lib/seqctl/` is the CLI control plane.
- `lib/thread-surfaces/` contains the runtime model for surfaces, runs, merges, and runtime events.
- `.threados/` is the local state directory for sequence data, prompts, runs, policy, and runtime state.
