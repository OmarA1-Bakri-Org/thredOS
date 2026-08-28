# thredOS Final Canonical Document Set

**Version:** 1.1  
**Date:** 2026-07-15  


---

# CANONICAL DOCUMENT INDEX

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

---

# CANONICAL PRD

# thredOS Desktop 1.0
## Canonical Product Requirements Document — Worktree-Free Parallel Agent Runtime

**Document status:** Final canonical product and runtime source of truth  
**Version:** 1.1  
**Date:** 2026-07-15  
**Product:** thredOS Desktop  
**Repository:** `OmarA1-Bakri-Org/thredOS`  
**Primary owner:** Omar Al-Bakri  
**Supersedes:** All earlier PRD drafts and architecture recommendations in this project  
**Scope:** Complete the local-first thredOS Desktop application and enable safe, concurrent multi-agent work without Git worktrees or branch-per-agent workflows.

---

## 0. Authority and change control

This document defines the product and runtime contract for thredOS Desktop 1.0.

The final canonical document set is:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md` — product and runtime authority;
2. `AGENTS.md` — repository execution rules for human and AI contributors;
3. `docs/plans/m0-m1-repository-implementation-plan.md` — delivery authority for Milestones 0–1; and
4. `docs/plans/m0-m1-pr-manifest.yaml` — machine-readable PR order and gates.

Where this PRD conflicts with older plans, prototypes, task files, design notes, chat outputs, or partial implementations, this PRD wins unless superseded by a later versioned amendment approved by the product owner. `AGENTS.md`, the implementation plan, and the PR manifest are subordinate to this PRD.

Implementation plans may decompose this PRD but may not silently alter its locked decisions, acceptance criteria, or product boundaries.

A material change requires:

1. a version increment;
2. an explicit decision record;
3. an impact statement covering CLI, app, runtime state, migration, and tests; and
4. an updated acceptance matrix.

---

# 1. Executive summary

thredOS is a local-first operating environment for serious agent work. It turns ad hoc terminal sessions into explicit sequences, thread surfaces, agent runs, deterministic gates, approvals, artifacts, traces, and inspectable outcomes.

The product must now complete its core promise: a user should be able to open one local project, assign several agents, run them concurrently, observe their work, compare or combine their outputs, and apply approved changes without manually creating branches, terminals, Git worktrees, or merge choreography.

The canonical solution is **parallelism without shared mutation**:

```text
Canonical workspace
        │
        ├── immutable baseline snapshot
        │       ├── isolated surface workspace A → change set A
        │       ├── isolated surface workspace B → change set B
        │       ├── isolated surface workspace C → change set C
        │       └── isolated surface workspace D → change set D
        │
        └── deterministic review + merge engine
                └── approved change set applied transactionally
```

No parallel agent writes directly to the canonical project. Each write-capable attempt receives a private, ephemeral **Surface Workspace** derived from the same immutable baseline snapshot. thredOS captures the resulting filesystem delta as a first-class **Change Set**. The operator may select one candidate, combine compatible candidates, request a synthesis attempt, or reject all outputs. Only the thredOS merge engine may mutate the canonical workspace, and only after deterministic pre-apply validation and any required approval.

Git remains supported as downstream version control. thredOS may optionally create a commit after applying an approved change set. Git is not the parallelism or isolation substrate. The product must not require, create, or instruct users to manage Git worktrees.

---

# 2. Product vision

## 2.1 Vision statement

> thredOS is the local control plane for running multiple AI agents through explicit workflows, isolated workspaces, deterministic gates, and inspectable evidence—without model lock-in, hosted workflow content, or manual branch/worktree management.

## 2.2 Product promise

A user can:

1. open an existing local project, including a dirty or non-Git workspace;
2. create or install a reusable agent workflow;
3. run several agents concurrently from one baseline;
4. keep each agent's context, files, logs, tools, and outputs separate;
5. stop, restart, retry, or inspect any attempt;
6. compare resulting artifacts and code changes;
7. merge selected work without manually managing branches or worktrees;
8. prove what happened through local manifests, traces, approvals, gates, and change history; and
9. keep prompts, skills, project files, logs, and artifacts local.

## 2.3 Positioning

thredOS is not:

- another chat wrapper;
- a generic low-code workflow canvas;
- a hosted agent application framework;
- a Git worktree GUI;
- a replacement for Git;
- an autonomous production-deployment system by default; or
- a cloud control plane for user workflow content.

thredOS is an **agent operating environment**. It coordinates agent sessions, runtime boundaries, execution state, evidence, and controlled convergence.

---

# 3. Current-state baseline

The current repository already contains substantial product foundations:

- a Next.js workbench packaged through Electron;
- a deterministic `thread` CLI with JSON output;
- a shared local sequence model;
- thread surfaces, run scopes, runtime events, merges, and provenance;
- local prompt, artifact, trace, approval, gate-decision, and export storage;
- agent dispatch for Claude Code, Codex, Gemini, and shell steps;
- policy modes and deterministic gate rules;
- pack compilation and installation;
- app API routes and React Query hooks over the local runtime.

The current parallel model is incomplete:

- `group parallelize` marks steps as a parallel group but does not provision separate writable workspaces;
- CLI and API group execution currently iterate through steps rather than running them concurrently;
- agent processes default to the same `basePath` unless a step has an explicit `cwd`;
- the app and CLI duplicate runtime orchestration logic and do not yet provide identical policy, gate, manifest, approval, and recovery behavior;
- stop and restart are not complete across the app/runtime path;
- a surface is currently a strong control-plane abstraction but not yet a complete filesystem execution boundary;
- process, workflow-run, step-attempt, and change-set state are not yet represented through one unified durable scheduler.

This PRD completes that architecture without discarding the existing product.

---

# 4. Problem statement

## 4.1 User problem

Running several coding or research agents today usually requires some combination of:

- multiple terminal windows;
- manual prompt and context duplication;
- branches or Git worktrees;
- separate editor windows;
- manual process tracking;
- manual diff inspection;
- manual merge ordering;
- unclear ownership of changes;
- weak evidence that tests or gates passed;
- fragile recovery when a terminal, process, or application crashes; and
- provider-specific operating habits.

This creates high coordination overhead precisely when agents are meant to increase throughput.

## 4.2 Technical problem

Multiple agents cannot safely write to the same physical project directory concurrently. They may:

- overwrite each other's files;
- consume partially written work;
- invalidate each other's tests;
- mutate lockfiles or generated files concurrently;
- create nondeterministic build states;
- erase local user changes;
- make provenance ambiguous; or
- produce merge conflicts after the fact with no shared baseline evidence.

Git worktrees solve only the separate-checkout portion of the problem. They do not natively model agent identity, prompts, tools, gates, approvals, surface visibility, runtime evidence, selection, or synthesis. They also require Git, a clean-enough branch model, user understanding, cleanup, and merge choreography.

## 4.3 Product opportunity

thredOS can replace branch-and-terminal coordination with a higher-level runtime model:

```text
Sequence → Surface → Attempt → Workspace → Change Set → Gate → Merge → Evidence
```

The user reasons about agent work. thredOS handles execution mechanics.

---

# 5. Goals and non-goals

## 5.1 P0 goals

### G-001 — Worktree-free parallel execution
Users can run at least two and up to the configured policy limit of agents concurrently without creating or managing Git worktrees.

### G-002 — No shared mutation
Parallel write-capable agents never write directly to the canonical workspace.

### G-003 — First-class change sets
Every write-capable attempt produces a deterministic, inspectable change set linked to its baseline, agent, prompt, run, surface, tests, and artifacts.

### G-004 — Controlled convergence
Users can select, reject, combine, synthesize, preview, validate, and apply change sets through thredOS.

### G-005 — CLI/app parity
The desktop app, `thread` CLI, chat/apply layer, and future MCP surface call the same runtime service and produce the same state transitions.

### G-006 — Durable runs
Runs and attempts survive app restarts. thredOS can reconcile orphaned processes and retain their workspaces and outputs.

### G-007 — Local-first truth
Prompts, skills, snapshots, workspaces, logs, change sets, traces, and artifacts remain local by default.

### G-008 — Model neutrality
The runtime supports multiple agent CLIs through adapters without embedding provider-specific behavior into the scheduler or workspace model.

### G-009 — Honest isolation claims
Every attempt exposes the actual isolation level used. Directory-scoped isolation must not be described as host-enforced isolation.

### G-010 — Complete operator loop
A user can configure, launch, observe, stop, review, merge, export, and clean up a parallel run without leaving the app or using manual worktree commands.

## 5.2 P1 goals

- host-enforced execution using a container or WSL2/Linux sandbox provider;
- remote execution through thredOS Node;
- team-shared run review without uploading workspace content;
- advanced synthesis and automated candidate ranking;
- provider-specific cost and token metering;
- reusable workspace profiles for common stacks.

## 5.3 Non-goals for Desktop 1.0

- replacing Git as a version-control system;
- building a hosted cloud execution platform;
- Kubernetes-first orchestration;
- automatic production deployments without separate policy and approval;
- collaborative real-time code editing;
- cryptographic isolation claims;
- general-purpose VM management;
- automatic resolution of all semantic code conflicts;
- supporting every package manager or build system through hard-coded product logic;
- implementing the full Thread Runner proving marketplace.

---

# 6. Locked product decisions

These decisions are canonical.

## D-001 — No Git worktrees

thredOS Desktop 1.0 must not depend on `git worktree` for parallel execution. The runtime, tests, onboarding, UI, CLI help, and documentation must not require manual worktrees.

A repository-wide release check must fail if production runtime code introduces `git worktree` invocation.

## D-002 — Git is optional

Parallel execution must work in:

- Git repositories with committed changes;
- Git repositories with uncommitted or untracked changes; and
- non-Git directories.

Git integration is additive. It is not required for snapshots, change capture, conflict detection, or apply.

## D-003 — Canonical workspace is single-writer

Only the thredOS merge/apply service may mutate the canonical workspace during a parallel run. Agents never receive direct write access to it.

## D-004 — Same baseline for comparable agents

All agents in a candidate or race group must start from the exact same immutable baseline snapshot unless the sequence explicitly defines different inputs.

## D-005 — Filesystem deltas, not branches, are the convergence unit

The result of a write-capable attempt is a `ChangeSet`, not a branch. Change sets are captured from baseline and final workspace manifests.

## D-006 — Portable provider first

A cross-platform copy-based workspace provider is mandatory and is the compatibility floor. Faster copy-on-write providers are optional accelerators.

Hardlink-based writable workspaces are prohibited because a write may mutate the source through the shared inode.

## D-007 — Surfaces remain the user-facing abstraction

Users see surfaces, runs, attempts, workspaces, change sets, and merges. Provider details such as copy, overlay, container, or ephemeral Git compatibility are implementation and inspection details.

## D-008 — Shared runtime service

API routes and CLI handlers must not each implement their own run lifecycle. They must invoke one shared application service.

## D-009 — mprocs is optional observability

mprocs may remain a process-viewing or terminal experience. It is not the source of truth for scheduling, process identity, attempt state, cancellation, or recovery.

## D-010 — No implicit canonical apply

An agent completion never automatically mutates the canonical workspace merely because its process exits successfully. Apply requires the configured merge policy, deterministic gates, and any required approval.

## D-011 — Dirty workspace support

thredOS must snapshot the user's actual current workspace, including allowed uncommitted and untracked content. The user is not forced to commit or stash before starting a run.

## D-012 — Explicit parallel strategies

Parallel groups support three strategies:

1. `candidate` — agents solve the same task independently; operator or fusion chooses;
2. `sharded` — agents own declared path or task scopes; compatible results may auto-compose; and
3. `race` — the first candidate satisfying all configured gates may be selected, with optional cancellation of remaining attempts.

The default is `candidate`.

---

# 7. Target users and jobs to be done

## 7.1 Primary user

A solo or small-team engineer using several AI coding or research agents across real local projects.

Typical characteristics:

- technically capable;
- values local control and model choice;
- works in Windows, WSL2, or Linux;
- operates Claude Code, Codex, Gemini, shell tools, or future agent CLIs;
- wants parallel throughput without operational clutter;
- needs inspectable results rather than opaque autonomy.

## 7.2 Secondary users

- applied AI engineers building reusable agent workflows;
- agencies delivering repeatable AI-assisted engineering work;
- security-sensitive teams requiring local prompts and artifacts;
- product builders running candidate generation and independent review;
- operators of thredOS packs such as SaaS Factory.

## 7.3 Core jobs to be done

### JTBD-001
When I have a substantial task, I want to launch several agents from one consistent baseline so that I can explore alternatives without setting up branches, worktrees, or multiple terminals.

### JTBD-002
When agents modify code in parallel, I want every agent isolated from the others so that their intermediate writes do not interfere.

### JTBD-003
When agents finish, I want to compare their outputs and test evidence before anything touches my project.

### JTBD-004
When several outputs are compatible, I want thredOS to combine them safely and detect conflicts before applying them.

### JTBD-005
When a run fails or the app restarts, I want the work and evidence preserved so that I do not lose an expensive attempt.

### JTBD-006
When I switch between the UI and CLI, I want the same runtime behavior and state.

### JTBD-007
When an agent claims success, I want deterministic gates and artifacts to determine whether it is actually ready.

---

# 8. Canonical operating model

## 8.1 Product hierarchy

```text
Local Workspace
└── Sequence
    └── Workflow Run
        ├── Thread Surface
        │   └── Step Attempt
        │       ├── Agent Session
        │       ├── Surface Workspace
        │       ├── Artifacts
        │       ├── Trace Events
        │       └── Change Set
        ├── Gate Decisions
        ├── Approvals
        └── Merge Plans / Merge Results
```

## 8.2 Core rule

> Parallel work is permitted. Shared writes are not.

## 8.3 Execution classes

| Side-effect class | Default workspace mode | Canonical write allowed during attempt | Result |
|---|---|---:|---|
| `none` | isolated or shared immutable input | No | Artifact only |
| `read` | shared immutable snapshot or isolated | No | Artifact only |
| `write` | isolated surface workspace | No | Change set |
| `execute` | isolated surface workspace | No | Change set + execution evidence |
| merge/apply service | canonical workspace | Yes | Applied merge result |

## 8.4 Parallel group strategies

### Candidate

All attempts receive the same task and baseline. They cannot inspect one another before configured reveal or completion. Results remain independent change sets.

### Sharded

Each attempt receives an explicit scope such as:

- file paths;
- package or module;
- test suite;
- documentation area; or
- task subproblem.

Path ownership is advisory in directory-scoped mode and enforceable in host-sandboxed mode. Changes outside scope trigger a gate failure or review state.

### Race

All candidates start from the same baseline. The first candidate to satisfy output, completion, test, and policy gates becomes eligible. Automatic selection and cancellation are policy-controlled.

---

# 9. Canonical user journeys

## 9.1 First-time setup

1. User installs thredOS Desktop.
2. App detects available agent CLIs and runtime providers.
3. User selects a local project directory.
4. thredOS creates or validates `.threados/` metadata without moving project files.
5. User selects a default execution profile:
   - Portable local;
   - WSL2 accelerated; or
   - Container sandboxed, when available.
6. App runs a read-only diagnostic.
7. App shows explicit capability and isolation labels.

### Acceptance

- No Git repository is required.
- No branch, commit, stash, or worktree is required.
- Missing optional providers do not block portable local mode.
- Agent availability is shown truthfully.

## 9.2 Run several agents on the same task

1. User creates or selects a `p` thread group.
2. User chooses agents/models and concurrency.
3. User selects `candidate` strategy.
4. thredOS creates one baseline snapshot.
5. thredOS provisions one surface workspace per attempt.
6. Agents run concurrently.
7. The app streams status and output per attempt.
8. Each completion produces artifacts, gate decisions, and a change set.
9. User compares candidates.
10. User selects one, requests synthesis, or rejects all.
11. thredOS creates a merge preview and runs configured validation.
12. User approves apply when required.
13. thredOS applies transactionally to the canonical workspace.
14. Optional Git commit is created after successful apply.
15. Ephemeral workspaces are cleaned according to retention policy.

## 9.3 Run sharded implementation work

1. User or planner decomposes work into explicit scopes.
2. Each agent receives its own scope and workspace.
3. Agents run concurrently.
4. thredOS detects overlapping changes.
5. Non-overlapping change sets are automatically composable.
6. Overlapping changes require merge preview or synthesis.
7. Combined preview is tested before canonical apply.

## 9.4 Recover from application or process failure

1. Desktop restarts.
2. Scheduler loads persisted runs and attempts.
3. Process registry checks whether each process is alive.
4. Live attempts reconnect to output where supported.
5. Missing processes become `interrupted`, not silently `failed` or `successful`.
6. Workspaces and partial artifacts remain inspectable.
7. User may retry from the same baseline, preserve the workspace, or discard it.

## 9.5 Work while the canonical workspace changes

1. Parallel agents start from snapshot `S1`.
2. User continues editing the canonical project.
3. Candidate finishes and produces a change set against `S1`.
4. Merge preview compares:
   - baseline `S1`;
   - current canonical workspace; and
   - candidate result.
5. Unchanged canonical paths apply safely.
6. Concurrently changed paths enter three-way merge or conflict review.
7. User work is never overwritten silently.

---

# 10. Functional requirements

Priorities:

- **P0:** required for Desktop 1.0 release;
- **P1:** required soon after release or for stronger isolation profiles;
- **P2:** future enhancement.

## 10.1 Unified runtime service

### FR-RUNTIME-001 — Shared service [P0]

Create one shared runtime application service used by:

- `app/api/run`;
- `app/api/stop`;
- `app/api/restart`;
- `lib/seqctl/commands/run`;
- `lib/seqctl/commands/control`;
- chat/apply actions; and
- future MCP methods.

No interface may implement an independent step lifecycle.

### FR-RUNTIME-002 — Canonical methods [P0]

The service must expose typed methods equivalent to:

```ts
interface ThreadOSRuntimeService {
  startRun(request: StartRunRequest): Promise<WorkflowRun>;
  runStep(request: RunStepRequest): Promise<StepAttempt>;
  runFrontier(request: RunFrontierRequest): Promise<WorkflowRun>;
  runGroup(request: RunGroupRequest): Promise<WorkflowRun>;
  cancelRun(runId: string): Promise<WorkflowRun>;
  cancelAttempt(attemptId: string): Promise<StepAttempt>;
  restartAttempt(attemptId: string): Promise<StepAttempt>;
  inspectRun(runId: string): Promise<RunProjection>;
  previewMerge(request: MergePreviewRequest): Promise<MergePlan>;
  applyMerge(request: ApplyMergeRequest): Promise<MergeResult>;
}
```

### FR-RUNTIME-003 — State transitions [P0]

Runtime state transitions must be code-defined, validated, and persisted. Agents may not self-certify transitions.

### FR-RUNTIME-004 — Idempotent commands [P0]

Mutating runtime commands require an idempotency key or deterministic command identifier. Replaying a successful command must not duplicate processes or applies.

---

## 10.2 Workflow run and attempt model

### FR-RUN-001 — Separate workflow run and step attempts [P0]

A workflow run represents one execution of a sequence or target group. A step attempt represents one agent/process attempt.

One `run.json` must not be repeatedly overwritten with different step identities.

### FR-RUN-002 — Attempt identity [P0]

Every attempt records:

- attempt ID;
- workflow run ID;
- sequence and step IDs;
- surface ID;
- agent and model;
- baseline snapshot ID;
- workspace ID;
- process identity;
- status;
- start and end timestamps;
- retry lineage;
- policy hash;
- compiled prompt hash;
- input and output manifest references;
- change-set reference;
- gate summary;
- cost and timing where available.

### FR-RUN-003 — Status model [P0]

Workflow run statuses:

```text
pending | provisioning | running | awaiting_review | applying |
successful | partially_successful | failed | cancelled | interrupted
```

Attempt statuses:

```text
pending | provisioning | running | completed | needs_review |
failed | cancelled | timed_out | interrupted
```

Workspace statuses:

```text
planned | materializing | ready | active | frozen | retained |
cleaning | cleaned | failed
```

### FR-RUN-004 — Atomic persistence [P0]

State writes must be atomic and revision-protected. Conflicting concurrent updates must fail closed and retry through the service.

---

## 10.3 Baseline snapshot engine

### FR-SNAPSHOT-001 — Immutable baseline [P0]

Before a write-capable parallel run, thredOS creates an immutable logical snapshot of the canonical workspace.

The snapshot is represented by a manifest containing:

- snapshot ID;
- source root;
- creation time;
- file paths;
- file type;
- content hash;
- size;
- executable bit where relevant;
- symlink metadata;
- exclusion-policy hash;
- file count and total bytes;
- Git HEAD and dirty-state metadata when Git exists; and
- a root manifest hash.

### FR-SNAPSHOT-002 — Dirty and untracked content [P0]

Allowed uncommitted and untracked files are included by content, not merely by Git revision.

### FR-SNAPSHOT-003 — Exclusions [P0]

The default exclusion set includes:

```text
.git/
.threados/
node_modules/
.next/
dist/
build/
coverage/
.venv/
venv/
target/
__pycache__/
```

Projects may override exclusions through `.threados/workspace.yaml` and `.threadosignore`.

Lockfiles and project configuration files are included unless explicitly excluded.

### FR-SNAPSHOT-004 — Symlink safety [P0]

The snapshot engine must not follow symlinks outside the canonical workspace. Escaping symlinks are recorded as blocked inputs and excluded from materialization unless explicitly approved under a host-enforced profile.

### FR-SNAPSHOT-005 — Snapshot reuse [P0]

All attempts in one comparable parallel group reuse the same snapshot manifest and immutable base content.

### FR-SNAPSHOT-006 — Snapshot cache [P1]

Unchanged content may be reused through a content-addressed local cache to reduce repeated copying.

---

## 10.4 Surface Workspace Engine

### FR-WORKSPACE-001 — One private workspace per write attempt [P0]

Every parallel `write` or `execute` attempt receives a distinct surface workspace outside the canonical project root.

Recommended default roots:

```text
Windows: %LOCALAPPDATA%\thredOS\workspaces\<localWorkspaceId>\<runId>\<surfaceId>\
Linux/WSL2: ~/.local/share/thredos/workspaces/<localWorkspaceId>/<runId>/<surfaceId>/
```

`.threados/` stores references and manifests, not recursively nested workspace copies.

### FR-WORKSPACE-002 — Portable copy provider [P0]

Implement a reliable cross-platform provider that materializes the baseline into an independent directory.

Requirements:

- never use hardlinks for writable files;
- never copy `.threados` runtime state into the agent workspace;
- never copy sibling surface workspaces;
- preserve allowed file metadata;
- verify the materialized manifest before dispatch;
- clean partial materializations on failure; and
- support Windows, WSL2, and Linux.

### FR-WORKSPACE-003 — Provider abstraction [P0]

```ts
interface SurfaceWorkspaceProvider {
  capabilities(): WorkspaceProviderCapabilities;
  provision(request: ProvisionWorkspaceRequest): Promise<SurfaceWorkspace>;
  inspect(workspaceId: string): Promise<SurfaceWorkspaceState>;
  freeze(workspaceId: string): Promise<void>;
  destroy(workspaceId: string): Promise<void>;
}
```

Required provider:

- `copy`.

Optional providers:

- `overlayfs` for WSL2/Linux acceleration;
- `container` for host-enforced mounts and network policy;
- `ephemeral-git` compatibility layer within an already isolated workspace.

### FR-WORKSPACE-004 — Automatic provider selection [P0]

`provider: auto` selects the fastest verified provider that satisfies the requested isolation level. It must not silently downgrade a requested host-enforced run.

### FR-WORKSPACE-005 — Optional VCS compatibility [P1]

For agents that depend on Git commands, thredOS may initialize an ephemeral local Git repository inside the isolated workspace. This repository:

- has no required remote;
- represents the snapshot as a baseline commit;
- is not a worktree;
- is disposable; and
- is not the canonical merge mechanism.

### FR-WORKSPACE-006 — Workspace bootstrap [P0]

Projects may define bootstrap commands in `.threados/workspace.yaml`, for example:

```yaml
bootstrap:
  - bun install --frozen-lockfile
