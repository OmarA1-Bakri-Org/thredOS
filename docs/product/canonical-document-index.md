# thredOS Canonical Document Index

**Status:** Final  
**Document-set version:** 1.1  
**Date:** 2026-07-15  
**Repository:** `OmarA1-Bakri-Org/thredOS`

## Authoritative set

| Order | Document | Authority |
|---:|---|---|
| 1 | `docs/product/canonical-prd-worktree-free-parallel-runtime.md` | Product scope, architecture, locked decisions, requirements, milestones, and Desktop 1.0 acceptance |
| 2 | `AGENTS.md` | Mandatory repository conduct, implementation discipline, safety, validation, and contribution rules |
| 3 | `docs/plans/m0-m1-repository-implementation-plan.md` | Canonical repository delivery plan for Milestones 0–1 |
| 4 | `docs/plans/m0-m1-pr-manifest.yaml` | Machine-readable PR order, dependencies, files, and gates |

The PRD wins on product or architectural conflict. `AGENTS.md` wins on compatible repository-conduct and validation rules. The implementation plan elaborates Milestones 0–1. The manifest is subordinate to the prose plan.

## Reconfirmed decisions

1. thredOS removes the **user requirement** to manage Git worktrees and prohibits production runtime use of `git worktree`.
2. Git remains optional; dirty Git and non-Git workspaces are supported.
3. Parallel write-capable agents receive separate Surface Workspaces derived from one immutable baseline.
4. Agents never mutate the canonical workspace during isolated attempts.
5. Agent output converges through Change Sets and the merge/apply service, not branches.
6. API, CLI, chat/apply, and future MCP calls use one runtime service.
7. mprocs is optional observability and legacy compatibility, not runtime truth.
8. Isolation labels remain honest: portable copies are `THREADOS_SCOPED`; host-enforced profiles arrive later.
9. Milestones 0–1 build truthful runtime and workspace foundations **sequentially**. Milestone 3 activates real bounded concurrency.
10. Desktop 1.0 is not complete until concurrent execution, Change Sets, review, controlled apply, recovery, UI controls, and release proof all pass.

## Superseded material

This set supersedes earlier drafts and assistant recommendations in this project, including any recommendation to use Git worktrees as the default runtime substrate. Source prompt packs and historical plans remain reference material only unless explicitly incorporated into the canonical PRD.

## Change control

A material change requires:

- a PRD version increment;
- an explicit decision record;
- impact analysis for app, CLI, runtime state, compatibility, migration, security, and tests;
- implementation-plan and manifest updates; and
- owner approval.
