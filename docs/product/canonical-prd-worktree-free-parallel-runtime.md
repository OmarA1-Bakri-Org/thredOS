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
