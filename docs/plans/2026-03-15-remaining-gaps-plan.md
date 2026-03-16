# Remaining Product Gaps: Agent Stats, Gate Metrics, Chat Apply, Hierarchy Hardening

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the 4 remaining partially-implemented areas into fully functional features — agent performance stats from real data, gate quality metrics from audit history, hardened chat apply contract, and scaffold-free hierarchy views.

**Architecture:** 4 independent workstreams. WS1 (Agent Stats) and WS2 (Gate Metrics) are UI-data wiring — the backend data sources already exist. WS3 (Chat Apply) is a contract fix. WS4 (Hierarchy) is a reconciliation hardening pass. All follow TDD.

**Tech Stack:** Next.js API routes, React Query hooks, Zustand store, Zod schemas, file-backed state under `.threados/`

---

## Workstream 1: Agent Performance Stats (Real Data)

### Context
`PerformanceView` in `components/workbench/sections/AgentSection.tsx:295-322` shows 4 placeholder cards (Runs: —, Pass rate: —, Avg time: —, Quality: —). The backend already has:
- `lib/agents/stats.ts` — `aggregateAgentStats(agentId, races, runs)` computes `AgentStats` (totalRuns, wins, podiums, losses, avgPlacement, totalRaceTime, divisions)
- `app/api/agent-profile/route.ts` — combines agent + stats + pack into a `ThreadCardProfile`
- `lib/ui/api.ts:250` — `useAgentProfile(threadSurfaceId)` returns the profile

The problem: `PerformanceView` doesn't call any of these. It renders static "—" values.

### Task 1.1: Add `useAgentStats` hook — test

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Write the hook**

The stats are already available through the agent-profile API. Add a convenience hook that extracts just the stats-relevant fields:

```typescript
export interface AgentPerformanceData {
  totalRuns: number
  passRate: number    // 0-100 percentage
  avgTimeMs: number
  quality: number     // 0-10 scale from rubric
}

export function useAgentPerformance(agentId: string | null) {
  return useQuery<AgentPerformanceData | null>({
    queryKey: ['agent-performance', agentId],
    queryFn: async () => {
      if (!agentId) return null
      const res = await fetchJson<{ stats: AgentPerformanceData | null }>(`/api/agent-stats?agentId=${encodeURIComponent(agentId)}`)
      return res.stats
    },
    enabled: !!agentId,
    staleTime: 30_000,
  })
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: typecheck pass (hook is unused so far)

### Task 1.2: Create agent-stats API endpoint — test

**Files:**
- Create: `test/api/agent-stats-route.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'