validate:
  - bun run typecheck
  - bun test
```

Bootstrap runs inside the surface workspace and is subject to policy.

### FR-WORKSPACE-007 — Retention [P0]

Retention policies:

- `cleanup_on_success`;
- `retain_until_applied`;
- `retain_on_failure`;
- `retain_always`; and
- time/size-based cleanup.

Default:

- retain failed, interrupted, conflict, and review-required workspaces;
- clean successfully applied workspaces after artifacts and change sets are verified.

### FR-WORKSPACE-008 — Quotas [P0]

Policy controls maximum:

- active workspaces;
- workspace bytes;
- total retained bytes;
- files per workspace;
- attempt duration;
- concurrent processes; and
- output-log bytes.

---

## 10.5 Parallel scheduler

### FR-SCHED-001 — Real concurrency [P0]

Parallel groups must execute concurrently up to `max_concurrent`, rather than iterating sequentially.

### FR-SCHED-002 — Persist before spawn [P0]

The scheduler must persist the attempt, workspace plan, policy snapshot, and process launch request before spawning the agent.

### FR-SCHED-003 — Concurrency tokens [P0]

Concurrency is enforced through durable scheduler leases or tokens. API request count is not the concurrency source of truth.

### FR-SCHED-004 — Fair queue [P0]

The scheduler must avoid starvation across sequences and support priority without allowing one run to monopolize all slots by default.

### FR-SCHED-005 — Process registry [P0]

Every process records:

- PID or provider handle;
- command and redacted arguments;
- attempt and workspace IDs;
- start time;
- heartbeat/output timestamp;
- cancellation state; and
- exit result.

### FR-SCHED-006 — Cancellation [P0]

Users can cancel:

- an individual attempt;
- the remaining attempts in a race;
- a group; or
- the entire workflow run.

Cancellation must terminate the actual process where possible and persist truthful outcome state.

### FR-SCHED-007 — Recovery [P0]

On startup, the scheduler reconciles persisted running attempts against real process handles. It must never leave an attempt permanently `running` when no process exists.

### FR-SCHED-008 — Retry [P0]

Retries create new attempt IDs linked to the original attempt. Retry policy is explicit:

```text
none | manual | bounded_automatic
```

Automatic retry is disabled by default for write-capable tasks.

### FR-SCHED-009 — Race policy [P0]

Race groups support:

- `wait_all`;
- `first_passing`; and
- `first_passing_then_grace_period`.

A candidate is passing only after deterministic completion gates.

---

## 10.6 Agent execution adapters

### FR-AGENT-001 — Common contract [P0]

```ts
interface AgentExecutionAdapter {
  id: string;
  availability(): Promise<AgentAvailability>;
  buildLaunchRequest(input: AgentExecutionInput): Promise<ProcessLaunchRequest>;
  parseResult(input: RawProcessResult): Promise<AgentExecutionResult>;
  supportsResume(): boolean;
}
```

### FR-AGENT-002 — Initial adapters [P0]

- Claude Code;
- Codex;
- Gemini;
- shell/deterministic command.

### FR-AGENT-003 — Isolated cwd [P0]

Write-capable agents must receive the surface workspace root as `cwd`. They must never receive the canonical root as writable `cwd` during a parallel run.

### FR-AGENT-004 — Environment filtering [P0]

Continue allowlisted environment inheritance. Surface, run, attempt, workspace, event-log, policy, and output-contract references are explicitly injected.

### FR-AGENT-005 — Structured completion [P0]

Each attempt must produce a machine-readable result envelope or be normalized into one. At minimum:

- status;
- summary;
- files created/modified/deleted where available;
- artifacts;
- test/validation claims with evidence refs;
- blockers;
- usage/cost where available.

### FR-AGENT-006 — No agent gate authority [P0]

Agent statements such as “tests passed,” “merge complete,” or “ready to ship” are claims. Deterministic thredOS gates decide progression.

---

## 10.7 Change Set Engine

### FR-CHANGE-001 — Capture filesystem delta [P0]

At attempt completion or freeze, thredOS compares:

- immutable baseline manifest; and
- final surface-workspace manifest.

It produces typed entries for:

```text
add | modify | delete | rename | chmod | symlink
```

### FR-CHANGE-002 — Change-set schema [P0]

A change set includes:

- ID;
- run, attempt, step, surface, and agent refs;
- baseline snapshot ID and hash;
- creation time;
- file entries;
- content hashes before and after;
- text/binary classification;
- total bytes and line counts where available;
- patch or full-content references;
- path-scope violations;
- validation summary;
- output-contract state;
- approval state; and
- lifecycle status.

Lifecycle:

```text
draft | captured | validated | selected | rejected | superseded |
merge_ready | conflicted | applied | apply_failed
```

### FR-CHANGE-003 — Content storage [P0]

Changed content is stored locally under the workflow run, outside the canonical workspace. Large/binary content uses content-addressed blobs where practical.

### FR-CHANGE-004 — Rename detection [P1]

Rename detection may use exact content hashes and bounded similarity. Incorrect rename inference must not delete data; uncertain cases remain add + delete.

### FR-CHANGE-005 — Path scopes [P0]

For sharded work, changes outside declared path scopes trigger `NEEDS_REVIEW` or `BLOCK` according to policy.

### FR-CHANGE-006 — Determinism [P0]

Capturing the same baseline and resulting workspace must produce the same semantic change-set content and root hash.

### FR-CHANGE-007 — Change-set diff UI and CLI [P0]

Users can inspect:

- summary;
- file tree;
- unified diff;
- before/after content;
- binary changes;
- tests;
- scope violations;
- provenance; and
- candidate comparisons.

---

## 10.8 Merge and apply engine

### FR-MERGE-001 — Three-input merge [P0]

Every apply compares:

1. baseline snapshot `B`;
2. current canonical workspace `W`; and
3. candidate change set `C`.

### FR-MERGE-002 — Safe path rules [P0]

For each changed path:

- if `W == B`, candidate change may apply directly;
- if `C == B`, candidate has no effective change;
- if `W == C`, the change is already present;
- if both `W` and `C` differ from `B`, thredOS attempts a text three-way merge where allowed;
- unresolved text, binary, delete/modify, rename, or permission conflicts become explicit conflicts.

### FR-MERGE-003 — Preview before mutation [P0]

Merge preview materializes a new isolated preview workspace. Validation runs there before canonical apply.

### FR-MERGE-004 — Transactional apply [P0]

Canonical apply must:

1. verify the canonical precondition hash;
2. create a rollback snapshot or journal;
3. stage all file operations;
4. apply atomically where possible;
5. stop on conflict or failed precondition;
6. run configured post-apply checks;
7. roll back on failed apply when safe; and
8. record a merge result and trace.

### FR-MERGE-005 — No silent overwrite [P0]

No file changed by the user or another applied change set after baseline may be overwritten without an explicit conflict resolution decision.

### FR-MERGE-006 — Combine compatible change sets [P0]

thredOS can create one merge plan from several change sets. Non-overlapping entries compose automatically. Overlaps are evaluated against the shared baseline.

### FR-MERGE-007 — Synthesis [P0]

Users may launch a fusion/synthesis attempt. The synthesis agent receives selected artifacts/change sets through an isolated workspace or read-only projections and produces a new change set. It does not write the canonical workspace.

### FR-MERGE-008 — Optional Git commit [P0]

After successful apply, policy may create one Git commit in the canonical repository:

```text
commit_mode: none | prompt | automatic_after_gates
```

No branch or worktree is required. Failure to commit must not misreport the filesystem apply as unperformed; commit and apply are separate outcomes.

### FR-MERGE-009 — Rollback [P0]

Every successful apply produces enough local evidence to reverse the change set unless files are subsequently modified. Rollback must itself use precondition checks.

---

## 10.9 Deterministic gates and approvals

### FR-GATE-001 — Pre-run gates [P0]

At minimum:

- dependencies satisfied;
- required inputs present;
- policy allows action;
- approval present when required;
- surface access valid;
- workspace provider satisfies requested isolation;
- baseline snapshot valid;
- workspace materialization valid.

### FR-GATE-002 — Completion gates [P0]

At minimum:

- process completed truthfully;
- output schema valid;
- completion contract satisfied;
- artifact manifest valid;
- change set captured when required;
- path scopes respected;
- configured validation commands passed;
- no unresolved contamination or policy incident.

### FR-GATE-003 — Apply gates [P0]

At minimum:

- selected change set valid;
- merge preview current;
- canonical precondition hash matches;
- no unresolved conflicts;
- preview validation passed;
- required operator approval present;
- approval payload hash matches exact merge plan;
- rollback plan available.

### FR-GATE-004 — Exact approvals [P0]

Approval records bind to:

- run ID;
- action type;
- target reference;
- payload/merge-plan hash;
- policy snapshot hash;
- requester and resolver;
- expiry; and
- consumption state.

Approvals are single-use by default.

---

## 10.10 Surface isolation and information barriers

### FR-SURFACE-001 — Surface classes [P0]

Retain:

- `shared`;
- `private`;
- `sealed`; and
- `control`.

### FR-SURFACE-002 — Workspace binding [P0]

Each attempt's surface record references its workspace and actual provider/isolation label.

### FR-SURFACE-003 — No sibling workspace projection [P0]

An agent prompt, file tree, dependency-artifact loader, or workspace bootstrap must not expose sibling workspaces unless reveal/access policy explicitly permits it.

### FR-SURFACE-004 — Manifest-only sealed projection [P0]

Before reveal, external surfaces may receive only approved non-semantic metadata such as:

- status;
- counts;
- hashes;
- schema validity;
- permitted evidence totals; and
- gate outcomes.

### FR-SURFACE-005 — Honest isolation labels [P0]

- `NONE` — no isolation claim;
- `THREADOS_SCOPED` — distinct workspace and thredOS access controls, but no host-level filesystem guarantee;
- `HOST_ENFORCED` — OS/container enforcement verified.

### FR-SURFACE-006 — Host-enforced provider [P1]

A container or WSL2/Linux sandbox provider must support:

- explicit mounts;
- no sibling workspace mounts;
- canonical workspace read-only or absent;
- controlled network mode;
- resource limits; and
- process termination.

---

## 10.11 CLI requirements

### FR-CLI-001 — Existing command compatibility [P0]

Preserve existing high-level commands where possible:

```text
thread init
thread step ...
thread dep ...
thread group ...
thread fusion ...
thread gate ...
thread run ...
thread stop ...
thread restart ...
thread status ...
thread template ...
thread event ...
```

### FR-CLI-002 — Parallel execution [P0]

Add or formalize:

```text
thread run group <groupId> --parallel --max-concurrency <n>
thread run runnable --parallel --max-concurrency <n>
thread run step <stepId> --workspace isolated
```

Parallel groups default to isolated workspaces for write-capable steps.

### FR-CLI-003 — Run operations [P0]

```text
thread run list
thread run inspect <runId>
thread run watch <runId>
thread run cancel <runId>
thread attempt inspect <attemptId>
thread attempt cancel <attemptId>
thread attempt retry <attemptId>
```

### FR-CLI-004 — Workspace operations [P0]

```text
thread workspace list [--run <runId>]
thread workspace inspect <workspaceId>
thread workspace retain <workspaceId>
thread workspace clean <workspaceId>
thread workspace doctor
```

### FR-CLI-005 — Change-set operations [P0]

```text
thread changes list --run <runId>
thread changes show <changeSetId>
thread changes diff <changeSetId>
thread changes select <changeSetId>
thread changes reject <changeSetId>
thread merge preview --changes <id,id,...>
thread merge apply <mergePlanId> [--confirm]
thread merge rollback <mergeResultId> [--confirm]
```

### FR-CLI-006 — JSON parity [P0]

Every command supports stable JSON output. CLI JSON schemas are versioned.

### FR-CLI-007 — Truthful exit codes [P0]

- `0`: operation completed as requested;
- non-zero: blocked, failed, conflicted, confirmation required, or unavailable.

A status flip without real process control must never return success.

---

## 10.12 Local API requirements

### FR-API-001 — Compatibility routes [P0]

Existing routes remain available but delegate to the runtime service.

### FR-API-002 — Canonical run routes [P0]

Recommended resource-oriented endpoints:

```text
POST   /api/runs
GET    /api/runs
GET    /api/runs/:runId
POST   /api/runs/:runId/cancel
GET    /api/runs/:runId/attempts
POST   /api/attempts/:attemptId/cancel
POST   /api/attempts/:attemptId/retry
GET    /api/workspaces
GET    /api/workspaces/:workspaceId
DELETE /api/workspaces/:workspaceId
GET    /api/change-sets
GET    /api/change-sets/:changeSetId
POST   /api/merge-plans
GET    /api/merge-plans/:mergePlanId
POST   /api/merge-plans/:mergePlanId/apply
POST   /api/merge-results/:mergeResultId/rollback
```

### FR-API-003 — Streaming [P0]

Use Server-Sent Events, WebSocket, or equivalent local streaming for:

- process output;
- attempt status;
- workspace provisioning;
- gate decisions;
- change-set capture; and
- merge progress.

Polling may remain as a fallback, not the primary live experience.

### FR-API-004 — Typed errors [P0]

Return stable error codes such as:

```text
POLICY_DENIED
APPROVAL_REQUIRED
WORKSPACE_PROVISION_FAILED
AGENT_UNAVAILABLE
ATTEMPT_NOT_RUNNING
SNAPSHOT_STALE
MERGE_CONFLICT
MERGE_PRECONDITION_FAILED
VALIDATION_FAILED
HOST_ISOLATION_UNAVAILABLE
```

---

## 10.13 Desktop workbench requirements

### FR-UI-001 — Run control [P0]

The Run section must support real:

- run selected;
- run group in parallel;
- run runnable frontier;
- stop run;
- cancel attempt;
- restart/retry attempt;
- inspect logs;
- export run; and
- cleanup.

Disabled placeholder controls are not acceptable in the release path.

### FR-UI-002 — Parallel run board [P0]

For each active attempt, display:

- agent/model;
- step and surface;
- status;
- isolation label and workspace provider;
- elapsed time;
- last output/heartbeat;
- changed-file count;
- gate state;
- cancel control; and
- log access.

### FR-UI-003 — Change review [P0]

Provide:

- candidate cards;
- file/change summaries;
- diff viewer;
- validation results;
- scope violations;
- provenance;
- select/reject controls;
- combine compatible changes;
- request synthesis; and
- merge preview.

### FR-UI-004 — Merge conflicts [P0]

Conflict UX must identify:

- path;
- conflict type;
- baseline content;
- current canonical content;
- candidate content;
- automated merge result when available; and
- resolution options.

Desktop 1.0 may open the user's configured external editor for complex manual resolution, but thredOS must retain the merge plan and resume afterward.

### FR-UI-005 — Workspace inspector [P0]

Show:

- root path;
- provider;
- snapshot ID;
- size and file count;
- isolation level;
- retention state;
- process association;
- bootstrap result;
- cleanup action; and
- open-in-explorer/terminal action.

### FR-UI-006 — Configuration [P0]

Users can configure:

- default provider;
- maximum concurrency;
- retention;
- workspace root;
- project excludes;
- bootstrap and validation commands;
- Git commit mode;
- network mode; and
- agent defaults.

### FR-UI-007 — Onboarding [P0]

Onboarding must explain the product in thredOS terms, not Git terms:

```text
Parallel agents → isolated surfaces → change sets → controlled merge
```

### FR-UI-008 — No false state [P0]

UI status must come from persisted runtime state and live reconciliation, not optimistic local-only toggles.

---

## 10.14 Packs and reusable workflows

### FR-PACK-001 — Workspace policies in packs [P0]

Pack manifests can declare sequence and step defaults:

```yaml
workspace_policy:
  mode: isolated
  provider: auto
  vcs_mode: none
  retention: retain_until_applied

parallel_policy:
  strategy: candidate
  max_concurrency: 5
  completion: wait_all
  merge_policy: manual
```

### FR-PACK-002 — Surface templates [P0]

Packs can declare surface class, visibility, workspace mode, reveal policy, allowed inputs, and path scopes.

### FR-PACK-003 — SaaS Factory proof [P0]

The SaaS Factory pack is a flagship validation workflow. It must demonstrate:

- five independent ideation agents;
- sealed pre-reveal surfaces;
- concurrent execution;
- independent artifacts;
- explicit reveal;
- adjudication;
- parallel candidate builders or sharded implementation agents; and
- controlled change-set convergence without worktrees.

---

# 11. Configuration contracts

## 11.1 `.threados/workspace.yaml`

Illustrative canonical shape:

```yaml
version: "1.0"

workspace:
  provider: auto
  root: null
  vcs_mode: none
  include_untracked: true
  follow_symlinks: false
  retention: retain_until_applied

exclude:
  - .git/**
  - .threados/**
  - node_modules/**
  - .next/**
  - dist/**
  - build/**
  - coverage/**

bootstrap:
  commands:
    - bun install --frozen-lockfile
  timeout_ms: 600000

validation:
  commands:
    - bun run typecheck
    - bun test
  stop_on_failure: true

merge:
  commit_mode: prompt
  allow_text_three_way: true
  auto_apply_non_conflicting: false

retention:
  successful_hours: 1
  failed_days: 7
  max_total_gb: 25
```

## 11.2 Sequence extensions

Illustrative backwards-compatible additions:

```yaml
defaults:
  workspace_policy_ref: workspace:default
  parallel_policy_ref: parallel:candidate

steps:
  - id: implementation-a
    type: p
    side_effect_class: write
    surface_ref: thread-implementation-a
    workspace_policy_ref: workspace:isolated
    parallel_policy_ref: parallel:candidate
    path_scopes:
      - app/**
      - lib/**
```

Existing sequences without these fields are normalized using safe defaults.

---

# 12. Canonical local filesystem model

```text
<project>/
├── project files...
└── .threados/
    ├── sequence.yaml
    ├── policy.yaml
    ├── workspace.yaml
    ├── prompts/
    ├── packs/
    ├── surfaces/
    ├── runs/
    │   └── <runId>/
    │       ├── run.json
    │       ├── trace.ndjson
    │       ├── approvals.ndjson
    │       ├── gate-decisions.ndjson
    │       ├── attempts/
    │       │   └── <attemptId>/
    │       │       ├── attempt.json
    │       │       ├── process.json
    │       │       ├── input.manifest.json
    │       │       ├── output.manifest.json
    │       │       └── logs/
    │       ├── change-sets/
    │       │   └── <changeSetId>/
    │       │       ├── change-set.json
    │       │       ├── patch.diff
    │       │       └── blobs/
    │       ├── merge-plans/
    │       │   └── <mergePlanId>.json
    │       ├── merge-results/
    │       │   └── <mergeResultId>.json
    │       └── exports/
    ├── snapshots/
    │   └── <snapshotId>/
    │       ├── manifest.json
    │       └── metadata.json
    └── state/
        ├── scheduler.json
        ├── processes.json
        ├── workspace-index.json
        └── revisions/

<runtime-data-root>/
└── workspaces/
    └── <localWorkspaceId>/
        └── <runId>/
            ├── <surfaceId>-<attemptId>/
            └── merge-preview-<mergePlanId>/
```

Runtime workspace contents live outside the source project by default. This prevents recursive snapshots, accidental Git tracking, and sibling-surface discovery through the project tree.

---

# 13. Architecture

## 13.1 Canonical component model

```text
┌─────────────────────────────────────────────────────────────────┐
│ Product interfaces                                              │
│ Desktop UI │ thread CLI │ Chat Apply │ Future MCP              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ typed commands
┌──────────────────────────────▼──────────────────────────────────┐
│ ThreadOSRuntimeService                                          │
│ authorization │ idempotency │ command validation               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│ Durable Scheduler                                               │
│ runs │ attempts │ leases │ process registry │ recovery          │
└───────────────┬──────────────────────────────┬───────────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌───────────▼──────────────────┐
│ Surface Workspace Engine      │  │ Gate / Policy / Approval     │
│ snapshot │ materialize │ quota│  │ deterministic decisions      │
└───────────────┬──────────────┘  └───────────┬──────────────────┘
                │                              │
┌───────────────▼──────────────────────────────▼──────────────────┐
│ Agent execution adapters                                        │
│ Claude Code │ Codex │ Gemini │ Shell │ future adapters          │
└───────────────┬─────────────────────────────────────────────────┘
                │ outputs
┌───────────────▼─────────────────────────────────────────────────┐
│ Artifact + Change Set Engine                                     │
│ manifests │ traces │ logs │ filesystem delta │ evidence          │
└───────────────┬─────────────────────────────────────────────────┘
                │ selected change sets
┌───────────────▼─────────────────────────────────────────────────┐
│ Merge / Apply Engine                                             │
│ preview │ 3-way merge │ validation │ approval │ transaction      │
└───────────────┬─────────────────────────────────────────────────┘
                │
        Canonical workspace
```

## 13.2 Required module shape

Recommended additive structure:

```text
lib/
├── runtime/
│   ├── service.ts
│   ├── command-schema.ts
│   ├── scheduler.ts
│   ├── run-repository.ts
│   ├── attempt-repository.ts
│   ├── process-registry.ts
│   ├── recovery.ts
│   └── projections.ts
├── workspaces/
│   ├── schema.ts
│   ├── manager.ts
│   ├── snapshot.ts
│   ├── manifest.ts
│   ├── exclusions.ts
│   ├── quotas.ts
│   └── providers/
│       ├── provider.ts
│       ├── copy.ts
│       ├── overlayfs.ts
│       └── container.ts
├── changesets/
│   ├── schema.ts
│   ├── capture.ts
│   ├── repository.ts
│   ├── diff.ts
│   ├── compare.ts
│   └── projections.ts
├── merge/
│   ├── schema.ts
│   ├── planner.ts
│   ├── three-way.ts
│   ├── preview.ts
│   ├── apply.ts
│   ├── rollback.ts
│   └── repository.ts
├── runner/
│   ├── adapters/
│   ├── wrapper.ts
│   ├── dispatch.ts
│   └── artifacts.ts
└── thread-surfaces/
    └── existing model extended with workspace/change-set refs
```

Existing modules are retained where aligned. Runtime orchestration is moved out of route and CLI handlers into the shared service.

---

# 14. Security, safety, and privacy

## 14.1 Local data boundary

The following remain local unless the user explicitly exports them:

- workspace files;
- prompts and skills;
- snapshots;
- surface workspaces;
- logs;
- artifacts;
- change sets;
- diffs;
- traces;
- approvals;
- provenance; and
- workflow content.

## 14.2 Filesystem containment

P0 protections:

- canonicalized roots;
- traversal rejection;
- symlink escape detection;
- runtime workspace outside project root;
- no sibling workspace refs in prompts;
- safe recursive copy;
- size/file quotas;
- atomic writes;
- rollback journal;
- no hardlinks for writable files.

## 14.3 Secrets

- environment inheritance remains allowlisted;
- secret values are not written to manifests, logs, prompts, or exports;
- workspace copies follow project exclusion rules;
- provider credentials are injected only to attempts that require them;
- exports redact configured secret patterns.

## 14.4 Network

Execution profiles support:

```text
off | allowlist | open
```

Directory-scoped portable mode may not be able to enforce network restrictions at host level. The UI must show this truthfully. Host-enforced profiles must implement the configured network mode.

## 14.5 Canonical workspace protection

While a parallel run is active:

- agents do not receive canonical write access;
- apply uses precondition hashes;
- external user edits remain allowed;
- stale merge plans cannot apply;
- rollback evidence is mandatory;
- exact approval is required when configured.

## 14.6 Untrusted agent output

Agent-generated paths, events, filenames, patches, and structured output are untrusted and schema-validated. Change capture derives from the filesystem rather than trusting agent-declared file lists.

---

# 15. Reliability and performance requirements

## 15.1 Reliability SLOs

### REL-001
No completed attempt is lost after a normal application restart.

### REL-002
No missing process remains displayed as `running` after reconciliation completes.

### REL-003
No canonical file is modified before an apply transaction begins.

### REL-004
A failed merge apply leaves either the previous canonical state or a clearly recoverable journaled state.

### REL-005
Replaying a completed apply command does not duplicate changes.

### REL-006
Every change set references a valid baseline snapshot and attempt.

## 15.2 Performance targets

Targets are measured on a representative developer project excluding dependency/build caches.

### PERF-001
Create one logical snapshot manifest for 20,000 files within 10 seconds after warm cache and 30 seconds cold on a typical modern laptop.

### PERF-002
Provision three portable-copy surface workspaces within 45 seconds for a 500 MB included source tree on supported local storage.

### PERF-003
Start dispatch within 2 seconds after a workspace becomes ready.

### PERF-004
Stream attempt state changes to the UI within 1 second under normal local conditions.

### PERF-005
Capture a change set with 1,000 changed files within 15 seconds.

### PERF-006
Generate a merge preview for 100 text-file changes within 10 seconds, excluding project validation commands.

These are release targets, not reasons to compromise correctness. The app must display provisioning progress for large projects.

## 15.3 Resource management

- default max concurrency: `3`;
- default policy cap: `5` for Desktop 1.0;
- configurable memory/CPU hints per attempt;
- output throttling and log caps;
- cleanup warnings before disk exhaustion;
- no silent deletion of retained failed workspaces.

---

# 16. Observability and provenance

## 16.1 Required trace events

Add or retain events for:

```text
run-created
snapshot-created
workspace-provision-started
workspace-ready
attempt-dispatched
attempt-started
attempt-output
attempt-completed
attempt-failed
attempt-cancelled
attempt-interrupted
change-set-captured
gate-evaluated
approval-requested
approval-resolved
merge-preview-created
merge-conflict-detected
merge-approved
merge-applied
merge-rolled-back
workspace-retained
workspace-cleaned
```

## 16.2 Operator dashboard

The app must expose:

- active runs;
- queue and concurrency;
- agent availability;
- process health;
- workspace disk usage;
- attempt durations;
- changed files;
- gates and approvals;
- conflicts;
- merge state;
- failures and blockers;
- retained workspace cleanup; and
- export status.

## 16.3 Provenance chain

Every applied file change must be traceable to:

```text
canonical file
← merge result
← merge plan
← change set
← attempt
← agent/model
← compiled prompt
← input manifest
← baseline snapshot
← sequence/pack/policy
```

---

# 17. Backward compatibility and migration

## 17.1 Sequence compatibility

Existing `sequence.yaml` files continue to parse. Missing workspace and parallel policies normalize to safe defaults.

For an existing `p` group:

- read-only tasks may use immutable shared input;
- write/execute tasks default to isolated surface workspaces;
- strategy defaults to `candidate`;
- apply defaults to manual.

## 17.2 Existing run artifacts

Existing runs remain readable through compatibility projections. New runs use the workflow-run/attempt/change-set hierarchy.

## 17.3 API compatibility

Existing UI hooks and routes remain functional during migration but delegate to the shared runtime service.

## 17.4 CLI compatibility

Existing commands remain. New subcommands are additive. Human-readable output may improve, while versioned JSON contracts remain stable.

## 17.5 mprocs compatibility

mprocs integration may display or select processes. Old mprocs maps are not authoritative for new runs. A migration/reconciliation layer maps old state where possible.

## 17.6 Current direct-run path

Single-step sequential execution may continue using the canonical workspace only when all are true:

- no parallel run is active for that workspace;
- the step is explicitly configured for direct mode;
- policy allows canonical mutation; and
- the user understands that no change-set review boundary exists.

Default behavior for write-capable agent steps in Desktop 1.0 is isolated mode, even when only one agent runs.

---

# 18. Testing strategy

## 18.1 Unit tests [P0]

- snapshot hashing and exclusions;
- dirty/untracked inclusion;
- symlink escape rejection;
- portable copy correctness;
- no hardlinks;
- workspace quotas;
- scheduler transitions;
- concurrency leases;
- process reconciliation;
- change-set capture;
- add/modify/delete/rename classification;
- path-scope enforcement;
- three-way merge rules;
- merge preconditions;
- transactional rollback;
- approval payload binding;
- deterministic gates;
- JSON schemas and CLI error codes.

## 18.2 Integration tests [P0]

### IT-001 — Three independent writers

Three mock agents modify the same baseline in separate workspaces. No candidate sees another candidate's intermediate files. Canonical workspace remains unchanged.

### IT-002 — Non-overlapping composition

Three agents change different paths. thredOS combines them and applies after validation.

### IT-003 — Overlapping text changes

Two candidates and the user modify the same file. Merge preview detects or resolves with three-way merge; no silent overwrite occurs.

### IT-004 — Binary conflict

Candidate and canonical both change a binary file. Apply is blocked pending explicit choice.

### IT-005 — Dirty Git workspace

Baseline includes committed, modified, and untracked files. Parallel agents receive the exact allowed snapshot. User changes after launch survive merge.

### IT-006 — Non-Git project

Parallel agents run, produce change sets, and apply without any `.git` directory.

### IT-007 — Crash recovery

Kill the desktop/server mid-run. Restart and reconcile. Workspaces remain available; attempts become running, interrupted, or completed truthfully.

### IT-008 — Cancel and retry

Cancel one attempt without affecting siblings. Retry creates a new attempt with explicit lineage.

### IT-009 — Stale merge plan

Modify canonical files after preview. Apply fails with `MERGE_PRECONDITION_FAILED` and does not overwrite.

### IT-010 — Disk quota

Workspace provisioning stops safely before exceeding quota and cleans partial state.

### IT-011 — CLI/app parity

Equivalent UI/API and CLI commands produce equivalent persisted state and results.

### IT-012 — No worktrees

Parallel code workflow completes with no `git worktree` invocation and no user-created branch requirement.

## 18.3 Adversarial tests [P0]

- path traversal in agent filenames;
- symlink to sibling workspace;
- symlink to canonical workspace;
- event-log injection;
- oversized stdout/stderr;
- malicious patch paths;
- agent-created `.threados` directory inside workspace;
- agent attempts to modify workspace metadata;
- prompt injection in dependency artifact;
- cancellation during file write;
- application crash during apply;
- stale approval reuse;
- workspace ID collision;
- concurrent apply attempts;
- cleanup race;
- agent spawning unauthorized child processes.

## 18.4 UI E2E [P0]

Playwright must cover:

1. open project;
2. create/apply parallel template;
3. launch three mock agents;
4. observe all attempts concurrently;
5. cancel one attempt;
6. inspect candidate diffs;
7. combine non-overlapping changes;
8. preview validation;
9. approve and apply;
10. verify canonical files;
11. export run bundle;
12. clean workspaces.

## 18.5 Release proof [P0]

A recorded local release proof must run at least two real supported agent CLIs concurrently against one project and complete the full change-set/merge loop without worktrees.

---

# 19. Success metrics

## 19.1 Product metrics

- median time from project open to first two-agent parallel run;
- percentage of users completing a parallel run without terminal/worktree intervention;
- average concurrent attempts per parallel run;
- candidate selection and apply rate;
- automatic non-conflicting composition rate;
- conflict rate by strategy;
- merge preview validation pass rate;
- cancelled/orphaned attempt rate;
- recovered-run success rate;
- retained workspace cleanup success;
- run export rate.

## 19.2 North-star metric

> **Verified parallel outcomes applied per active workspace without manual branch/worktree management.**

## 19.3 Release success criteria

- 100% of P0 acceptance tests pass;
- zero known canonical-workspace data-loss defects;
- zero false-success stop/restart/apply paths;
- no production `git worktree` invocation;
- app and CLI use the shared runtime service;
- at least two real agent adapters pass the release proof;
- dirty Git and non-Git projects pass integration tests;
- crash recovery passes;
- documentation and onboarding contain no manual worktree requirement.

---

# 20. Delivery plan

This is product sequencing, not a substitute for an implementation plan.

## Milestone 0 — Contract and runtime convergence

**Goal:** one truthful runtime path.

Deliver:

- canonical schemas for WorkflowRun, StepAttempt, ProcessRecord, WorkspaceSnapshot, SurfaceWorkspace, ChangeSet, MergePlan, and MergeResult;
- `ThreadOSRuntimeService`;
- API and CLI delegation to the shared service;
- durable scheduler state;
- truthful stop/restart/cancel;
- migration projections for existing runs.

**Exit gate:** one sequential attempt can run through both CLI and UI with identical durable state and truthful process control. Automatic Surface Workspace provisioning is completed in Milestone 1.

## Milestone 1 — Portable Surface Workspace Engine

**Goal:** independent writable directories without worktrees.

Deliver:

- snapshot manifest;
- exclusions and `.threadosignore`;
- portable copy provider;
- workspace index, quotas, retention, and cleanup;
- isolated `cwd` dispatch;
- workspace inspector;
- dirty and non-Git support.

**Exit gate:** two representative write attempts can run through separate workspaces derived from one identical baseline, with the canonical workspace unchanged. They may still be scheduled sequentially at this milestone; real bounded concurrent scheduling is activated in Milestone 3.

## Milestone 2 — Change sets and controlled apply

**Goal:** make agent output reviewable and convergent.

Deliver:

- change-set capture;
- diff viewer and CLI;
- merge planner;
- preview workspace;
- precondition checks;
- transactional apply and rollback;
- optional canonical Git commit.

**Exit gate:** select and apply one candidate safely after user edits the canonical workspace.

## Milestone 3 — Real parallel scheduler

**Goal:** multiple concurrent agents.

Deliver:

- bounded concurrency;
- candidate, sharded, and race strategies;
- process streaming;
- cancellation and retry;
- recovery;
- live parallel run board.

**Exit gate:** three real or representative agents execute concurrently and preserve independent outputs.

## Milestone 4 — Composition, synthesis, and release UX

**Goal:** complete the operator loop.

Deliver:

- candidate comparison;
- combine compatible change sets;
- fusion/synthesis attempt;
- conflict UX;
- full Run controls;
- diagnostics;
- onboarding;
- retention/cleanup UX;
- release export bundle.

**Exit gate:** full E2E flow can be completed without terminal or worktree use.

## Milestone 5 — Hardening and Desktop 1.0 release

Deliver:

- adversarial suite;
- performance tuning;
- Windows/WSL2/Linux verification;
- Electron packaging and upgrade path;
- product documentation;
- real-agent release proof;
- support runbook;
- telemetry limited to permitted product/activation data.

**Exit gate:** all release acceptance criteria pass.

## Milestone 6 — Host-enforced profile [P1]

Deliver:

- container or WSL2/Linux sandbox provider;
- mount and network enforcement;
- resource limits;
- `HOST_ENFORCED` attestation;
- isolation adversarial proof.

---

# 21. Release acceptance matrix

| ID | Requirement | Evidence required |
|---|---|---|
| A-001 | No Git worktrees required or invoked | static scan, runtime trace, E2E proof |
| A-002 | At least three agents run concurrently | scheduler trace and UI recording |
| A-003 | Each write agent receives distinct workspace | workspace manifests and paths |
| A-004 | Comparable agents share exact baseline | identical snapshot ID/hash |
| A-005 | Canonical workspace unchanged during attempts | before/during manifest proof |
| A-006 | Every write attempt produces a change set | valid change-set manifests |
| A-007 | Dirty Git workspace supported | integration proof |
| A-008 | Non-Git project supported | integration proof |
| A-009 | User edits after launch are preserved | three-way merge integration proof |
| A-010 | Overlap conflicts block silent apply | conflict test |
| A-011 | Non-overlapping changes can combine | composition test |
| A-012 | Merge preview validates before apply | preview artifacts and gate decisions |
| A-013 | Apply is transactional and recoverable | crash/rollback tests |
| A-014 | Stop/cancel terminates real process | process-control integration test |
| A-015 | Restart/retry creates truthful attempt lineage | state proof |
| A-016 | App restart reconciles attempts | recovery test |
| A-017 | CLI and app call shared service | architecture test and code scan |
| A-018 | UI exposes all P0 run controls | Playwright proof |
| A-019 | Isolation label is truthful | provider capability tests |
| A-020 | Exact approval binds merge plan | approval replay test |
| A-021 | Export includes snapshots, attempts, change sets, gates, approvals, and merge result | export-schema test |
| A-022 | SaaS Factory pack completes one parallel cycle | recorded pack proof |

---

# 22. Risks and mitigations

## R-001 — Workspace copies are slow or disk-heavy

**Mitigation:** snapshot once, exclude caches, show progress, use content-addressed cache, add overlayfs provider, enforce quotas, and clean predictably. Correctness takes priority over premature filesystem cleverness.

## R-002 — Agents expect Git

**Mitigation:** provide optional ephemeral Git compatibility inside the isolated workspace. Keep change capture filesystem-based so the product remains Git-optional.

## R-003 — Shared dependency directories cause mutation leakage

**Mitigation:** do not share writable dependency directories by default. Use package-manager caches, bootstrap commands, or verified read-only mounts in host-enforced profiles.

## R-004 — Merge engine becomes a second Git

**Mitigation:** limit scope to baseline-aware filesystem change sets, deterministic conflict detection, text three-way merge, preview, apply, and rollback. Do not implement history, remotes, branching, tags, or distributed VCS semantics.

## R-005 — Provider-specific agent behavior leaks into runtime

**Mitigation:** keep adapter contract narrow. Scheduler, workspaces, changes, gates, and merges remain provider-neutral.

## R-006 — API/CLI duplication returns

**Mitigation:** architecture tests prohibit orchestration logic in route and CLI layers beyond parsing, authorization, command invocation, and response rendering.

## R-007 — Directory isolation is marketed as security isolation

**Mitigation:** display the isolation label on every run and in exports. Reserve `HOST_ENFORCED` for verified providers.

## R-008 — User edits race with apply

**Mitigation:** canonical manifest preconditions, stale-plan rejection, three-way merge, and transactional apply.

## R-009 — Parallel agents produce poor or redundant work

**Mitigation:** explicit strategies, independent contexts, structured outputs, candidate comparison, deterministic gates, and configurable synthesis.

## R-010 — Local process recovery is imperfect

**Mitigation:** persist before spawn, maintain process handles and heartbeats, reconcile on startup, retain workspaces, and use `interrupted` as a truthful state.

---

# 23. Required product copy

The primary product explanation should be equivalent to:

> Run multiple AI agents in parallel on one local project. thredOS gives each agent an isolated surface workspace, captures its work as a reviewable change set, and applies only the changes you approve. No manual branches, worktrees, or terminal choreography.

Supporting line:

> Your project remains canonical. Agents work in parallel copies. thredOS controls convergence.

Do not claim:

- cryptographic isolation;
- host-enforced isolation when using the copy provider;
- automatic conflict-free merging;
- that Git is obsolete; or
- that every agent can safely share one writable directory.

---

# 24. Definition of done

thredOS Desktop 1.0 is complete only when a new user can:

1. install and launch the desktop application;
2. select a local Git or non-Git project;
3. detect and configure at least two supported agent CLIs;
4. create or install a parallel workflow;
5. launch multiple agents concurrently;
6. observe separate attempts and workspaces;
7. stop, cancel, retry, and recover runs truthfully;
8. inspect independent artifacts and change sets;
9. compare, combine, or synthesize candidates;
10. preview and validate a merge;
11. approve and apply changes transactionally;
12. optionally create one canonical Git commit;
13. export the complete run evidence;
14. clean retained workspaces; and
15. complete the entire workflow without creating, understanding, or managing a Git worktree.

The product is not complete if parallel groups remain sequential, agents share a writable `basePath`, stop/restart controls are cosmetic, change sets are inferred only from agent claims, or app and CLI continue to execute through divergent lifecycle code.

---

# Appendix A — Repository implementation mapping

The current repository already provides suitable foundations:

| Existing area | Retain / extend |
|---|---|
| `lib/sequence/` | retain schema, parser, DAG; add workspace and parallel policy refs |
| `lib/seqctl/` | retain interface; delegate execution to shared runtime service |
| `app/api/run/` | retain route contract; remove embedded lifecycle into shared service |
| `lib/runner/` | retain process wrapper and dispatch adapters; bind to attempts/workspaces |
| `lib/thread-surfaces/` | retain surface/run/event model; add workspace and change-set refs |
| `lib/gates/` | retain deterministic gates; add snapshot/workspace/change/apply gates |
| `lib/approvals/` | extend exact payload binding, expiry, and consumption |
| `lib/traces/` | extend event vocabulary |
| `lib/packs/` | extend manifest/compiler for workspace and parallel policies |
| `lib/mprocs/` | retain optional observer; remove authority over new run state |
| `lib/ui/api.ts` | extend typed run/workspace/change/merge hooks |
| `components/workbench/sections/RunSection.tsx` | enable real controls and parallel run board |
| `components/lanes/` | show attempts, workspaces, merge ordering, and change-set state |
| `components/inspector/` | add workspace, change-set, isolation, and conflict inspection |

# Appendix B — Canonical engineering invariants

1. No parallel agent writes the canonical workspace.
2. No write attempt runs without a baseline snapshot.
3. No write attempt runs without an isolated workspace.
4. No workspace is considered ready until its manifest verifies.
5. No change set exists without a baseline and final manifest.
6. No merge plan applies against a stale canonical precondition.
7. No conflict is silently overwritten.
8. No approval authorizes a different payload than the one reviewed.
9. No interface reports success without the runtime state transition completing.
10. No runtime component invokes Git worktrees.
11. No host-isolation claim is made by a directory-only provider.
12. No app, CLI, chat, or MCP path bypasses the shared runtime service.
13. No agent decides its own gates.
14. No cleanup removes a retained failed workspace without policy and trace.
15. No generated runtime state is treated as human-authored configuration.

# Appendix C — Canonical initial implementation slice

The smallest vertical slice that proves the architecture is:

```text
One local project
→ one baseline snapshot
→ two Claude/Codex-compatible isolated copy workspaces
→ two concurrent mock or real agent attempts
→ two captured change sets
→ candidate comparison
→ select one
→ merge preview
→ validation command
→ transactional canonical apply
→ optional Git commit
→ export bundle
→ cleanup
```

This slice is the smallest **Desktop 1.0 end-to-end** proof. Milestones 0–1 build its runtime and workspace prerequisites sequentially; Milestone 2 adds change sets/apply and Milestone 3 activates real concurrency. It must be completed before advanced overlays, remote nodes, marketplace features, or broader SaaS Factory automation.

---

# AGENTS.MD

# AGENTS.md

## Purpose

This file defines the mandatory working rules for human contributors and AI coding agents operating in `OmarA1-Bakri-Org/thredOS`.

thredOS is a local-first operating environment for governed agent work. Contributions must preserve runtime truth, local data boundaries, deterministic control, and the product decision to support parallel agents **without Git worktrees**.

## Canonical authority

Read these documents before implementation:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md`
2. `docs/plans/m0-m1-repository-implementation-plan.md`
3. `docs/plans/m0-m1-pr-manifest.yaml`
4. `docs/product/current-state.md`
5. `docs/product/architecture-map.md`

Authority order:

1. The canonical PRD controls product scope, locked decisions, and release acceptance.
2. This `AGENTS.md` controls repository conduct, implementation discipline, safety, and validation.
3. The canonical implementation plan controls Milestones 0–1 sequencing and repository mapping.
4. The PR manifest controls the machine-readable PR order, dependencies, and gates.
5. Current-state and architecture documents describe the repository but do not override the canonical set.

Do not silently change a locked decision. A material change requires a versioned amendment, explicit rationale, impact analysis, and owner approval.

## Product invariants

The following are non-negotiable:

1. **No production runtime path may invoke `git worktree`.**
2. **Git is optional.** Dirty Git projects and non-Git directories must remain supported.
3. **No parallel write-capable agent may mutate the canonical workspace.**
4. **Comparable attempts use the same immutable baseline snapshot.**
5. **Every isolated write/execute attempt uses a verified Surface Workspace as `cwd`.**
6. **Directory-scoped isolation is `THREADOS_SCOPED`, never `HOST_ENFORCED`.**
7. **Only the merge/apply service may mutate the canonical workspace during a parallel workflow.**
8. **Agent output is evidence, not authority.** Agents do not approve gates, reveals, merges, or their own completion.
9. **API, CLI, chat/apply, and future MCP interfaces use one `ThreadOSRuntimeService`.**
10. **mprocs is optional observability and legacy compatibility, not runtime truth.**
11. **Persist run, attempt, workspace, process, and launch intent before process spawn.**
12. **Retry creates a new attempt with lineage. Historical attempts never transition back to `running`.**
13. **Missing process evidence is never interpreted as success.**
14. **Indexes and UI projections are rebuildable; they are not the only source of truth.**
15. **No agent completion implicitly applies files to the canonical project.**

## Milestone sequencing

Do not collapse the milestone order:

- **Milestone 0:** one truthful shared runtime; sequential scheduler; real process control and recovery.
- **Milestone 1:** immutable snapshots and separate portable-copy Surface Workspaces; attempts may still be scheduled sequentially.
- **Milestone 2:** Change Sets, review, merge preview, transactional apply, and rollback.
- **Milestone 3:** real bounded concurrent scheduling and candidate/sharded/race strategies.
- **Milestone 4:** composition, synthesis, conflict UX, and complete operator loop.
- **Milestone 5:** hardening and Desktop 1.0 release.

Do not claim that Milestones 0–1 deliver parallel agent execution. They make safe parallel execution possible without another state or workspace migration. Explicit parallel requests must fail truthfully until Milestone 3 is implemented.

## Current implementation order

Implement the PRs in `docs/plans/m0-m1-pr-manifest.yaml` in order:

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07
                                                    │
                                                    ▼
PR-08 → PR-09 → PR-10 ───────────────────────────→ PR-11 → PR-12
```

Start with PR-01 only. Do not begin a dependent PR until the prior dependency is merged and green, unless the owner explicitly authorizes parallel branch development.

Before each PR:

```bash
git fetch origin
git checkout main
git pull --ff-only
bun install
bun run check
```

Record path drift from the implementation plan in the PR description. Preserve the contract when a file has moved; update the plan/manifest only when the mapping change is durable.

## Repository architecture rules

### Interface layers

API routes, CLI handlers, chat actions, and UI hooks may:

- parse and validate requests;
- authorize and rate-limit;
- construct command context;
- call application services;
- map typed results to HTTP, CLI, or UI forms; and
- invalidate or refresh projections.

They may not own:

- prompt compilation;
- target resolution;
- gate evaluation;
- approval lookup/consumption;
- process spawn or termination;
- attempt lifecycle transitions;
- artifact finalization;
- snapshot/workspace provisioning;
- sequence compatibility status transitions; or
- thread-surface run finalization.

Those operations belong behind `ThreadOSRuntimeService` and its ports.

### Canonical state

Use:

- Zod for runtime contracts;
- atomic JSON for current entity records;
- append-only NDJSON for traces, approvals, and decisions;
- expected revision or precondition hashes for conflicting updates; and
- derived indexes for listing and UI performance.

Do not introduce a database during Milestones 0–1.

Canonical records must remain recoverable without the UI, in-memory state, or mprocs.

### Human-authored versus generated files

Human-authored configuration:

- `.threados/sequence.yaml`
- `.threados/policy.yaml`
- `.threados/workspace.yaml`
- pack definitions
- prompt and skill source files

Generated runtime data:

- runs and attempts
- process records
- snapshots
- workspace records
- traces
- approvals
- gate decisions
- Change Sets
- merge plans/results
- exports and indexes

Agents must not directly edit generated canonical records. Use repositories and services.

## Surface Workspace rules

For the portable copy provider:

- place workspace content outside the canonical project root;
- never recursively copy `.threados`, `.git`, runtime roots, or sibling workspaces;
- never use hardlinks for writable files;
- treat filenames and symlinks as untrusted;
- reject path traversal and escaping symlinks;
- materialize into staging and atomically rename after verification;
- verify manifest equivalence before dispatch;
- bind `cwd` to the workspace root;
- retain failed, interrupted, conflicted, and review-required workspaces by default;
- clean partial materializations on failure; and
- enforce file-count, byte, active-workspace, and retained-storage quotas.

Do not expose sibling workspace paths, semantic content, or private absolute paths in prompts or exports.

## Process rules

- Spawn with `shell: false` unless a reviewed adapter explicitly requires otherwise.
- Persist a redacted launch request before spawn.
- Persist environment key names, not secret values.
- Track PID/provider handle, attempt ID, workspace ID, status, timestamps, exit code, and signal.
- Cancellation must target the real process or process tree and observe termination before reporting success.
- Windows process-tree termination must use safe direct argument invocation; never interpolate an agent-controlled shell command.
- Timeouts and cancellation must retain truthful terminal states and artifacts.
- Recovery marks an absent unmanaged process `interrupted`/`lost`, not successful.

## Security rules

Treat all agent-produced content as untrusted:

- paths;
- filenames;
- patches;
- event payloads;
- JSON/structured output;
- logs;
- tool requests; and
- completion claims.

Required protections:

- canonical path containment;
- traversal rejection;
- symlink escape prevention;
- no hardlinks;
- output/log caps;
- safe environment filtering;
- secret redaction;
- exact approval payload binding;
- stale merge-plan rejection;
- atomic writes and rollback evidence; and
- explicit isolation labels.

Do not broaden network access, side-effect permissions, or allowed roots to make a test pass.

## TypeScript and code-quality rules

- Use TypeScript for new runtime code.
- Keep strict types at boundaries; avoid `any` and unchecked casts.
- Define contracts once and re-export them; do not maintain duplicate schema/type definitions.
- Use discriminated unions for commands, results, statuses, and typed errors.
- Use stable machine-readable error codes.
- Keep provider-specific logic behind adapters.
- Keep filesystem and process operations behind focused modules/ports.
- Prefer small, testable functions over route-sized orchestration.
- Preserve Node-compatible server execution even though Bun is the package manager/test runner.
- Support native Windows, WSL2, and Linux paths explicitly.
- Use existing formatting/lint conventions; do not introduce a second toolchain.

## Testing rules

Every behavior change starts with or includes targeted tests.

Required layers as applicable:

1. schema tests;
2. repository and revision tests;
3. runtime service tests;
4. real process integration tests;
5. filesystem snapshot/workspace integration tests;
6. API mapping tests;
7. CLI JSON and exit-code tests;
8. architecture guard tests; and
9. Playwright operator-flow tests.

Use real temporary files and deterministic fixture processes for integration behavior. Do not mock away the behavior under test.

Minimum per PR:

```bash
bun run typecheck
bun run lint
# targeted bun test commands from the canonical implementation plan
```

Milestone close:

```bash
bun run check
bun run build
bun test:ui
bun run verify:local
```

Also run the milestone proof command introduced by that milestone.

A passing test claim requires captured command output. State clearly when a command was not run and why.

## PR discipline

Each PR must:

- match one manifest entry;
- stay within its declared scope unless a necessary dependency is documented;
- preserve compatibility routes and existing local-first data;
- avoid broad visual redesign;
- add or update focused tests;
- update the canonical plan/manifest only for durable path or contract changes;
- include migration and rollback notes;
- include exact validation commands and outputs; and
- leave `main` deployable.

Do not bundle unrelated cleanup into runtime PRs. Do not delete legacy readers before parity and compatibility proofs pass.

Recommended commit form:

```text
<type>(<scope>): <imperative summary>
```

The PR description must include:

- canonical PR ID;
- objective;
- files changed;
- contract/state impact;
- compatibility impact;
- security considerations;
- tests run;
- not-tested items;
- rollback path; and
- evidence for the PR gate.

## Documentation rules

- Keep product claims aligned with executable behavior.
- Never describe sequential execution as parallel.
- Never describe `THREADOS_SCOPED` as host isolation.
- Never imply that Git is required.
- Never instruct users to create or manage worktrees.
- Keep the CLI and app documentation consistent with the shared runtime.
- Update `docs/product/current-state.md` whenever implementation status materially changes.
- Update `docs/product/architecture-map.md` when ownership or runtime boundaries change.
- Update `docs/cli-reference.md` for every CLI contract change.

## Prohibited shortcuts

Do not:

- call `git worktree` from production code;
- use branches as the canonical Change Set abstraction;
- let agents write the canonical project during isolated attempts;
- report process control success after swallowing an error;
- flip a historical attempt back to `running`;
- persist secrets or full unredacted launch commands;
- use hardlinks for writable workspace materialization;
- follow escaping symlinks;
- derive success from agent prose or exit code alone when contracts/gates apply;
- add a second runtime lifecycle in a route, CLI command, or UI action;
- auto-apply agent changes before Milestone 2;
- enable `--parallel` before Milestone 3; or
- weaken policy, gates, approvals, or isolation to satisfy a test.

## Completion protocol

Before declaring a task complete:

1. verify the change against the canonical PRD and current manifest entry;
2. inspect the diff for scope creep and generated artifacts;
3. run targeted tests, typecheck, and lint;
4. run broader checks required by the PR gate;
5. inspect persisted runtime output when state behavior changed;
6. confirm no worktree invocation or canonical-workspace write path was introduced;
7. update documentation and tests;
8. clean temporary files, workspaces, fixtures, and debug output; and
9. report what passed, what was not run, risks, and the next manifest PR.

Do not claim the product or milestone is complete until its canonical evidence bundle and exit gate pass.

---

# MILESTONES 0–1 IMPLEMENTATION PLAN

# thredOS Desktop 1.0
## Canonical Repository-Mapped Implementation Plan — Milestones 0 and 1

**Document status:** Final canonical delivery plan subordinate to the canonical PRD  
**Version:** 1.1  
**Date:** 2026-07-15  
**Product:** thredOS Desktop  
**Repository:** `OmarA1-Bakri-Org/thredOS`  
**Parent specification:** `docs/product/canonical-prd-worktree-free-parallel-runtime.md`  
**Supersedes:** All earlier Milestones 0–1 implementation-plan drafts in this project  
**Scope:** Milestone 0 — Contract and Runtime Convergence; Milestone 1 — Portable Surface Workspace Engine

---

## 0. Authority, scope, and implementation boundary

This document converts the canonical worktree-free parallel-runtime PRD into an executable repository plan. It defines the merge order, contracts, file layout, migration strategy, tests, and acceptance evidence for the first two milestones.

Authority order for implementation is:

1. `docs/product/canonical-prd-worktree-free-parallel-runtime.md`;
2. `AGENTS.md`;
3. this implementation plan;
4. `docs/plans/m0-m1-pr-manifest.yaml`.

Where this implementation plan conflicts with the canonical PRD, the PRD wins. Where it conflicts with `AGENTS.md` on repository conduct, safety, validation, or contribution mechanics, the stricter compatible rule applies. Where a repository path has moved since the reviewed baseline, preserve the contract and update the path mapping in the affected pull request and manifest.

### 0.1 Outcomes covered

Milestone 0 must establish one truthful runtime path shared by the desktop app, local API, CLI, chat/apply layer, and future MCP integrations.

Milestone 1 must establish independent writable Surface Workspaces created from one immutable baseline snapshot without using Git worktrees.

### 0.2 Outcomes deliberately deferred

The following are designed by the contracts in this plan but implemented after Milestone 1:

- filesystem Change Set capture and review — Milestone 2;
- three-way merge, preview, transactional apply, and rollback — Milestone 2;
- real bounded multi-process concurrency — Milestone 3;
- candidate/race scheduling and first-passing policies — Milestone 3;
- OverlayFS and container providers — P1;
- host-enforced isolation — P1.

Milestones 0 and 1 are not a customer-facing completion point. The combined implementation proves that multiple attempts can receive independent, identical baseline workspaces while the canonical project remains unchanged. Those attempts may still be scheduled one at a time during this tranche. Milestone 3 turns the same run, attempt, process, snapshot, and workspace contracts into bounded concurrent execution without another migration.

### 0.3 Non-negotiable engineering invariants

1. No production runtime code may invoke `git worktree`.
2. Route handlers and CLI handlers may parse, authorize, invoke, and render; they may not own execution lifecycle logic.
3. A workflow run and a step attempt are separate persisted entities.
4. Every mutating command is idempotent.
5. No process is spawned before its attempt and launch request are persisted.
6. Stop and cancel succeed only after actual process-control success or an explicitly truthful terminal state.
7. Restart creates a new attempt linked to the previous attempt.
8. No write-capable isolated attempt runs without an immutable snapshot and verified Surface Workspace.
9. The canonical workspace is never used as the `cwd` of an isolated write-capable attempt.
10. Directory-scoped isolation is labelled `THREADOS_SCOPED`, never `HOST_ENFORCED`.
11. Existing `.threados/sequence.yaml`, thread-surface projections, gates, approvals, traces, and export behavior remain compatible.
12. No destructive rewrite of legacy runtime artifacts occurs automatically.

---

# 1. Reviewed repository baseline

The implementation plan maps to the following current product areas.

| Existing area | Current responsibility | Planned treatment |
|---|---|---|
| `app/api/run/route.ts` | Full app-side execution lifecycle | Extract lifecycle into shared runtime service; retain compatibility route |
| `app/api/stop/route.ts` | App-side process stop | Delegate to process controller through runtime service |
| `app/api/restart/route.ts` | App-side restart | Delegate; create new attempt lineage |
| `app/api/status/route.ts` | Reconciled sequence status | Add canonical run/attempt projection while retaining sequence summary |
| `lib/seqctl/commands/run.ts` | Separate CLI execution lifecycle | Replace with shared runtime-service calls |
| `lib/seqctl/commands/control.ts` | CLI stop/restart, including permissive state flips | Replace with truthful shared controls |
| `lib/seqctl/commands/status.ts` | Sequence and mprocs status | Consume canonical runtime projections |
| `lib/runner/dispatch.ts` | Provider-specific launch configuration | Retain; accept attempt/workspace context |
| `lib/runner/wrapper.ts` | Spawn, timeout, stdout/stderr collection | Retain; expose cancellable process handle |
| `lib/runner/artifacts.ts` | Run logs and canonical surface artifacts | Extend for workflow-run/attempt identity |
| `lib/thread-surfaces/` | Surfaces, run scopes, events, spawn and merge projections | Retain; add attempt/workspace/snapshot references |
| `lib/contracts/schemas.ts` | V1 contracts for surfaces, runs, gates, approvals, traces | Extend through focused runtime/workspace schemas and re-exports |
| `lib/gates/` | Deterministic pre-run and completion gates | Retain; add snapshot/workspace gates in Milestone 1 |
| `lib/approvals/` | Append-only approval lifecycle | Retain; runtime service remains the only consumer for execution authority |
| `lib/traces/` | Per-run append-only trace | Extend event vocabulary |
| `lib/reconciliation/reconciler.ts` | mprocs-oriented orphan reconciliation | Generalize to canonical process records; retain legacy mprocs reconciliation |
| `lib/mprocs/` | Optional process manager and status map | Retain as observer/legacy adapter, not source of truth |
| `lib/ui/api.ts` | App hooks for local APIs | Add runs, attempts, process controls, and workspaces |
| `components/workbench/sections/RunSection.tsx` | Run controls and evidence summaries | Enable real stop/retry and add workspace inspection |
| `lib/local-first/` | Local workspace identity and residency | Reuse workspace ID and base path for external runtime roots |

### 1.1 Preflight drift audit

Before coding the first PR:

```bash
git fetch origin
git checkout main
git pull --ff-only
bun install
bun run check

rg -n "executeSingleStep|runStep\(|saveRunArtifacts|createRootRunScope|finalizeRootRunScope" app lib
rg -n "spawn\(|Bun\.spawn|MprocsClient|updateStepProcess" app lib desktop
rg -n "thread-surfaces|run\.json|approvals\.ndjson|gate-decisions\.ndjson|trace\.ndjson" app lib test
```

Record moved paths in the first PR description. Do not change the contracts in this plan merely because a file moved.

---

# 2. Delivery strategy

## 2.1 Merge discipline

- Merge PRs in the order specified below.
- Every PR must leave `main` deployable and all existing compatibility routes operational.
- A PR may introduce an unused contract or implementation behind the shared service, but it may not create a second public execution path.
- Use additive schemas first, then migrate callers.
- Delete old lifecycle helpers only after API and CLI parity tests prove the cutover.
- No long-lived feature flag is required. Test dependency injection and compatibility adapters provide rollback safety.

## 2.2 Pull-request sequence

| PR | Milestone | Branch | Size | Primary outcome |
|---:|---|---|---|---|
| 01 | M0 | `feat/runtime-contracts-v2` | M | Canonical run, attempt, process, workspace, change, and merge schemas |
| 02 | M0 | `feat/runtime-repositories-v2` | M | Atomic repositories, revisions, idempotency, and legacy projections |
| 03 | M0 | `feat/runtime-service-v2` | L | One sequential runtime service and attempt executor |
| 04 | M0 | `refactor/api-runtime-service` | M | Local API routes delegate to the service |
| 05 | M0 | `refactor/cli-runtime-service` | M | CLI delegates to the same service with stable JSON |
| 06 | M0 | `feat/truthful-process-control` | L | Cancellable process handles, retry lineage, and recovery |
| 07 | M0 | `feat/runtime-operator-projections` | M | Run/attempt APIs, app controls, parity and architecture proofs |
| 08 | M1 | `feat/workspace-config-paths` | M | Workspace policy, paths, exclusions, and external runtime root |
| 09 | M1 | `feat/immutable-snapshot-engine` | L | Dirty/non-Git-safe immutable baseline snapshots |
| 10 | M1 | `feat/copy-workspace-provider` | L | Portable verified copy workspaces, quotas, retention, cleanup |
| 11 | M1 | `feat/isolated-attempt-dispatch` | L | Runtime binds write attempts to verified workspace `cwd` |
| 12 | M1 | `feat/workspace-operator-surface` | M | Workspace API/CLI/UI, doctor, release proof, no-worktree guard |

Dependency graph:

```text
PR-01 → PR-02 → PR-03 → PR-04 → PR-05 → PR-06 → PR-07
                                                    │
                                                    ▼
PR-08 → PR-09 → PR-10 ───────────────────────────→ PR-11 → PR-12
```

PR-08 may be developed after PR-02, but it must not merge ahead of PR-07 unless all shared-service interfaces have stabilized.

---

# 3. Canonical persistence model

## 3.1 New generated layout

```text
.threados/
├── runs/
│   └── <workflowRunId>/
│       ├── run.json
│       ├── trace.ndjson
│       ├── approvals.ndjson
│       ├── gate-decisions.ndjson
│       ├── attempts/
│       │   └── <attemptId>/
│       │       ├── attempt.json
│       │       ├── process.json
│       │       ├── input.manifest.json
│       │       ├── output.manifest.json
│       │       ├── workspace.ref.json
│       │       ├── stdout.log
│       │       └── stderr.log
│       └── surfaces/
│           └── <surfaceId>/
│               └── existing canonical surface-run artifacts
├── snapshots/
│   └── <snapshotId>/
│       ├── snapshot.json
│       └── manifest.json
├── workspaces/
│   └── index.json
└── state/
    ├── runtime-index.json
    ├── runtime-commands/
    │   └── <commandId>.json
    └── existing compatibility state
```

Actual snapshot trees and attempt workspaces live outside the canonical project:

```text
<runtimeDataRoot>/
├── snapshots/<localWorkspaceId>/<snapshotId>/tree/
└── workspaces/<localWorkspaceId>/<workflowRunId>/<workspaceId>/tree/
```

## 3.2 Compatibility rules

- Existing `.threados/runs/<runId>/<stepId>/` artifacts remain readable.
- Existing `.threados/runs/<runId>/run.json` is parsed through `LegacyRunRecordSchema` when it does not carry `schema_version: 2`.
- Existing `thread-surfaces.json` remains a compatibility projection.
- Existing per-surface canonical records remain authoritative for surface metadata.
- New attempts write only the V2 run/attempt layout plus existing surface projections needed by the current UI.
- No automatic deletion or in-place rewrite of legacy runs.

---

# 4. Canonical contracts

The exact Zod implementations may be split across modules, but field names and state semantics are locked.

## 4.1 `WorkflowRun`

```ts
const WorkflowRunStatusSchema = z.enum([
  'pending',
  'provisioning',
  'running',
  'awaiting_review',
  'applying',
  'successful',
  'partially_successful',
  'failed',
  'cancelled',
  'interrupted',
])

const WorkflowRunSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sequence_id: z.string().min(1),
  sequence_snapshot_hash: z.string().min(1),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('step'), step_id: z.string().min(1) }),
    z.object({ kind: z.literal('group'), group_id: z.string().min(1) }),
    z.object({ kind: z.literal('runnable') }),
  ]),
  strategy: z.enum(['sequential', 'candidate', 'sharded', 'race']),
  status: WorkflowRunStatusSchema,
  max_concurrency: z.number().int().positive(),
  policy_snapshot_hash: z.string().min(1),
  baseline_snapshot_id: z.string().nullable(),
  attempt_ids: z.array(z.string()),
  created_by: z.string().min(1),
  created_via: z.enum(['api', 'cli', 'chat', 'mcp', 'system']),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  cancellation_requested_at: z.string().datetime().nullable(),
  summary: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
```

## 4.2 `StepAttempt`

```ts
const StepAttemptStatusSchema = z.enum([
  'pending',
  'provisioning',
  'running',
  'completed',
  'needs_review',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
])

const StepAttemptSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  sequence_id: z.string().min(1),
  step_id: z.string().min(1),
  surface_id: z.string().min(1),
  execution_index: z.number().int().positive(),
  attempt_number: z.number().int().positive(),
  retry_of_attempt_id: z.string().nullable(),
  status: StepAttemptStatusSchema,
  agent_ref: z.string().nullable(),
  model: z.string().min(1),
  side_effect_class: z.enum(['none', 'read', 'write', 'execute']),
  baseline_snapshot_id: z.string().nullable(),
  workspace_id: z.string().nullable(),
  process_id: z.string().nullable(),
  compiled_prompt_hash: z.string().min(1),
  input_manifest_ref: z.string().nullable(),
  output_manifest_ref: z.string().nullable(),
  artifact_manifest_ref: z.string().nullable(),
  change_set_id: z.string().nullable(),
  gate_decision_refs: z.array(z.string()),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  last_heartbeat_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
```

## 4.3 `ProcessRecord`

```ts
const ProcessStatusSchema = z.enum([
  'planned',
  'starting',
  'running',
  'terminating',
  'exited',
  'lost',
])

const ProcessRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  provider: z.enum(['local-process', 'mprocs-legacy']),
  provider_handle: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  command: z.string().min(1),
  redacted_args: z.array(z.string()),
  cwd: z.string().min(1),
  status: ProcessStatusSchema,
  launch_requested_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  last_output_at: z.string().datetime().nullable(),
  cancellation_requested_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
})
```

## 4.4 `RuntimeCommandReceipt`

```ts
const RuntimeCommandReceiptSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  idempotency_key: z.string().min(1),
  command_type: z.enum([
    'start-run',
    'cancel-run',
    'cancel-attempt',
    'retry-attempt',
    'retain-workspace',
    'clean-workspace',
  ]),
  request_hash: z.string().min(1),
  status: z.enum(['accepted', 'completed', 'failed']),
  result_ref: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
})
```

A reused idempotency key with a different request hash fails with `IDEMPOTENCY_CONFLICT`.

## 4.5 `WorkspaceSnapshot`

```ts
const SnapshotEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['file', 'directory', 'symlink']),
  sha256: z.string().nullable(),
  size_bytes: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative().nullable(),
  symlink_target: z.string().nullable(),
})

const SnapshotManifestSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1),
  root_manifest_hash: z.string().min(1),
  entries: z.array(SnapshotEntrySchema),
})

const WorkspaceSnapshotSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  local_workspace_id: z.string().min(1),
  source_root: z.string().min(1),
  content_root: z.string().nullable(),
  manifest_ref: z.string().nullable(),
  status: z.enum(['creating', 'ready', 'failed', 'deleted']),
  root_manifest_hash: z.string().nullable(),
  exclusion_policy_hash: z.string().min(1),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  git_head: z.string().nullable(),
  git_dirty: z.boolean().nullable(),
  created_at: z.string().datetime(),
  verified_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
```

## 4.6 `SurfaceWorkspace`

```ts
const SurfaceWorkspaceSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  surface_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  provider: z.enum(['copy', 'overlayfs', 'container']),
  isolation_label: z.enum(['THREADOS_SCOPED', 'HOST_ENFORCED']),
  root_path: z.string().min(1),
  status: z.enum([
    'planned',
    'materializing',
    'ready',
    'active',
    'frozen',
    'retained',
    'cleaning',
    'cleaned',
    'failed',
  ]),
  retention_policy: z.enum([
    'cleanup_on_success',
    'retain_until_applied',
    'retain_on_failure',
    'retain_always',
  ]),
  manifest_hash: z.string().nullable(),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable(),
  cleaned_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
```

## 4.7 Forward contracts created in M0 but implemented later

Create and validate minimal canonical schemas for:

- `ChangeSet`;
- `MergePlan`;
- `MergeConflict`;
- `MergeResult`.

They remain unused until Milestone 2. This prevents attempt/workspace records from needing another breaking migration when `change_set_id` and merge references become active.

---

# 5. Runtime service boundary

## 5.1 Public service contract

```ts
interface ThreadOSRuntimeService {
  startRun(request: StartRunRequest, context: RuntimeCommandContext): Promise<WorkflowRun>
  runAndWait(request: StartRunRequest, context: RuntimeCommandContext): Promise<RunProjection>
  inspectRun(runId: string): Promise<RunProjection>
  listRuns(query?: RunQuery): Promise<RunProjection[]>
  inspectAttempt(attemptId: string): Promise<AttemptProjection>
  cancelRun(runId: string, context: RuntimeCommandContext): Promise<WorkflowRun>
  cancelAttempt(attemptId: string, context: RuntimeCommandContext): Promise<StepAttempt>
  retryAttempt(attemptId: string, context: RuntimeCommandContext): Promise<StepAttempt>
  reconcile(): Promise<ReconciliationReport>
}
```

Milestone 1 extends the service with:

```ts
interface ThreadOSWorkspaceService {
  listWorkspaces(query?: WorkspaceQuery): Promise<SurfaceWorkspace[]>
  inspectWorkspace(workspaceId: string): Promise<WorkspaceProjection>
  retainWorkspace(workspaceId: string, context: RuntimeCommandContext): Promise<SurfaceWorkspace>
  cleanWorkspace(workspaceId: string, context: RuntimeCommandContext): Promise<SurfaceWorkspace>
  doctor(): Promise<WorkspaceDoctorReport>
}
```

## 5.2 Command context

```ts
interface RuntimeCommandContext {
  actor: string
  interface: 'api' | 'cli' | 'chat' | 'mcp' | 'system'
  idempotencyKey: string
  policyConfirmed: boolean
  requestId?: string
}
```

## 5.3 Service factory and lifecycle

Create a base-path-keyed singleton factory:

```ts
getThreadOSRuntimeService(basePath: string): ThreadOSRuntimeService
```

Requirements:

- one service instance per canonical workspace within the local Next.js process;
- dependency injection for tests;
- no global mutable state beyond the explicit service registry;
- repositories remain file-backed, so service recreation is safe;
- `reconcile()` runs once when a service is first created and may be called explicitly.

## 5.4 Layering rule

Allowed direction:

```text
app/api/* ─┐
seqctl/*  ─┼→ runtime/service → scheduler/executor → runner/workspaces/gates
chat/*    ─┘
```

Forbidden imports after M0:

- `app/api/run|stop|restart` importing `lib/runner/*` directly;
- `lib/seqctl/commands/run|control` importing `lib/runner/*` directly;
- route or CLI code mutating step status as a substitute for process control;
- route or CLI code creating run IDs independently of the runtime service.

---

# 6. Migration and cutover strategy

## 6.1 Migration principles

- New state is additive.
- New reads understand legacy and V2 records.
- New writes use V2 records.
- Surface-state compatibility projections continue to be updated.
- No automatic bulk migration is required for Desktop 1.0.
- Export logic includes both legacy and V2 runs with an explicit source/version field.

## 6.2 Legacy run projection

Create `LegacyRunRecordSchema` for the existing `run.json` shape and project it into:

```text
WorkflowRun.status       ← legacy status
WorkflowRun.target       ← step:<legacy step_id>
WorkflowRun.strategy     ← sequential
StepAttempt.workspace_id ← null
StepAttempt.snapshot_id  ← null
StepAttempt.status       ← mapped legacy status
ProcessRecord.provider   ← mprocs-legacy or absent
```

Projected legacy records are read-only. Any retry creates a new V2 run/attempt.

## 6.3 Thread-surface linkage

Extend existing surface/run-event types additively with optional references:

```ts
workflowRunId?: string
attemptId?: string
workspaceId?: string
snapshotId?: string
changeSetId?: string
```

During M0, new attempts write these references. Existing projections without them remain valid.

## 6.4 Cutover order

1. Land schemas.
2. Land repositories and projections.
3. Build and test the service without public callers.
4. Cut API to the service.
5. Cut CLI to the service.
6. Delete duplicated lifecycle code.
7. Introduce process-control/recovery changes.
8. Update UI and status projections.
9. Add workspace contracts and engines.
10. Bind execution to isolated workspaces.

---

# 7. Detailed pull-request specifications

## PR-01 — Canonical runtime and workspace contracts

**Branch:** `feat/runtime-contracts-v2`  
**Milestone:** 0  
**Risk:** Low  
**Purpose:** Establish the stable domain model before moving behavior.

### Create

```text
lib/runtime/schema.ts
lib/runtime/command-schema.ts
lib/runtime/error-codes.ts
lib/runtime/schema.test.ts
lib/workspaces/schema.ts
lib/workspaces/schema.test.ts
lib/changesets/schema.ts
lib/changesets/schema.test.ts
lib/merge/schema.ts
lib/merge/schema.test.ts
```

### Modify

```text
lib/contracts/schemas.ts
lib/thread-surfaces/types.ts
```

### Required changes

- Implement the contracts in Section 4.
- Re-export the new schemas from a stable barrel without replacing existing public types.
- Add optional V2 references to thread-surface run/event types.
- Add runtime error codes in `lib/runtime/error-codes.ts`:

```text
IDEMPOTENCY_CONFLICT
RUN_NOT_FOUND
ATTEMPT_NOT_FOUND
ATTEMPT_NOT_RUNNING
PROCESS_CONTROL_FAILED
PROCESS_LOST
SNAPSHOT_REQUIRED
SNAPSHOT_SOURCE_CHANGED
SNAPSHOT_SOURCE_BUSY
WORKSPACE_REQUIRED
WORKSPACE_PROVISION_FAILED
WORKSPACE_MANIFEST_INVALID
WORKSPACE_QUOTA_EXCEEDED
WORKSPACE_NOT_FOUND
WORKSPACE_NOT_CLEANABLE
```

- Reserve `lib/contracts/reason-codes.ts` for deterministic gate reasons; Milestone 1 adds snapshot/workspace gate reasons there.
- Do not alter execution behavior.

### Tests

- Every status enum accepts only canonical values.
- Run and attempt IDs are distinct and both required.
- `workspace_id` and `baseline_snapshot_id` are nullable for legacy projections.
- `HOST_ENFORCED` is valid as a contract but not emitted by the copy provider.
- Forward Change Set and merge contracts validate representative examples.
- Thread-surface legacy objects still normalize.

### Validation

```bash
bun test lib/runtime/schema.test.ts \
  lib/workspaces/schema.test.ts \
  lib/changesets/schema.test.ts \
  lib/merge/schema.test.ts \
  lib/contracts/schemas.test.ts
bun run typecheck
bun run lint
```

### Exit gate

All contracts are stable and no existing runtime or UI test regresses.

---

## PR-02 — Atomic runtime repositories and idempotency

**Branch:** `feat/runtime-repositories-v2`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/runtime/paths.ts
lib/runtime/run-repository.ts
lib/runtime/attempt-repository.ts
lib/runtime/process-repository.ts
lib/runtime/command-repository.ts
lib/runtime/runtime-index.ts
lib/runtime/legacy-projection.ts
lib/runtime/repositories.test.ts
lib/runtime/legacy-projection.test.ts
```

### Modify

```text
lib/fs/atomic.ts
lib/thread-surfaces/repository.ts
lib/runner/artifacts.ts
lib/exports/bundler.ts
```

### Required changes

- Add typed path builders. Validate all IDs before using them in paths.
- Persist run, attempt, process, and command records with atomic writes.
- Use optimistic revision checks equivalent to the current thread-surface repository.
- Maintain `.threados/state/runtime-index.json` as a derived lookup index, not authoritative state.
- Implement command-receipt lookup by idempotency key.
- Implement `LegacyRunRecordSchema` and non-destructive projection.
- Extend export discovery so V2 attempts are visible, while keeping legacy bundles valid.
- Do not write the same `run.json` once per step. One workflow run owns one file.

### Repository API

```ts
interface RunRepository {
  create(run: WorkflowRun): Promise<void>
  get(runId: string): Promise<WorkflowRun | null>
  update(runId: string, expectedRevision: number, mutate: RunMutation): Promise<WorkflowRun>
  list(query?: RunQuery): Promise<WorkflowRun[]>
}

interface AttemptRepository {
  create(attempt: StepAttempt): Promise<void>
  get(attemptId: string): Promise<StepAttempt | null>
  listForRun(runId: string): Promise<StepAttempt[]>
  update(attemptId: string, expectedRevision: number, mutate: AttemptMutation): Promise<StepAttempt>
}
```

### Tests

- Concurrent revision mismatch fails closed.
- Atomic write failure leaves the prior valid file intact.
- Two attempts do not overwrite one run record.
- Replayed command returns its original result reference.
- Reused idempotency key with changed payload is rejected.
- Malicious run/attempt IDs cannot escape `.threados/runs`.
- Legacy run records project without being rewritten.
- Derived index can be deleted and rebuilt from authoritative records.

### Validation

```bash
bun test lib/runtime/repositories.test.ts \
  lib/runtime/legacy-projection.test.ts \
  lib/thread-surfaces/repository.test.ts \
  lib/exports/bundler.test.ts
bun run typecheck
bun run lint
```

### Exit gate

A fixture can create one run with two attempts, reopen fresh repository instances, and reconstruct the same state.

---

## PR-03 — Shared runtime service and sequential scheduler

**Branch:** `feat/runtime-service-v2`  
**Milestone:** 0  
**Risk:** High

### Create

```text
lib/runtime/service-types.ts
lib/runtime/service.ts
lib/runtime/factory.ts
lib/runtime/scheduler.ts
lib/runtime/attempt-executor.ts
lib/runtime/lifecycle.ts
lib/runtime/errors.ts
lib/runtime/projections.ts
lib/runtime/service.test.ts
lib/runtime/attempt-executor.test.ts
```

### Modify

```text
lib/runner/artifacts.ts
lib/thread-surfaces/step-run-runtime.ts
lib/thread-surfaces/mutations.ts
lib/gates/engine.ts
lib/approvals/runtime.ts
lib/traces/writer.ts
```

### Required changes

- Extract the richer lifecycle currently embedded in `app/api/run/route.ts` into `ThreadOSRuntimeService` and `AttemptExecutor`.
- Preserve:
  - sequence read and DAG validation;
  - prompt existence and compilation;
  - policy evaluation;
  - approval lookup;
  - deterministic pre-run gates;
  - gate-decision persistence;
  - run and attempt persistence;
  - artifact persistence;
  - completion gates;
  - surface-run finalization;
  - runtime delegation events;
  - traces and audit hooks.
- Implement a scheduler with `maxConcurrency = 1`. This is intentional for M0.
- Persist run and attempt before dispatch.
- Persist a planned process record before spawn.
- Expose `runAndWait()` for compatibility callers.
- Keep provider launch construction in `lib/runner/dispatch.ts`.
- Keep the current execution path available only as an internal compatibility adapter until PR-05.

### Lifecycle transitions

```text
run: pending → provisioning → running → successful|failed|cancelled|interrupted
attempt: pending → provisioning → running → completed|needs_review|failed|cancelled|timed_out|interrupted
process: planned → starting → running → terminating|exited|lost
```

Invalid transitions throw `INVALID_RUNTIME_TRANSITION` and do not write partial state.

### Tests

- One successful mock attempt produces a V2 run, attempt, process, gates, trace, and artifacts.
- A blocked pre-run gate never spawns a process.
- A completion-gate failure produces `needs_review` or `failed` according to policy.
- A duplicate `startRun` command is idempotent.
- Failure after run creation but before spawn remains recoverable.
- Surface-run projections are updated once.
- Provider adapters remain mockable through service dependencies.

### Validation

```bash
bun test lib/runtime/service.test.ts \
  lib/runtime/attempt-executor.test.ts \
  lib/gates/engine.test.ts \
  lib/gates/rules.test.ts \
  test/api/runtime-persistence-proof.test.ts
bun run typecheck
bun run lint
```

### Exit gate

The service completes one sequential mock attempt without invoking an API or CLI handler.

---

## PR-04 — API cutover to the shared runtime service

**Branch:** `refactor/api-runtime-service`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/api/runtime-request.ts
app/api/runs/route.ts
app/api/runs/[runId]/route.ts
app/api/runs/[runId]/cancel/route.ts
app/api/attempts/[attemptId]/route.ts
app/api/attempts/[attemptId]/cancel/route.ts
app/api/attempts/[attemptId]/retry/route.ts
test/api/runtime-v2-routes.test.ts
```

### Modify

```text
app/api/run/route.ts
app/api/stop/route.ts
app/api/restart/route.ts
app/api/status/route.ts
lib/api-helpers.ts
```

### Required changes

- Reduce compatibility routes to:
  1. request parsing;
  2. session authorization;
  3. rate limiting;
  4. idempotency-key resolution;
  5. service invocation;
  6. typed response mapping.
- `POST /api/run` remains compatible and calls `runAndWait()`.
- `POST /api/runs` accepts a canonical start request and returns `202` with the run projection.
- `POST /api/stop` maps a step ID to its active attempt, then calls `cancelAttempt`.
- `POST /api/restart` retries the latest terminal attempt for the step; it never flips status directly.
- Return stable error codes and HTTP mappings.
- Accept `Idempotency-Key`; generate and return one when absent for local UI compatibility.
- Remove direct runner, surface mutation, and gate lifecycle imports from the route layer.

### Tests

- Existing `/api/run` behavior remains compatible.
- Resource routes return canonical V2 projections.
- Stop on a non-running step returns `409 ATTEMPT_NOT_RUNNING`.
- Retry returns a new attempt ID and `retry_of_attempt_id`.
- Identical API and direct-service requests produce equivalent persisted state.
- Route replay with the same idempotency key does not spawn twice.

### Validation

```bash
bun test test/api/runtime-v2-routes.test.ts \
  test/api/run-route-coverage.test.ts \
  test/api/runtime-persistence-proof.test.ts \
  test/api/thread-run-lifecycle.test.ts \
  test/api/routes.test.ts
bun run typecheck
bun run lint
```

### Exit gate

All app-side execution and control routes use the shared service. `app/api/run/route.ts` contains no execution lifecycle implementation.

---

## PR-05 — CLI cutover and stable runtime JSON

**Branch:** `refactor/cli-runtime-service`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
lib/seqctl/commands/attempt.ts
lib/seqctl/formatters/runtime.ts
lib/seqctl/runtime-json-schema.ts
lib/seqctl/commands/attempt.test.ts
lib/seqctl/runtime-parity.test.ts
```

### Modify

```text
lib/seqctl/index.ts
lib/seqctl/commands/run.ts
lib/seqctl/commands/control.ts
lib/seqctl/commands/status.ts
lib/seqctl/commands/group.ts
lib/seqctl/commands/mprocs.ts
```

### Required changes

- Replace CLI lifecycle implementation with runtime-service calls.
- Preserve existing commands:

```text
thread run step <stepId>
thread run runnable
thread run group <groupId>
thread stop <stepId>
thread restart <stepId>
thread status
```

- Add:

```text
thread run list
thread run inspect <runId>
thread run cancel <runId>
thread attempt inspect <attemptId>
thread attempt cancel <attemptId>
thread attempt retry <attemptId>
```

- `thread restart <stepId>` becomes a compatibility alias for retrying the latest eligible attempt.
- Remove `updateStepProcess()` calls after a completed direct process.
- `mprocs` commands remain available as optional observer/legacy controls but do not update canonical V2 status.
- Version JSON output:

```json
{
  "schemaVersion": 1,
  "success": true,
  "data": {}
}
```

- Non-zero exit for blocked, approval-required, unavailable, cancelled, conflicted, or failed operations.

### Tests

- CLI and API fixture requests produce the same run/attempt states.
- `thread stop` cannot report success if the process controller failed.
- `thread restart` creates new attempt lineage.
- Every added command supports `--json`.
- Existing human-readable commands remain usable.
- CLI handlers no longer import `runner/wrapper`, `runner/dispatch`, or artifact lifecycle functions.

### Validation

```bash
bun test lib/seqctl/runtime-parity.test.ts \
  lib/seqctl/commands/attempt.test.ts \
  lib/seqctl/commands/run.test.ts \
  lib/seqctl/commands/control.test.ts \
  test/integration/cli-flow.test.ts
bun run typecheck
bun run lint
```

### Exit gate

One step run started through CLI and one started through API produce the same canonical file tree and equivalent projections.

---

## PR-06 — Truthful process control, retry, and recovery

**Branch:** `feat/truthful-process-control`  
**Milestone:** 0  
**Risk:** High

### Create

```text
lib/runner/process-handle.ts
lib/runtime/process-controller.ts
lib/runtime/recovery.ts
lib/runtime/process-controller.test.ts
lib/runtime/recovery.test.ts
test/fixtures/process/long-running.mjs
test/fixtures/process/exit-with-code.mjs
test/fixtures/process/write-heartbeat.mjs
```

### Modify

```text
lib/runner/wrapper.ts
lib/runtime/attempt-executor.ts
lib/runtime/service.ts
lib/reconciliation/reconciler.ts
lib/mprocs/state.ts
app/api/stop/route.ts
app/api/restart/route.ts
lib/seqctl/commands/control.ts
```

### Required changes

Refactor the runner to expose:

```ts
interface RunningProcessHandle {
  processId: string
  pid: number | null
  result: Promise<RawProcessResult>
  cancel(signal?: 'SIGTERM' | 'SIGKILL'): Promise<ProcessControlResult>
}

startProcess(config: RunnerConfig): Promise<RunningProcessHandle>
runStep(config: RunnerConfig): Promise<RunResult> // compatibility wrapper
```

- Persist process record before calling `spawn`.
- Update PID/status immediately after successful spawn.
- Stream heartbeat/output timestamps into the process record using throttled writes.
- Cancel sends graceful termination, waits a bounded interval, then escalates.
- Success requires process exit or a truthful `PROCESS_CONTROL_FAILED` result.
- Recovery on service startup:
  - inspect persisted `starting`, `running`, and `terminating` records;
  - test PID existence where supported;
  - because stdout/stderr cannot be safely reattached after server restart, mark the attempt `interrupted` and process `lost`;
  - optionally terminate a still-live orphan according to policy;
  - retain artifacts/workspace references;
  - never leave stale `running` state.
- Retry always creates a new attempt and process record.
- Keep legacy mprocs reconciliation for legacy runs only.

### Tests

- Cancel terminates a real fixture process.
- Failed kill returns non-success and does not claim cancellation.
- Timeout escalates and records `timed_out`.
- Startup reconciliation marks an unattachable process `interrupted`.
- Retry links to the prior attempt and starts from a clean lifecycle.
- Process arguments are redacted before persistence.
- Output/heartbeat writes are bounded and do not rewrite state per byte.

### Validation

```bash
bun test lib/runtime/process-controller.test.ts \
  lib/runtime/recovery.test.ts \
  lib/runner/wrapper.test.ts \
  lib/reconciliation/reconciler.test.ts \
  test/api/thread-run-lifecycle.test.ts
bun run typecheck
bun run lint
```

### Exit gate

The app and CLI can stop a real long-running fixture, retry it as a new attempt, and recover truthfully after simulated service restart.

---

## PR-07 — Runtime projections, operator controls, and M0 proof

**Branch:** `feat/runtime-operator-projections`  
**Milestone:** 0  
**Risk:** Medium

### Create

```text
app/api/runs/[runId]/attempts/route.ts
lib/runtime/projections.test.ts
test/architecture/runtime-service-boundary.test.ts
test/integration/runtime-interface-parity.test.ts
components/workbench/sections/RunSection.runtime.test.tsx
```

### Modify

```text
lib/runtime/projections.ts
lib/ui/api.ts
components/workbench/sections/RunSection.tsx
components/lanes/useLaneBoard.ts
components/inspector/ThreadSurfaceInspector.tsx
app/api/thread-runs/route.ts
app/api/status/route.ts
```

### Required changes

- Add hooks:

```text
useRuns
useRun
useRunAttempts
useAttempt
useCancelRun
useCancelAttempt
useRetryAttempt
```

- Enable real Stop/Cancel and Retry buttons.
- Display workflow-run ID separately from attempt ID.
- Display process state and interruption/lost state truthfully.
- Keep sequence status cards but source active execution state from runtime projections.
- Add an architecture test that fails if API or CLI lifecycle files import direct runner/process modules.
- Add a state-tree parity proof between API and CLI.
- Update current-state and architecture documentation.

### Tests

- Buttons invoke canonical resource APIs.
- Control buttons enable only for valid transitions.
- Failed controls display typed error and do not optimistically flip status.
- Legacy runs remain visible with a `legacy` badge/source.
- Architecture boundary scan passes.
- Full V1 runtime persistence proof remains green.

### Validation

```bash
bun test lib/runtime/projections.test.ts \
  test/architecture/runtime-service-boundary.test.ts \
  test/integration/runtime-interface-parity.test.ts \
  components/workbench/sections/RunSection.runtime.test.tsx \
  components/workbench/sections/RunSection.test.tsx
bun run check
bun run build
```

### M0 exit gate

- API and CLI use one runtime service.
- One sequential attempt produces identical canonical state through either interface.
- Stop and retry control real process state.
- Recovery eliminates stale-running attempts.
- No direct execution lifecycle remains in route or CLI handlers.

**Sequencing clarification:** filesystem-isolated execution is proven at the combined M0+M1 gate. M0 alone is not released or marketed as isolated parallel execution.

---

## PR-08 — Workspace configuration, external paths, and exclusions

**Branch:** `feat/workspace-config-paths`  
**Milestone:** 1  
**Risk:** Medium

### Create

```text
lib/workspaces/config-schema.ts
lib/workspaces/config.ts
lib/workspaces/paths.ts
lib/workspaces/exclusions.ts
lib/workspaces/repository.ts
lib/workspaces/config.test.ts
lib/workspaces/paths.test.ts
lib/workspaces/exclusions.test.ts
```

### Modify

```text
package.json
lib/local-first/types.ts
lib/local-first/workspace.ts
app/api/desktop/workspace/route.ts
lib/policy/schema.ts
```

### Dependency

Add the small `ignore` package for deterministic Gitignore-style pattern evaluation. Do not depend on Git itself.

### `.threados/workspace.yaml`

```yaml
version: 1
provider: auto
runtime_data_root: null
snapshot:
  exclusions:
    - .git/
    - .threados/
    - node_modules/
    - .next/
    - dist/
    - build/
    - coverage/
    - .venv/
    - venv/
    - target/
    - __pycache__/
  include_untracked: true
  max_source_retries: 3
workspace:
  retention: retain_on_failure
  max_active: 5
  max_bytes_each: 5368709120
  max_total_retained_bytes: 21474836480
  max_files: 250000
bootstrap: []
validate: []
```

### Path rules

- Windows default: `%LOCALAPPDATA%\thredOS\runtime`.
- Linux/WSL default: `$XDG_DATA_HOME/thredos` or `~/.local/share/thredos`.
- Runtime root must be outside the canonical project.
- Resolve and compare real paths before accepting overrides.
- Never place runtime copies under `.threados/`.
- Use the existing local workspace ID as the namespace.

### Exclusion precedence

```text
built-in defaults
→ workspace.yaml snapshot.exclusions
→ .threadosignore
→ explicit required includes
```

Required includes such as lockfiles remain included unless the user explicitly excludes them.

### Tests

- Windows, Linux, and WSL path resolution.
- Override inside the project root is rejected.
- `.threadosignore` negation and directory rules.
- `.git`, `.threados`, and sibling runtime roots are always excluded.
- Non-Git project configuration loads.
- Missing config produces safe defaults.

### Validation

```bash
bun test lib/workspaces/config.test.ts \
  lib/workspaces/paths.test.ts \
  lib/workspaces/exclusions.test.ts \
  lib/local-first/workspace.test.ts \
  lib/policy/engine.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Every local workspace resolves one safe external runtime root and one deterministic exclusion policy hash.

---

## PR-09 — Immutable baseline snapshot engine

**Branch:** `feat/immutable-snapshot-engine`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/workspaces/manifest.ts
lib/workspaces/hash.ts
lib/workspaces/snapshot.ts
lib/workspaces/snapshot-repository.ts
lib/workspaces/snapshot.test.ts
lib/workspaces/manifest.test.ts
test/fixtures/workspaces/snapshot-project/
test/integration/snapshot-dirty-git.test.ts
test/integration/snapshot-non-git.test.ts
```

### Modify

```text
lib/workspaces/schema.ts
lib/workspaces/paths.ts
lib/traces/writer.ts
lib/contracts/schemas.ts
```

### Snapshot algorithm

1. Resolve canonical root and external snapshot staging directory.
2. Load exclusions and compute policy hash.
3. Walk the source without following symlinks.
4. Reject or record symlinks escaping the source root.
5. Capture a sorted discovery list with type, size, mode, mtime, and platform identity where available.
6. Copy each included file into a temporary snapshot tree using independent file copies, not hardlinks.
7. Hash copied bytes and record manifest entries.
8. Re-stat source entries after copy.
9. Detect added, removed, or changed files during capture.
10. Retry the entire capture up to `max_source_retries`.
11. Compute a deterministic root manifest hash over sorted normalized entries.
12. Atomically rename the temporary snapshot directory into its final content-addressed location.
13. Persist the project-local snapshot reference and append trace events.

### Required behavior

- Dirty and untracked files are captured by content.
- Git metadata is best-effort only:
  - `HEAD` if available;
  - dirty state if available;
  - no failure when Git is absent.
- Snapshot content is immutable after `ready`.
- Two attempts in one group reference the same snapshot ID and manifest hash.
- Reuse an already verified identical snapshot within the same workflow run.
- Never include `.threados` runtime state.

### Tests

- Clean Git project.
- Dirty Git project with modified and untracked files.
- Non-Git directory.
- Binary file.
- Executable mode where supported.
- Internal symlink retained as symlink metadata.
- Escaping symlink blocked.
- File changes during snapshot trigger retry/failure.
- Root hash is stable across traversal order.
- `.threados` and runtime root are absent from the snapshot.
- Snapshot tree contains independent files, not hardlinks.

### Validation

```bash
bun test lib/workspaces/snapshot.test.ts \
  lib/workspaces/manifest.test.ts \
  test/integration/snapshot-dirty-git.test.ts \
  test/integration/snapshot-non-git.test.ts
bun run typecheck
bun run lint
```

### Exit gate

A dirty project and a non-Git project each produce a verified immutable snapshot with deterministic manifest hash.

---

## PR-10 — Portable copy provider and workspace manager

**Branch:** `feat/copy-workspace-provider`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/workspaces/providers/provider.ts
lib/workspaces/providers/copy.ts
lib/workspaces/providers/copy.test.ts
lib/workspaces/manager.ts
lib/workspaces/quotas.ts
lib/workspaces/retention.ts
lib/workspaces/doctor.ts
lib/workspaces/manager.test.ts
lib/workspaces/quotas.test.ts
lib/workspaces/retention.test.ts
```

### Modify

```text
lib/workspaces/repository.ts
lib/workspaces/schema.ts
lib/runtime/attempt-repository.ts
lib/thread-surfaces/types.ts
lib/thread-surfaces/repository.ts
lib/traces/writer.ts
```

### Provider contract

```ts
interface SurfaceWorkspaceProvider {
  id: 'copy' | 'overlayfs' | 'container'
  capabilities(): WorkspaceProviderCapabilities
  provision(request: ProvisionWorkspaceRequest): Promise<SurfaceWorkspace>
  inspect(workspaceId: string): Promise<SurfaceWorkspaceState>
  freeze(workspaceId: string): Promise<SurfaceWorkspace>
  destroy(workspaceId: string): Promise<void>
}
```

### Copy-provider requirements

- Source is the immutable snapshot tree, not the live canonical project.
- Materialize into a temporary workspace path, verify, then atomically promote.
- Use independent file copies; no hardlinks or symlink escapes.
- Preserve allowed mode metadata.
- Do not copy snapshot control metadata into the agent-visible tree.
- Verify final tree against the snapshot manifest before setting `ready`.
- Emit `THREADOS_SCOPED`.
- On partial failure, clean the temp directory and persist a failed workspace record.
- Enforce file count, per-workspace bytes, active count, and retained-byte quotas before and during materialization.

### Retention behavior

| Outcome | Default behavior |
|---|---|
| Successful, no review/apply dependency yet | Retain until later Change Set capture is available |
| Failed | Retain |
| Needs review | Retain |
| Interrupted | Retain |
| Cancelled before agent writes | Clean if verification proves no useful output |
| User-selected `retain_always` | Retain |

Because Change Sets arrive in Milestone 2, M1 must not auto-delete successful write workspaces immediately.

### Tests

- Two workspace provisions from one snapshot produce different roots and identical manifest hashes.
- Modifying workspace A does not change snapshot or workspace B.
- Modifying workspace A does not change canonical project.
- Quota rejection occurs before agent dispatch.
- Partial copy is cleaned.
- Retained-byte accounting is rebuilt from records if index is lost.
- Destroy refuses an active workspace.
- Doctor detects missing tree, invalid manifest, and orphaned directory.

### Validation

```bash
bun test lib/workspaces/providers/copy.test.ts \
  lib/workspaces/manager.test.ts \
  lib/workspaces/quotas.test.ts \
  lib/workspaces/retention.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Two verified, independent workspaces materialize from one snapshot without any Git operation.

---

## PR-11 — Bind attempts to isolated workspaces

**Branch:** `feat/isolated-attempt-dispatch`  
**Milestone:** 1  
**Risk:** High

### Create

```text
lib/runtime/workspace-planner.ts
lib/runtime/workspace-planner.test.ts
lib/workspaces/bootstrap.ts
lib/workspaces/bootstrap.test.ts
test/integration/isolated-attempt-dispatch.test.ts
test/integration/canonical-workspace-unchanged.test.ts
test/integration/two-identical-baselines.test.ts
```

### Modify

```text
lib/runtime/service.ts
lib/runtime/scheduler.ts
lib/runtime/attempt-executor.ts
lib/runtime/projections.ts
lib/runner/dispatch.ts
lib/runner/wrapper.ts
lib/runner/prompt-compiler.ts
lib/runner/artifacts.ts
lib/gates/engine.ts
lib/gates/rules.ts
lib/contracts/schemas.ts
lib/contracts/reason-codes.ts
lib/policy/schema.ts
lib/sequence/schema.ts
lib/seqctl/commands/step.ts
app/api/step/route.ts
lib/thread-surfaces/step-run-runtime.ts
lib/traces/writer.ts
```

### Workspace-selection policy

```text
side_effect_class none/read:
  existing canonical read path remains allowed in M1 unless explicitly isolated

side_effect_class write/execute:
  isolated workspace required

parallel-group write/execute:
  isolated workspace mandatory; no override to canonical cwd
```

Compatibility classification for legacy steps that do not explicitly carry `side_effect_class`:

```text
shell                         → execute
claude-code, codex, gemini    → write
unknown external agent model → write unless the registered adapter declares read-only
```

Explicit user configuration wins, but a write-capable provider may never be downgraded to `none` merely because an older sequence omitted the field. Extend step creation/edit APIs and CLI with `--side-effect none|read|write|execute` and `--workspace isolated|auto`.

For M1 tests and the canonical vertical slice, use `workspace_mode: isolated` explicitly for all write-capable attempts.

### Required lifecycle

```text
create workflow run
→ create/reuse immutable snapshot
→ create attempt in provisioning
→ plan workspace
→ persist workspace record
→ provision and verify workspace
→ bind attempt.workspace_id and snapshot_id
→ compile prompt with workspace-safe context
→ dispatch agent with cwd = workspace.root_path
→ persist process and run
→ retain/freeze workspace on completion
→ update surfaces, gates, traces, and artifacts
```

### Gate additions

Add deterministic gate types:

```text
snapshot_present
snapshot_verified
workspace_present
workspace_ready
workspace_manifest_verified
```

Gate evidence references point to snapshot/workspace manifests, not free text.

### Bootstrap requirements

- Run configured bootstrap commands inside the verified Surface Workspace before agent dispatch.
- Evaluate each command through the existing policy engine.
- Persist command, redacted output, duration, and exit result in the attempt artifacts.
- A bootstrap failure blocks agent spawn with `WORKSPACE_BOOTSTRAP_FAILED`.
- Bootstrap never runs in the canonical workspace.

### Canonical protection

- Capture a lightweight canonical pre-dispatch manifest hash.
- Recheck after each isolated attempt.
- If thredOS itself changed the canonical tree unexpectedly, fail the run with `CANONICAL_WORKSPACE_MUTATED`.
- User edits are allowed and recorded as a changed canonical precondition for future Milestone 2 merge logic; they are not overwritten.
- Do not expose the canonical root as writable `cwd` or an environment variable to the agent.

### Prompt and environment rules

- `THREADOS_WORKSPACE_ID`, `THREADOS_SNAPSHOT_ID`, `THREADOS_ATTEMPT_ID`, and existing run/step IDs are injected.
- `THREADOS_BASE_PATH` is not passed to isolated agents unless a future host-enforced tool gateway requires a non-write reference. The runner must support an explicit inherited-environment denylist because its current `THREADOS_*` inheritance would otherwise reintroduce the canonical path.
- Project file-tree and dependency artifacts used by prompt compilation must be sourced from the snapshot/workspace context, not sibling workspaces.
- Sealed surfaces receive no sibling semantic artifacts.

### Tests

- Runner receives workspace path, not canonical base path.
- Two attempts reference the same snapshot and different workspace IDs.
- An agent fixture writing files changes only its workspace.
- The canonical project remains byte-identical when the user makes no edits.
- User edits made after launch survive.
- A missing/invalid workspace gate prevents spawn.
- Sealed sibling workspace paths are not present in prompt or environment.
- `isolation_label` is `THREADOS_SCOPED`.
- No Git repository is required.

### Validation

```bash
bun test lib/runtime/workspace-planner.test.ts \
  lib/workspaces/bootstrap.test.ts \
  test/integration/isolated-attempt-dispatch.test.ts \
  test/integration/canonical-workspace-unchanged.test.ts \
  test/integration/two-identical-baselines.test.ts \
  test/api/runtime-persistence-proof.test.ts
bun run typecheck
bun run lint
```

### Exit gate

Two representative write attempts can run from the same immutable snapshot in separate workspaces, and the canonical project remains unchanged.

---

## PR-12 — Workspace API, CLI, UI, doctor, and M1 release proof

**Branch:** `feat/workspace-operator-surface`  
**Milestone:** 1  
**Risk:** Medium

### Create

```text
app/api/workspaces/route.ts
app/api/workspaces/[workspaceId]/route.ts
app/api/workspaces/[workspaceId]/retain/route.ts
app/api/workspaces/[workspaceId]/clean/route.ts
app/api/workspaces/doctor/route.ts
lib/seqctl/commands/workspace.ts
lib/seqctl/commands/workspace.test.ts
components/inspector/WorkspaceInspector.tsx
components/inspector/WorkspaceInspector.test.tsx
test/architecture/no-git-worktree-runtime.test.ts
test/integration/m1-workspace-release-proof.test.ts
test/ui/workspace-inspector.e2e.ts
scripts/verify/m1-workspace-proof.mjs
```

### Modify

```text
lib/seqctl/index.ts
lib/ui/api.ts
components/workbench/sections/RunSection.tsx
components/inspector/ThreadSurfaceInspector.tsx
components/inspector/StepInspector.tsx
components/command/CreateNodeDialog.tsx
components/lanes/useLaneBoard.ts
app/api/thread-surfaces/route.ts
app/api/thread-runs/route.ts
lib/exports/bundler.ts
package.json
README.md
docs/cli-reference.md
docs/product/current-state.md
docs/product/architecture-map.md
docs/launch/desktop-release-checklist.md
```

### CLI commands

```text
thread workspace list [--run <runId>]
thread workspace inspect <workspaceId>
thread workspace retain <workspaceId>
thread workspace clean <workspaceId>
thread workspace doctor
```

All commands support `--json` and use the shared workspace/runtime service.

### UI requirements

Workspace inspector displays:

- workspace ID;
- run and attempt IDs;
- surface and step;
- snapshot ID and root hash;
- provider;
- truthful isolation label;
- external root path;
- status;
- file count and bytes;
- retention policy;
- verification state;
- bootstrap result where present;
- retain and clean controls;
- diagnostic errors.

The Run section must show the workspace attached to each attempt and link to the inspector.

### Export requirements

M1 export adds:

- workflow-run record;
- attempt records;
- process records;
- snapshot references and manifests;
- workspace records and manifest hashes;
- isolation labels;
- workspace gate decisions;
- no external workspace file content unless explicitly included by export policy.

### No-worktree guard

The architecture test scans production runtime locations:

```text
app/
lib/
desktop/
scripts/
```

It fails on executable construction or process invocation of:

```text
git worktree
git.exe worktree
worktree add
worktree remove
```

Documentation may discuss worktrees only to state they are not required.

### Release-proof scenario

1. Create a dirty Git fixture and a non-Git fixture.
2. Create one workflow run with two write attempts.
3. Capture one immutable snapshot.
4. Provision two copy workspaces.
5. Run two deterministic fixture agents that write different outputs through the M0 sequential scheduler; concurrent dispatch is activated in Milestone 3.
6. Verify the same snapshot ID and different workspace IDs.
7. Verify canonical project hash is unchanged.
8. Stop and retry one long-running fixture through both API and CLI paths.
9. Restart service and reconcile an interrupted fixture.
10. Inspect workspaces through API, CLI, and UI.
11. Retain one and clean the other.
12. Export the evidence bundle.
13. Prove no Git worktree command was executed.

### Validation

```bash
bun test test/architecture/no-git-worktree-runtime.test.ts \
  test/integration/m1-workspace-release-proof.test.ts \
  lib/seqctl/commands/workspace.test.ts \
  components/inspector/WorkspaceInspector.test.tsx
bun run check
bun run build
bun test:ui
bun run verify:local
node scripts/verify/m1-workspace-proof.mjs
```

### M1 exit gate

- One immutable baseline is reused by at least two independent Surface Workspaces.
- Attempts run with isolated workspace `cwd` values.
- Canonical workspace remains unchanged by agents.
- Dirty Git and non-Git fixtures pass.
- App and CLI expose the same workspace state and controls.
- No production runtime invokes Git worktrees.
- Export contains snapshot, attempt, process, workspace, gate, approval, and trace evidence.

---

# 8. Cross-cutting test strategy

## 8.1 Unit-test suites

```text
lib/runtime/*
lib/workspaces/*
lib/runner/*
lib/gates/*
lib/approvals/*
lib/thread-surfaces/*
lib/seqctl/*
```

Required themes:

- schema validation;
- state-transition legality;
- optimistic concurrency;
- path containment;
- idempotency;
- exclusion matching;
- manifest determinism;
- quota accounting;
- retention decisions;
- process cancellation;
- recovery mapping;
- compatibility projection.

## 8.2 Integration-test matrix

| Case | M0 | M1 |
|---|---:|---:|
| API/CLI state parity | Required | Required |
| One run with multiple attempts | Required | Required |
| Stop real process | Required | Required |
| Retry lineage | Required | Required |
| Service restart reconciliation | Required | Required |
| Dirty Git snapshot | — | Required |
| Non-Git snapshot | — | Required |
| Same baseline, separate workspaces | — | Required |
| Canonical unchanged | — | Required |
| Symlink escape | — | Required |
| Workspace quota failure | — | Required |
| No-worktree static/runtime proof | Guard | Required |

## 8.3 Architecture tests

Automated source checks must assert:

- routes do not import runner/process lifecycle modules;
- CLI handlers do not import runner/process lifecycle modules;
- only runtime service/scheduler controls status transitions for V2 attempts;
- no production worktree invocation;
- mprocs state is not imported by V2 service as authoritative state;
- workspace provider never resolves under canonical root;
- copy provider does not use hardlink APIs.

## 8.4 Windows and WSL2 coverage

At minimum:

- path-normalization unit tests for drive letters, UNC-like paths, `/mnt/<drive>`, case differences, and separators;
- process termination tests on Windows CI or release machine;
- workspace root outside the source checkout;
- locked-file cleanup behavior;
- long-path diagnostic output;
- WSL-mounted source with runtime tree on native Linux filesystem.

---

# 9. Validation command policy

Every PR:

```bash
bun run typecheck
bun run lint
<targeted bun test commands>
```

Every milestone close:

```bash
bun run check
bun run build
bun test:ui
bun run verify:local
```

Before Desktop 1.0 release:

```bash
bun run desktop:build
bun run verify:release-live
```

A PR description must state:

```text
Tested:
- exact commands and outcomes

Not tested:
- anything not executed

Migration:
- state/files affected

Rollback:
- how to return to prior behavior without losing generated data
```

---

# 10. Rollback strategy

## 10.1 Code rollback

- PR-01/02 are additive and can be reverted without deleting generated files.
- After API/CLI cutover, reverting code may leave V2 records on disk; legacy readers must ignore unknown directories safely.
- Never roll back by deleting `.threados/runs`, snapshots, or external workspaces.

## 10.2 Runtime rollback

If a runtime defect is found before M1 closes:

1. stop new run creation;
2. cancel or mark current attempts interrupted truthfully;
3. retain external workspace directories;
4. export run evidence;
5. revert the responsible PR;
6. continue reading V2 records through compatibility projections;
7. do not resume V2 attempts through legacy direct execution.

## 10.3 Snapshot/workspace rollback

- Failed snapshot/workspace staging directories are safe to remove after record verification.
- Ready or active workspaces are retained until the operator or cleanup policy explicitly resolves them.
- Workspace cleanup is idempotent.

---

# 11. Milestone acceptance evidence

## 11.1 Milestone 0 evidence bundle

```text
m0-proof/
├── api-run-tree.txt
├── cli-run-tree.txt
├── parity.json
├── process-cancel.json
├── retry-lineage.json
├── recovery-report.json
├── architecture-boundary-report.json
├── test-results.txt
└── build-results.txt
```

Required proof:

- same service and record schemas through API and CLI;
- no duplicate process on idempotent replay;
- real cancellation;
- new retry attempt ID;
- interrupted recovery;
- route/CLI boundary scan.

## 11.2 Milestone 1 evidence bundle

```text
m1-proof/
├── snapshot.json
├── snapshot-manifest.json
├── workspace-a.json
├── workspace-b.json
├── canonical-before.manifest.json
├── canonical-after.manifest.json
├── isolation-proof.json
├── dirty-git-proof.json
├── non-git-proof.json
├── no-worktree-report.json
├── export-bundle.json
├── test-results.txt
└── ui-proof/
```

Required proof:

- same snapshot ID and root hash;
- distinct workspace roots;
- no canonical agent mutation;
- no worktree invocation;
- truthful `THREADOS_SCOPED` label;
- inspect/retain/clean through UI and CLI.

---

# 12. Requirement-to-PR traceability

| Requirement | PRs |
|---|---|
| FR-RUNTIME-001 shared service | 03, 04, 05, 07 |
| FR-RUNTIME-002 canonical methods | 03, 04, 05 |
| FR-RUNTIME-003 state transitions | 01, 02, 03 |
| FR-RUNTIME-004 idempotency | 01, 02, 03, 04, 05 |
| FR-RUN-001 separate run/attempt | 01, 02, 03 |
| FR-RUN-002 attempt identity | 01, 02, 03, 11 |
| FR-RUN-003 status model | 01, 03, 06 |
| FR-RUN-004 atomic persistence | 02 |
| FR-SNAPSHOT-001 immutable baseline | 08, 09 |
| FR-SNAPSHOT-002 dirty/untracked | 09, 12 |
| FR-SNAPSHOT-003 exclusions | 08, 09 |
| FR-SNAPSHOT-004 symlink safety | 09 |
| FR-SNAPSHOT-005 snapshot reuse | 09, 11 |
| FR-WORKSPACE-001 private workspace | 10, 11 |
| FR-WORKSPACE-002 copy provider | 10 |
| FR-WORKSPACE-003 provider abstraction | 10 |
| FR-WORKSPACE-004 auto provider | 08, 10 |
| FR-WORKSPACE-006 bootstrap contract | 08, 11 |
| FR-WORKSPACE-007 retention | 10, 12 |
| FR-WORKSPACE-008 quotas | 08, 10 |
| FR-SCHED-002 persist before spawn | 02, 03, 06 |
| FR-SCHED-003 durable token model | 03; concurrency activated in M3 |
| FR-SCHED-005 process registry | 02, 06 |
| FR-SCHED-006 cancellation | 06, 07 |
| FR-SCHED-007 recovery | 06 |
| FR-SCHED-008 retry | 03, 05, 06 |
| FR-AGENT-001 common adapter boundary | 03, 11 |
| FR-AGENT-003 isolated cwd | 11 |
| FR-AGENT-004 environment filtering | 06, 11 |
| FR-SURFACE-002 workspace binding | 10, 11 |
| FR-SURFACE-003 no sibling projection | 11, 12 |
| FR-SURFACE-005 honest isolation | 10, 11, 12 |
| FR-CLI-001 compatibility | 05 |
| FR-CLI-003 run operations | 05, 07 |
| FR-CLI-004 workspace operations | 12 |
| FR-CLI-006 JSON parity | 05, 12 |
| FR-CLI-007 truthful exit codes | 05, 06 |
| FR-API-001 compatibility routes | 04 |
| FR-API-002 canonical resources | 04, 12 |
| FR-API-004 typed errors | 03, 04 |
| FR-UI-001 real run control | 07 |
| FR-UI-005 workspace inspector | 12 |
| A-001 no worktrees | 12 |
| A-003 distinct workspaces | 10, 11, 12 |
| A-004 exact baseline | 09, 11, 12 |
| A-005 canonical unchanged | 11, 12 |
| A-014 real process cancellation | 06, 07 |
| A-015 truthful retry lineage | 05, 06, 07 |
| A-016 restart reconciliation | 06 |
| A-017 shared service | 04, 05, 07 |
| A-019 truthful isolation label | 10, 11, 12 |

---

# 13. Explicit non-deliverables in these PRs

Do not expand Milestones 0–1 into:

- Change Set generation;
- source-code merge algorithms;
- canonical project apply;
- automatic Git commits;
- real parallel worker pool greater than one;
- race winner selection;
- SSE/WebSocket streaming overhaul;
- OverlayFS;
- Docker sandboxing;
- thredOS Node remote execution;
- Thread Runner marketplace/proving work;
- broad visual redesign.

Only implement seams required to avoid future breaking changes.

---

# 14. First implementation action

Begin with PR-01 only.

```bash
git checkout -b feat/runtime-contracts-v2 origin/main
```

Before editing, capture the preflight drift audit from Section 1.1 in the PR description. Implement schemas and tests without changing runtime behavior. Do not start repository or service extraction until PR-01 is green and merged.

---

# 15. Definition of complete for this implementation plan

Milestones 0 and 1 are complete when:

1. API and CLI execute through one shared runtime service.
2. Workflow runs and attempts have separate durable identities.
3. Every launch request is persisted before spawn.
4. Stop and retry act on real process state.
5. Startup reconciliation removes stale-running claims.
6. A dirty Git project can be snapshotted by content.
7. A non-Git project can be snapshotted by content.
8. Two attempts can share one immutable snapshot but receive separate workspaces.
9. Agents run from the Surface Workspace path, not the canonical project.
10. Agent writes do not change the canonical project.
11. Workspace state is inspectable and controllable from app and CLI.
12. No production runtime invokes Git worktrees.
13. The evidence bundle proves each statement above.

At that point the codebase is ready for Milestone 2 Change Sets and Milestone 3 real bounded parallel scheduling without another runtime redesign.

---

# MILESTONES 0–1 PR MANIFEST

```yaml
schema_version: 1
document_version: '1.1'
status: final
document: thredOS M0-M1 PR manifest
date: '2026-07-15'
repository: OmarA1-Bakri-Org/thredOS
authority:
  product: docs/product/canonical-prd-worktree-free-parallel-runtime.md
  contributor_rules: AGENTS.md
  implementation: docs/plans/m0-m1-repository-implementation-plan.md
parent_prd: docs/product/canonical-prd-worktree-free-parallel-runtime.md
implementation_plan: docs/plans/m0-m1-repository-implementation-plan.md
supersedes: all earlier M0-M1 PR manifests in this project
locked_constraints:
- No production runtime invocation of git worktree
- App and CLI must delegate to one ThreadOSRuntimeService
- WorkflowRun and StepAttempt are separate durable entities
- Persist attempt and launch request before process spawn
- Stop/cancel must control the real process truthfully
- Write and execute attempts require verified Surface Workspaces by M1
- Copy provider emits THREADOS_SCOPED, never HOST_ENFORCED
- Real bounded concurrency is activated in M3, not M0-M1
global_validation:
  every_pr:
  - bun run typecheck
  - bun run lint
  - targeted bun test commands
  milestone_close:
  - bun run check
  - bun run build
  - bun test:ui
  - bun run verify:local
prs:
- id: PR-01
  milestone: M0
  branch: feat/runtime-contracts-v2
  title: Canonical runtime and workspace contracts
  depends_on: []
  creates:
  - lib/runtime/schema.ts
  - lib/runtime/command-schema.ts
  - lib/runtime/error-codes.ts
  - lib/workspaces/schema.ts
  - lib/changesets/schema.ts
  - lib/merge/schema.ts
  modifies:
  - lib/contracts/schemas.ts
  - lib/thread-surfaces/types.ts
  gate: Canonical schemas validate representative V2 and legacy-compatible records; runtime behavior unchanged.
- id: PR-02
  milestone: M0
  branch: feat/runtime-repositories-v2
  title: Atomic runtime repositories and idempotency
  depends_on:
  - PR-01
  creates:
  - lib/runtime/paths.ts
  - lib/runtime/run-repository.ts
  - lib/runtime/attempt-repository.ts
  - lib/runtime/process-repository.ts
  - lib/runtime/command-repository.ts
  - lib/runtime/runtime-index.ts
  - lib/runtime/legacy-projection.ts
  modifies:
  - lib/fs/atomic.ts
  - lib/thread-surfaces/repository.ts
  - lib/runner/artifacts.ts
  - lib/exports/bundler.ts
  gate: One run with two attempts survives fresh repository reads without overwrite; idempotency replay is safe.
- id: PR-03
  milestone: M0
  branch: feat/runtime-service-v2
  title: Shared runtime service and sequential scheduler
  depends_on:
  - PR-02
  creates:
  - lib/runtime/service.ts
  - lib/runtime/service-types.ts
  - lib/runtime/factory.ts
  - lib/runtime/scheduler.ts
  - lib/runtime/attempt-executor.ts
  - lib/runtime/lifecycle.ts
  - lib/runtime/errors.ts
  - lib/runtime/projections.ts
  modifies:
  - lib/runner/artifacts.ts
  - lib/thread-surfaces/step-run-runtime.ts
  - lib/thread-surfaces/mutations.ts
  - lib/gates/engine.ts
  - lib/approvals/runtime.ts
  - lib/traces/writer.ts
  gate: Service completes one sequential mock attempt with canonical run, attempt, process, gates, traces, surfaces
    and artifacts.
- id: PR-04
  milestone: M0
  branch: refactor/api-runtime-service
  title: API cutover to shared runtime service
  depends_on:
  - PR-03
  creates:
  - lib/api/runtime-request.ts
  - app/api/runs/route.ts
  - app/api/runs/[runId]/route.ts
  - app/api/runs/[runId]/cancel/route.ts
  - app/api/attempts/[attemptId]/route.ts
  - app/api/attempts/[attemptId]/cancel/route.ts
  - app/api/attempts/[attemptId]/retry/route.ts
  modifies:
  - app/api/run/route.ts
  - app/api/stop/route.ts
  - app/api/restart/route.ts
  - app/api/status/route.ts
  - lib/api-helpers.ts
  gate: Compatibility and resource APIs delegate; no route owns lifecycle logic.
- id: PR-05
  milestone: M0
  branch: refactor/cli-runtime-service
  title: CLI cutover and stable runtime JSON
  depends_on:
  - PR-04
  creates:
  - lib/seqctl/commands/attempt.ts
  - lib/seqctl/formatters/runtime.ts
  - lib/seqctl/runtime-json-schema.ts
  modifies:
  - lib/seqctl/index.ts
  - lib/seqctl/commands/run.ts
  - lib/seqctl/commands/control.ts
  - lib/seqctl/commands/status.ts
  - lib/seqctl/commands/group.ts
  - lib/seqctl/commands/mprocs.ts
  gate: CLI/API fixture operations produce equivalent state and truthful exit codes.
- id: PR-06
  milestone: M0
  branch: feat/truthful-process-control
  title: Truthful process control, retry and recovery
  depends_on:
  - PR-05
  creates:
  - lib/runner/process-handle.ts
  - lib/runtime/process-controller.ts
  - lib/runtime/recovery.ts
  - test/fixtures/process/long-running.mjs
  - test/fixtures/process/exit-with-code.mjs
  - test/fixtures/process/write-heartbeat.mjs
  modifies:
  - lib/runner/wrapper.ts
  - lib/runtime/attempt-executor.ts
  - lib/runtime/service.ts
  - lib/reconciliation/reconciler.ts
  - lib/mprocs/state.ts
  gate: Real fixture process can be cancelled, retried as a new attempt, and reconciled after service restart.
- id: PR-07
  milestone: M0
  branch: feat/runtime-operator-projections
  title: Runtime projections, operator controls and M0 proof
  depends_on:
  - PR-06
  creates:
  - app/api/runs/[runId]/attempts/route.ts
  - test/architecture/runtime-service-boundary.test.ts
  - test/integration/runtime-interface-parity.test.ts
  modifies:
  - lib/runtime/projections.ts
  - lib/ui/api.ts
  - components/workbench/sections/RunSection.tsx
  - components/lanes/useLaneBoard.ts
  - components/inspector/ThreadSurfaceInspector.tsx
  - app/api/thread-runs/route.ts
  - app/api/status/route.ts
  gate: M0 evidence proves one runtime path, truthful control and no stale running state.
- id: PR-08
  milestone: M1
  branch: feat/workspace-config-paths
  title: Workspace configuration, external paths and exclusions
  depends_on:
  - PR-07
  creates:
  - lib/workspaces/config-schema.ts
  - lib/workspaces/config.ts
  - lib/workspaces/paths.ts
  - lib/workspaces/exclusions.ts
  - lib/workspaces/repository.ts
  modifies:
  - package.json
  - lib/local-first/types.ts
  - lib/local-first/workspace.ts
  - app/api/desktop/workspace/route.ts
  - lib/policy/schema.ts
  gate: Every local workspace resolves a safe external runtime root and deterministic exclusion policy hash.
- id: PR-09
  milestone: M1
  branch: feat/immutable-snapshot-engine
  title: Immutable baseline snapshot engine
  depends_on:
  - PR-08
  creates:
  - lib/workspaces/manifest.ts
  - lib/workspaces/hash.ts
  - lib/workspaces/snapshot.ts
  - lib/workspaces/snapshot-repository.ts
  - test/integration/snapshot-dirty-git.test.ts
  - test/integration/snapshot-non-git.test.ts
  modifies:
  - lib/workspaces/schema.ts
  - lib/workspaces/paths.ts
  - lib/traces/writer.ts
  - lib/contracts/schemas.ts
  gate: Dirty Git and non-Git fixtures produce verified immutable snapshots with stable manifest hashes.
- id: PR-10
  milestone: M1
  branch: feat/copy-workspace-provider
  title: Portable copy provider and workspace manager
  depends_on:
  - PR-09
  creates:
  - lib/workspaces/providers/provider.ts
  - lib/workspaces/providers/copy.ts
  - lib/workspaces/manager.ts
  - lib/workspaces/quotas.ts
  - lib/workspaces/retention.ts
  - lib/workspaces/doctor.ts
  modifies:
  - lib/workspaces/repository.ts
  - lib/workspaces/schema.ts
  - lib/runtime/attempt-repository.ts
  - lib/thread-surfaces/types.ts
  - lib/thread-surfaces/repository.ts
  - lib/traces/writer.ts
  gate: Two independent verified workspace roots materialize from one snapshot with no hardlinks or Git operations.
- id: PR-11
  milestone: M1
  branch: feat/isolated-attempt-dispatch
  title: Bind write attempts to isolated workspaces
  depends_on:
  - PR-10
  creates:
  - lib/runtime/workspace-planner.ts
  - lib/workspaces/bootstrap.ts
  - test/integration/isolated-attempt-dispatch.test.ts
  - test/integration/canonical-workspace-unchanged.test.ts
  - test/integration/two-identical-baselines.test.ts
  modifies:
  - lib/runtime/service.ts
  - lib/runtime/scheduler.ts
  - lib/runtime/attempt-executor.ts
  - lib/runner/dispatch.ts
  - lib/runner/wrapper.ts
  - lib/runner/prompt-compiler.ts
  - lib/gates/engine.ts
  - lib/gates/rules.ts
  - lib/sequence/schema.ts
  - lib/seqctl/commands/step.ts
  - app/api/step/route.ts
  gate: Two representative write attempts use the same snapshot, separate workspaces and leave canonical project
    unchanged.
- id: PR-12
  milestone: M1
  branch: feat/workspace-operator-surface
  title: Workspace API, CLI, UI, doctor and M1 proof
  depends_on:
  - PR-11
  creates:
  - app/api/workspaces/route.ts
  - app/api/workspaces/[workspaceId]/route.ts
  - app/api/workspaces/[workspaceId]/retain/route.ts
  - app/api/workspaces/[workspaceId]/clean/route.ts
  - app/api/workspaces/doctor/route.ts
  - lib/seqctl/commands/workspace.ts
  - components/inspector/WorkspaceInspector.tsx
  - test/architecture/no-git-worktree-runtime.test.ts
  - test/integration/m1-workspace-release-proof.test.ts
  - test/ui/workspace-inspector.e2e.ts
  - scripts/verify/m1-workspace-proof.mjs
  modifies:
  - lib/seqctl/index.ts
  - lib/ui/api.ts
  - components/workbench/sections/RunSection.tsx
  - components/inspector/ThreadSurfaceInspector.tsx
  - components/inspector/StepInspector.tsx
  - components/command/CreateNodeDialog.tsx
  - components/lanes/useLaneBoard.ts
  - lib/exports/bundler.ts
  - package.json
  - README.md
  - docs/cli-reference.md
  - docs/product/current-state.md
  - docs/product/architecture-map.md
  gate: M1 evidence proves same baseline, distinct workspaces, canonical unchanged, dirty/non-Git support and no
    worktree invocation.
```