describe('GET /api/agent-stats', () => {
  const tmpDir = join(import.meta.dir, '..', 'tmp-agent-stats-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })

    // Write minimal agent state
    writeFileSync(join(tmpDir, '.threados', 'state', 'agents.json'), JSON.stringify({
      version: 1,
      agents: [{ id: 'agent-1', name: 'Test Agent', builderId: 'b1', builderName: 'Builder', registeredAt: '2026-01-01T00:00:00Z', threadSurfaceIds: [] }],
    }))

    // Write thread-runner state with race data
    writeFileSync(join(tmpDir, '.threados', 'state', 'thread-runner.json'), JSON.stringify({
      version: 1,
      races: [{ id: 'race-1', name: 'Race 1', division: 'Frontline', createdAt: '2026-01-01T00:00:00Z', status: 'completed' }],
      combatantRuns: [
        { id: 'run-1', raceId: 'race-1', combatantId: 'agent-1', placement: 1, status: 'completed', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:05:00Z' },
        { id: 'run-2', raceId: 'race-1', combatantId: 'agent-1', placement: 2, status: 'completed', startedAt: '2026-01-01T00:10:00Z', endedAt: '2026-01-01T00:14:00Z' },
      ],
    }))
  })

  test('returns null when agentId is missing', async () => {
    const { GET } = await import('@/app/api/agent-stats/route')
    const req = new Request('http://localhost/api/agent-stats')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  test('returns null for unknown agent', async () => {
    const { GET } = await import('@/app/api/agent-stats/route')
    const req = new Request('http://localhost/api/agent-stats?agentId=nonexistent')
    const res = await GET(req)
    const data = await res.json()
    expect(data.stats).toBeNull()
  })
})
```

**Step 2: Run to verify fails**

Run: `bun test test/api/agent-stats-route.test.ts`
Expected: FAIL — module not found

### Task 1.3: Create agent-stats API endpoint — implementation

**Files:**
- Create: `app/api/agent-stats/route.ts`

**Step 1: Write implementation**

```typescript
import { readAgentState } from '@/lib/agents/repository'
import { aggregateAgentStats, type AgentStats } from '@/lib/agents/stats'
import { readThreadRunnerState } from '@/lib/thread-runner/repository'
import { getBasePath } from '@/lib/config'

function computePerformanceData(stats: AgentStats) {
  const passRate = stats.totalRuns > 0
    ? ((stats.totalRuns - stats.disqualifications - stats.losses) / stats.totalRuns) * 100
    : 0

  const avgTimeMs = stats.totalRuns > 0
    ? Math.round(stats.totalRaceTime / stats.totalRuns)
    : 0

  // Quality: derived from avg placement (1st = 10, 5th+ = 5)
  const quality = stats.avgPlacement > 0
    ? Math.min(10, Math.max(1, Math.round(11 - stats.avgPlacement * 1.5)))
    : 0

  return {
    totalRuns: stats.totalRuns,
    passRate: Math.round(passRate),
    avgTimeMs,
    quality,
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const agentId = url.searchParams.get('agentId')

    if (!agentId) {
      return Response.json({ error: 'Missing agentId query parameter' }, { status: 400 })
    }

    const bp = getBasePath()
    const [agentState, runnerState] = await Promise.all([
      readAgentState(bp),
      readThreadRunnerState(bp),
    ])

    const agent = agentState.agents.find(a => a.id === agentId)
    if (!agent) {
      return Response.json({ stats: null })
    }

    const stats = aggregateAgentStats(agentId, runnerState.races, runnerState.combatantRuns)

    if (stats.totalRuns === 0) {
      return Response.json({ stats: null })
    }

    return Response.json({ stats: computePerformanceData(stats) })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 2: Run tests**

Run: `bun test test/api/agent-stats-route.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/agent-stats/route.ts test/api/agent-stats-route.test.ts lib/ui/api.ts
git commit -m "feat: add agent-stats API endpoint and useAgentPerformance hook"
```

---

### Task 1.4: Wire PerformanceView to real stats data

**Files:**
- Modify: `components/workbench/sections/AgentSection.tsx:295-322`

**Step 1: Replace placeholder PerformanceView**

```typescript
function PerformanceView() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const { data: status } = useStatus()
  const { data: sequence } = useSequence()
  const phaseDerivation = status ? derivePhases(status.steps, status.gates) : null
  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)

  // Find the assigned agent for the first step in the selected phase
  const firstStepId = selectedPhase?.stepIds[0]
  const firstStep = sequence?.steps.find(s => s.id === firstStepId)
  const agentId = firstStep?.assigned_agent_id ?? null
  const { data: perfData } = useAgentPerformance(agentId)

  const formatTime = (ms: number) => {
    if (ms === 0) return '—'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Agent performance</div>
      {!agentId && (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">
          Select a phase with an assigned agent to see performance data.
        </div>
      )}
      {agentId && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Runs</div>
              <div className="mt-1 text-lg font-semibold text-white">{perfData?.totalRuns ?? '—'}</div>
            </div>
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Pass rate</div>
              <div className="mt-1 text-lg font-semibold text-white">{perfData ? `${perfData.passRate}%` : '—'}</div>
            </div>
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Avg time</div>
              <div className="mt-1 text-lg font-semibold text-white">{perfData ? formatTime(perfData.avgTimeMs) : '—'}</div>
            </div>
            <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Quality</div>
              <div className="mt-1 text-lg font-semibold text-white">{perfData ? `${perfData.quality}/10` : '—'}</div>
            </div>
          </div>
          {!perfData && (
            <div className="border border-[#16417C]/50 bg-[#16417C]/10 px-3 py-2.5 text-[11px] text-slate-400">
              Performance data populates after agent runs through gates. Rubric scoring tracks quality over time.
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

Add import at top:
```typescript
import { useAgentPerformance } from '@/lib/ui/api'
```

Also import `useSequence` if not already imported (it is already imported on line 7).

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/workbench/sections/AgentSection.tsx
git commit -m "feat: wire PerformanceView to real agent stats data"
```

---

## Workstream 2: Gate Quality Metrics (Real Data)

### Context
`GateSection.tsx:232-241` shows placeholder "Time/quality: —" and "Pass rate: —" cards. No data source exists for gate metrics. The audit log (`lib/audit/logger.ts`) records every gate approve/block action. Gate approval data can be derived from the audit log.

### Task 2.1: Create gate metrics computation — test

**Files:**
- Create: `lib/gates/metrics.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { computeGateMetrics, type GateAuditEntry } from './metrics'

describe('computeGateMetrics', () => {
  test('returns zero metrics for empty history', () => {
    const result = computeGateMetrics('gate-1', [])
    expect(result.totalAttempts).toBe(0)
    expect(result.approvalRate).toBe(0)
    expect(result.avgTimeToApprovalMs).toBe(0)
  })

  test('computes approval rate from approve/block entries', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:10:00Z' },
      { action: 'gate block', gateId: 'gate-1', timestamp: '2026-01-01T00:20:00Z' },
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:30:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.totalAttempts).toBe(3)
    expect(result.approvalRate).toBe(67) // 2/3 rounded
  })

  test('filters by gateId', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:10:00Z' },
      { action: 'gate approve', gateId: 'gate-2', timestamp: '2026-01-01T00:20:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.totalAttempts).toBe(1)
  })

  test('computes avg time from first block to first approve', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate block', gateId: 'gate-1', timestamp: '2026-01-01T00:00:00Z' },
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:05:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.avgTimeToApprovalMs).toBe(300_000) // 5 minutes
  })
})
```

**Step 2: Run to verify fails**

Run: `bun test lib/gates/metrics.test.ts`
Expected: FAIL — module not found

### Task 2.2: Create gate metrics computation — implementation

**Files:**
- Create: `lib/gates/metrics.ts`

**Step 1: Write implementation**

```typescript
export interface GateAuditEntry {
  action: string
  gateId: string
  timestamp: string
}

export interface GateMetrics {
  totalAttempts: number
  approvalRate: number     // 0-100 percentage
  avgTimeToApprovalMs: number
  approvals: number
  blocks: number
}

export function computeGateMetrics(gateId: string, entries: GateAuditEntry[]): GateMetrics {
  const gateEntries = entries.filter(e => e.gateId === gateId)

  if (gateEntries.length === 0) {
    return { totalAttempts: 0, approvalRate: 0, avgTimeToApprovalMs: 0, approvals: 0, blocks: 0 }
  }

  const approvals = gateEntries.filter(e => e.action === 'gate approve').length
  const blocks = gateEntries.filter(e => e.action === 'gate block').length
  const totalAttempts = approvals + blocks
  const approvalRate = totalAttempts > 0 ? Math.round((approvals / totalAttempts) * 100) : 0

  // Compute average time from first block to next approve in each cycle
  const sorted = [...gateEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  let totalTimeMs = 0
  let cycleCount = 0
  let lastBlockTime: number | null = null

  for (const entry of sorted) {
    if (entry.action === 'gate block') {
      lastBlockTime = new Date(entry.timestamp).getTime()
    } else if (entry.action === 'gate approve' && lastBlockTime !== null) {
      totalTimeMs += new Date(entry.timestamp).getTime() - lastBlockTime
      cycleCount++
      lastBlockTime = null
    }
  }

  const avgTimeToApprovalMs = cycleCount > 0 ? Math.round(totalTimeMs / cycleCount) : 0

  return { totalAttempts, approvalRate, avgTimeToApprovalMs, approvals, blocks }
}
```

**Step 2: Run tests**

Run: `bun test lib/gates/metrics.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/gates/metrics.ts lib/gates/metrics.test.ts
git commit -m "feat: add gate metrics computation from audit entries"
```

---

### Task 2.3: Create gate-metrics API endpoint

**Files:**
- Create: `app/api/gate-metrics/route.ts`

**Step 1: Write implementation**

```typescript
import { getBasePath } from '@/lib/config'
import * as audit from '@/lib/audit/logger'
import { computeGateMetrics, type GateAuditEntry } from '@/lib/gates/metrics'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const gateId = url.searchParams.get('gateId')

    if (!gateId) {
      return Response.json({ error: 'Missing gateId query parameter' }, { status: 400 })
    }

    const bp = getBasePath()
    const auditEntries = await audit.readAll(bp)

    // Filter to gate actions and map to GateAuditEntry
    const gateAuditEntries: GateAuditEntry[] = auditEntries
      .filter(e => e.action === 'gate approve' || e.action === 'gate block')
      .map(e => ({
        action: e.action,
        gateId: String(e.target),
        timestamp: e.timestamp,
      }))

    const metrics = computeGateMetrics(gateId, gateAuditEntries)
    return Response.json({ metrics })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: typecheck pass

**Step 3: Commit**

```bash
git add app/api/gate-metrics/route.ts
git commit -m "feat: add gate-metrics API endpoint from audit history"
```

---

### Task 2.4: Add `useGateMetrics` hook

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hook**

```typescript
import type { GateMetrics } from '@/lib/gates/metrics'

export function useGateMetrics(gateId: string | null) {
  return useQuery<GateMetrics | null>({
    queryKey: ['gate-metrics', gateId],
    queryFn: async () => {
      if (!gateId) return null
      const res = await fetchJson<{ metrics: GateMetrics }>(`/api/gate-metrics?gateId=${encodeURIComponent(gateId)}`)
      return res.metrics
    },
    enabled: !!gateId,
    staleTime: 30_000,
  })
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/ui/api.ts
git commit -m "feat: add useGateMetrics React Query hook"
```

---

### Task 2.5: Wire GateSection metric cards to real data

**Files:**
- Modify: `components/workbench/sections/GateSection.tsx:232-241`

**Step 1: Replace placeholder metric cards**

Add import:
```typescript
import { useGateMetrics } from '@/lib/ui/api'
```

Replace the metrics grid section inside the gate `.map()` (lines 232-241):

```typescript
{/* Gate quality metrics */}
{(() => {
  const { data: metrics } = useGateMetrics(gate.id)
  const formatTime = (ms: number) => {
    if (ms === 0) return '—'
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Time/quality</div>
        <div className="mt-1 text-sm font-semibold text-white">
          {metrics ? formatTime(metrics.avgTimeToApprovalMs) : '—'}
        </div>
      </div>
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Pass rate</div>
        <div className="mt-1 text-sm font-semibold text-white">
          {metrics && metrics.totalAttempts > 0 ? `${metrics.approvalRate}%` : '—'}
        </div>
      </div>
    </div>
  )
})()}
```

**Important:** Using hooks inside `.map()` via an IIFE is not valid React. Instead, extract a `GateMetricsCards` component:

```typescript
function GateMetricsCards({ gateId }: { gateId: string }) {
  const { data: metrics } = useGateMetrics(gateId)
  const formatTime = (ms: number) => {
    if (ms === 0) return '—'
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Time/quality</div>
        <div className="mt-1 text-sm font-semibold text-white">
          {metrics ? formatTime(metrics.avgTimeToApprovalMs) : '—'}
        </div>
      </div>
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Pass rate</div>
        <div className="mt-1 text-sm font-semibold text-white">
          {metrics && metrics.totalAttempts > 0 ? `${metrics.approvalRate}%` : '—'}
        </div>
      </div>
    </div>
  )
}
```

Then replace the old grid with:
```tsx
<GateMetricsCards gateId={gate.id} />
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/workbench/sections/GateSection.tsx
git commit -m "feat: wire gate quality metrics to real audit data"
```

---

## Workstream 3: Chat Apply Contract Hardening

### Context
Two issues in the chat-apply flow:

1. `app/api/apply/route.ts:4` uses `process.cwd()` instead of `getBasePath()` — inconsistent with every other route that uses `getBasePath()` from `lib/config.ts`
2. When chat actions are applied, thread surfaces are NOT auto-materialized for newly added steps. The step add API (`app/api/step/route.ts`) materializes surfaces, but the validator's `apply()` writes the sequence directly via `writeSequence()` without touching surfaces.

### Task 3.1: Fix apply route to use getBasePath — test

**Files:**
- Modify: `app/api/apply/route.ts`

**Step 1: Read the current file to understand the change**

Current code at line 4:
```typescript
const BASE_PATH = process.cwd()
```

**Step 2: Replace with getBasePath()**

```typescript
import { getBasePath } from '@/lib/config'
```

Remove the `BASE_PATH` constant. Replace `new ActionValidator(BASE_PATH)` with `new ActionValidator(getBasePath())`.

Full updated file:
```typescript
import { NextRequest } from 'next/server'
import { ActionValidator, type ProposedAction } from '@/lib/chat/validator'
import { getBasePath } from '@/lib/config'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { actions } = body as { actions: ProposedAction[] }

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return Response.json({ success: false, errors: ['No actions provided'] }, { status: 400 })
    }

    if (actions.length > 50) {
      return Response.json({ success: false, errors: ['Too many actions (max 50)'] }, { status: 400 })
    }

    const validator = new ActionValidator(getBasePath())
    const result = await validator.apply(actions)
    return Response.json(result)
  } catch {
    return Response.json(
      { success: false, errors: ['Internal server error'] },
      { status: 500 }
    )
  }
}
```

**Step 3: Run check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add app/api/apply/route.ts
git commit -m "fix: use getBasePath() in chat apply route for consistency"
```

---

### Task 3.2: Auto-materialize surfaces after chat apply

**Files:**
- Modify: `lib/chat/validator.ts:129-176` (the `apply()` method)

**Step 1: Wire materializer into apply**

After `writeSequence()` in the `apply()` method, add surface materialization for `step add` and removal for `step remove`:

Add imports at top of `lib/chat/validator.ts`:
```typescript
import { updateThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { materializeStepSurface, removeStepSurface } from '@/lib/thread-surfaces/materializer'
```

After line 171 (`await writeSequence(this.basePath, sequence)`), add:

```typescript
// Materialize/remove thread surfaces for step mutations
const now = new Date().toISOString()
for (const action of actions) {
  if (action.command === 'step add' && action.args.id) {
    await updateThreadSurfaceState(this.basePath, s =>
      materializeStepSurface(s, String(action.args.id), String(action.args.name || action.args.id), sequence.name, now)
    )
  }
  if (action.command === 'step remove' && action.args.id) {
    await updateThreadSurfaceState(this.basePath, s =>
      removeStepSurface(s, String(action.args.id))
    )
  }
}
```

**Step 2: Add test to validator.test.ts**

```typescript
test('apply materializes thread surface for step add', async () => {
  const v = new ActionValidator(tmpDir)
  const result = await v.apply([{
    command: 'step add',
    args: { id: 'new-step', name: 'New Step', type: 'base', model: 'claude-code', prompt_file: 'p.md' },
  }])
  expect(result.success).toBe(true)

  // Verify surface was created
  const { readThreadSurfaceState } = await import('@/lib/thread-surfaces/repository')
  const state = await readThreadSurfaceState(tmpDir)
  expect(state.threadSurfaces.some(s => s.id === 'thread-new-step')).toBe(true)
})

test('apply removes thread surface for step remove', async () => {
  const v = new ActionValidator(tmpDir)
  // First add a step
  await v.apply([{
    command: 'step add',
    args: { id: 'del-step', name: 'Del', type: 'base', model: 'claude-code', prompt_file: 'p.md' },
  }])
  // Then remove it
  const result = await v.apply([{ command: 'step remove', args: { id: 'del-step' } }])
  expect(result.success).toBe(true)

  const { readThreadSurfaceState } = await import('@/lib/thread-surfaces/repository')
  const state = await readThreadSurfaceState(tmpDir)
  expect(state.threadSurfaces.some(s => s.id === 'thread-del-step')).toBe(false)
})
```

**Step 3: Run tests**

Run: `bun test lib/chat/validator.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add lib/chat/validator.ts lib/chat/validator.test.ts
git commit -m "feat: auto-materialize/remove thread surfaces on chat apply"
```

---

## Workstream 4: Hierarchy Scaffold Hardening

### Context
`resolveThreadSurfaceCanvasData()` in `components/canvas/threadSurfaceScaffold.ts` uses `hasPersistedThreadSurfaceData()` which checks if ANY of `threadSurfaces`, `runs`, or `mergeEvents` has data. But surfaces can exist without runs (step added but never run). The check should prioritize surfaces existence over runs/mergeEvents.

### Task 4.1: Fix scaffold resolution to accept surfaces-only state — test

**Files:**
- Create: `components/canvas/threadSurfaceScaffold.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, test, expect } from 'bun:test'
import { resolveThreadSurfaceCanvasData } from './threadSurfaceScaffold'

describe('resolveThreadSurfaceCanvasData', () => {
  test('returns api source when surfaces exist but runs are empty', () => {
    const result = resolveThreadSurfaceCanvasData({
      status: { name: 'test', steps: [], gates: [], summary: { total: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 } },
      threadSurfaces: [{ id: 'thread-root', parentSurfaceId: null, parentAgentNodeId: null, depth: 0, surfaceLabel: 'Root', role: 'orchestrator', createdAt: '2026-01-01', childSurfaceIds: [], sequenceRef: null, spawnedByAgentId: null }],
      runs: [],
      mergeEvents: [],
    })
    expect(result.source).toBe('api')
    expect(result.threadSurfaces).toHaveLength(1)
  })

  test('returns status-scaffold when all collections are empty arrays', () => {
    const result = resolveThreadSurfaceCanvasData({
      status: { name: 'test', steps: [{ id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', status: 'READY', depends_on: [] }], gates: [], summary: { total: 1, ready: 1, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 } },
      threadSurfaces: [],
      runs: [],
      mergeEvents: [],
    })
    expect(result.source).toBe('status-scaffold')
  })

  test('returns empty when no status and no data', () => {
    const result = resolveThreadSurfaceCanvasData({
      threadSurfaces: [],
      runs: [],
      mergeEvents: [],
    })
    expect(result.source).toBe('empty')
  })
})
```

**Step 2: Run to check if current code passes**

Run: `bun test components/canvas/threadSurfaceScaffold.test.ts`

The first test should FAIL because `hasPersistedThreadSurfaceData` returns `false` when only surfaces exist but runs and mergeEvents are empty (current code requires ANY of them to have data via `||`, but surface-only is valid).

### Task 4.2: Fix scaffold resolution

**Files:**
- Modify: `components/canvas/threadSurfaceScaffold.ts:130-136`

**Step 1: Update `hasPersistedThreadSurfaceData` to check surfaces first**

```typescript
function hasPersistedThreadSurfaceData(
  threadSurfaces?: ThreadSurface[] | null,
  _runs?: RunScope[] | null,
  _mergeEvents?: MergeEvent[] | null,
): boolean {
  // Surfaces existing is sufficient — steps may be added but not yet run.
  // Runs and mergeEvents are optional runtime data.
  return (threadSurfaces?.length ?? 0) > 0
}
```

**Step 2: Run tests**

Run: `bun test components/canvas/threadSurfaceScaffold.test.ts`
Expected: PASS

**Step 3: Run full check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add components/canvas/threadSurfaceScaffold.ts components/canvas/threadSurfaceScaffold.test.ts
git commit -m "fix: accept surfaces-only state as valid API data, prevent unnecessary scaffold fallback"
```

---

## Workstream 5: Audit Log readAll — prerequisite for WS2

### Context
WS2 (Gate Metrics) depends on `audit.readAll(bp)` to read all audit entries. Check if this function exists.

### Task 5.1: Verify audit.readAll exists, add if missing

**Files:**
- Modify: `lib/audit/logger.ts` (only if `readAll` doesn't exist)

**Step 1: Check if `readAll` exists**

Run: `grep -n 'readAll\|export.*function' lib/audit/logger.ts`

If `readAll` doesn't exist:

```typescript
export async function readAll(basePath: string): Promise<AuditEntry[]> {
  const logPath = join(basePath, '.threados', 'audit.log')
  try {
    const content = await readFile(logPath, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}
```

**Step 2: Run check**

Run: `bun run check`

**Step 3: Commit (only if changes were needed)**

```bash
git add lib/audit/logger.ts
git commit -m "feat: add audit.readAll for reading audit log entries"
```

---

## Implementation Order & Dependencies

```
WS5 (Audit readAll)     WS1 (Agent Stats)     WS3 (Chat Apply)      WS4 (Hierarchy)
──────────────           ──────────            ──────────             ──────────
5.1 verify/add           1.1 hook              3.1 getBasePath fix    4.1 tests
      ↓                  1.2 API tests         3.2 surface materialize 4.2 fix
WS2 (Gate Metrics)       1.3 API impl            ↓
──────────               1.4 UI wiring         (commit)
2.1 metrics tests
2.2 metrics impl
2.3 API endpoint
2.4 hook
2.5 UI wiring
```

WS5 must complete before WS2. All other workstreams are independent.

---

## Critical Files

| File | Workstream | Change |
|------|-----------|--------|
| `app/api/agent-stats/route.ts` | WS1 | New — agent stats API |
| `components/workbench/sections/AgentSection.tsx` | WS1 | Wire PerformanceView to real data |
| `lib/ui/api.ts` | WS1+WS2 | Add useAgentPerformance + useGateMetrics hooks |
| `lib/gates/metrics.ts` | WS2 | New — gate metrics computation |
| `app/api/gate-metrics/route.ts` | WS2 | New — gate metrics API |
| `components/workbench/sections/GateSection.tsx` | WS2 | Wire metric cards to real data |
| `lib/audit/logger.ts` | WS5 | Add readAll if missing |
| `app/api/apply/route.ts` | WS3 | Fix getBasePath, consistent config |
| `lib/chat/validator.ts` | WS3 | Materialize surfaces on apply |
| `components/canvas/threadSurfaceScaffold.ts` | WS4 | Fix scaffold check logic |

## Existing Code to Reuse

| What | Where | Used By |
|------|-------|---------|
| `aggregateAgentStats()` | `lib/agents/stats.ts` | WS1 — stats computation |
| `readThreadRunnerState()` | `lib/thread-runner/repository.ts` | WS1 — race/run data |
| `readAgentState()` | `lib/agents/repository.ts` | WS1 — agent lookup |
| `audit.log()` | `lib/audit/logger.ts` | WS2 — audit entries |
| `getBasePath()` | `lib/config.ts` | WS3 — consistent config |
| `materializeStepSurface()` | `lib/thread-surfaces/materializer.ts` | WS3 — surface lifecycle |
| `updateThreadSurfaceState()` | `lib/thread-surfaces/repository.ts` | WS3 — read-compute-write |

---

## Verification

### Per-task
- `bun test <module>.test.ts` after each test+impl pair
- `bun run check` after each commit

### End-to-end
1. **Agent stats**: Assign agent to phase → navigate to Stats tab → see real numbers (or "—" if no Thread Runner runs exist yet)
2. **Gate metrics**: Approve a gate → navigate to GATE section → see pass rate update to 100%, time/quality populate
3. **Chat apply**: Use chat to "add a research step" → Apply → canvas shows new surface (no scaffold fallback in console)
4. **Hierarchy**: Add steps → canvas uses 'api' source → remove all steps → canvas shows 'empty' or 'status-scaffold' with warning

### Full suite
```bash
bun run check   # lint + typecheck + tests
bun dev         # manual browser verification
```
