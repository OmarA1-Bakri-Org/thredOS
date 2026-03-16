# ThreadOS Core Hardening + Product Progression

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the chat contract via structured tool_use, update stale docs, build out the Pack + Builder product loops, bring Thread Runner from locked gate to a functional eligibility + race flow, and add an autoresearch-inspired "Optimize Workflow" analyzer.

**Architecture:** 7 workstreams. WS1 (Chat) touches the LLM layer. WS2 (Docs) is text-only. WS3 (Packs) and WS4 (Builder) are independent domain modules. WS5+WS6 (Thread Runner) are sequential — eligibility first, then race flow. WS7 (AutoResearch) adds LLM-powered sequence optimization reusing existing action infrastructure. All follow TDD with Bun test runner.

**Tech Stack:** Next.js API routes, Zod schemas, React Query mutations, Zustand store, file-backed state under `.threados/`, OpenAI SDK (shared by OpenAI + OpenRouter backends), Bun test runner

---

## Workstream 1: Chat Structured Output (tool_use)

### Context
`app/api/chat/route.ts:40-46` calls `provider.client.chat.completions.create()` with plain streaming, then regex-extracts JSON from free-form text via `lib/chat/extract-actions.ts`. This is fragile — the model may not wrap actions in JSON at all. The OpenAI SDK supports `tools` (function calling) which guarantees structured output. Both OpenAI and OpenRouter backends use the same `openai` npm package, so `tools` works on both.

**Strategy:** Add a `tools` definition to the chat completion call. When the model returns a `tool_calls` response, parse it directly. Keep `extractActions()` as a fallback for models that don't support function calling or when the response is plain text.

### Task 1.1: Define chat tool schema — tests

**Files:**
- Create: `lib/chat/chat-tools.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { CHAT_TOOLS, parseToolCallActions } from './chat-tools'

describe('CHAT_TOOLS', () => {
  test('defines a propose_actions tool', () => {
    const tool = CHAT_TOOLS.find(t => t.function.name === 'propose_actions')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
    expect(tool!.function.parameters).toBeDefined()
  })
})

describe('parseToolCallActions', () => {
  test('parses valid tool call arguments', () => {
    const toolCalls = [{
      id: 'call_1',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [{ command: 'step add', args: { id: 'x', name: 'X', type: 'base', model: 'claude-code', prompt_file: 'p.md' } }],
        }),
      },
    }]
    const result = parseToolCallActions(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].command).toBe('step add')
  })

  test('returns empty array for non-propose_actions tool', () => {
    const toolCalls = [{
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'other_tool', arguments: '{}' },
    }]
    expect(parseToolCallActions(toolCalls)).toEqual([])
  })

  test('returns empty array for malformed arguments', () => {
    const toolCalls = [{
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'propose_actions', arguments: 'not json' },
    }]
    expect(parseToolCallActions(toolCalls)).toEqual([])
  })

  test('returns empty array for empty input', () => {
    expect(parseToolCallActions([])).toEqual([])
    expect(parseToolCallActions(undefined)).toEqual([])
  })

  test('filters invalid action objects', () => {
    const toolCalls = [{
      id: 'call_1',
      type: 'function' as const,
      function: {
        name: 'propose_actions',
        arguments: JSON.stringify({
          actions: [
            { command: 'step add', args: { id: 'a' } },
            { notACommand: true },
            'string-not-object',
          ],
        }),
      },
    }]
    const result = parseToolCallActions(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].command).toBe('step add')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test lib/chat/chat-tools.test.ts`
Expected: FAIL — module not found

### Task 1.2: Define chat tool schema — implementation

**Files:**
- Create: `lib/chat/chat-tools.ts`

**Step 1: Write implementation**

```typescript
import type { ProposedAction } from './validator'

/**
 * OpenAI-compatible tool definition for proposing sequence actions.
 * Both OpenAI and OpenRouter backends accept this format.
 */
export const CHAT_TOOLS: Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}> = [
  {
    type: 'function',
    function: {
      name: 'propose_actions',
      description:
        'Propose one or more sequence mutations. The user will review and approve before they are applied.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  enum: [
                    'step add', 'step remove', 'step update',
                    'run', 'stop', 'restart',
                    'gate approve', 'gate block',
                    'dep add', 'dep remove',
                    'group create', 'fusion create',
                  ],
                },
                args: {
                  type: 'object',
                  description: 'Command-specific arguments (e.g. id, name, type, model, prompt_file, depends_on, step_id, from, to, step_ids, candidate_ids, synth_id)',
                },
              },
              required: ['command', 'args'],
            },
          },
        },
        required: ['actions'],
      },
    },
  },
]

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * Parse tool_calls from the model response into ProposedAction[].
 * Only extracts actions from the `propose_actions` tool.
 */
export function parseToolCallActions(toolCalls: ToolCall[] | undefined | null): ProposedAction[] {
  if (!toolCalls || toolCalls.length === 0) return []

  const actions: ProposedAction[] = []
  for (const call of toolCalls) {
    if (call.function.name !== 'propose_actions') continue
    try {
      const parsed = JSON.parse(call.function.arguments)
      if (Array.isArray(parsed.actions)) {
        for (const action of parsed.actions) {
          if (
            typeof action === 'object' &&
            action !== null &&
            typeof action.command === 'string'
          ) {
            actions.push({
              command: action.command,
              args: action.args ?? {},
            })
          }
        }
      }
    } catch {
      // Malformed arguments — skip
    }
  }
  return actions
}
```

**Step 2: Run tests**

Run: `bun test lib/chat/chat-tools.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/chat/chat-tools.ts lib/chat/chat-tools.test.ts
git commit -m "feat: add chat tool schema and parseToolCallActions for structured output"
```

---

### Task 1.3: Wire tool_use into chat route — non-streaming path

**Files:**
- Modify: `app/api/chat/route.ts`

**Step 1: Update streamLlmResponse to use tools**

Add import at top:
```typescript
import { CHAT_TOOLS, parseToolCallActions } from '@/lib/chat/chat-tools'
```

Replace lines 40-76 of `streamLlmResponse()` with:

```typescript
    const systemPrompt = buildSystemPrompt(sequence)

    // First: attempt non-streaming call with tool_use for structured output
    try {
      const toolResponse = await provider.client.chat.completions.create({
        model: provider.defaultModel ?? resolvedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        tools: CHAT_TOOLS as any,
        tool_choice: 'auto',
      })

      const choice = toolResponse.choices[0]
      if (choice?.message?.tool_calls?.length) {
        // Structured tool_use response — preferred path
        const textContent = choice.message.content ?? ''
        if (textContent) {
          send('message', { content: textContent })
        }

        const proposedActions = parseToolCallActions(choice.message.tool_calls as any)
        if (proposedActions.length > 0) {
          const validator = new ActionValidator(getBasePath())
          const dryRunResult = await validator.dryRun(proposedActions)
          send('actions', { actions: proposedActions })
          if (dryRunResult.valid && dryRunResult.diff) {
            send('diff', { diff: dryRunResult.diff })
          } else if (!dryRunResult.valid) {
            send('message', { content: `\n\nValidation: ${dryRunResult.errors.join(', ')}` })
          }
        } else {
          send('actions', { actions: [] })
        }

        send('done', { model: resolvedModel, structured: true })
        return true
      }

      // No tool calls — model responded with plain text.
      // Send the text and fall through to regex extraction.
      const plainText = choice?.message?.content ?? ''
      if (plainText) {
        send('message', { content: plainText })
      }

      // Extract proposed actions from plain text (fallback)
      try {
        const proposedActions = extractActions(plainText)
        if (proposedActions.length > 0) {
          const validator = new ActionValidator(getBasePath())
          const dryRunResult = await validator.dryRun(proposedActions)
          send('actions', { actions: proposedActions })
          if (dryRunResult.valid && dryRunResult.diff) {
            send('diff', { diff: dryRunResult.diff })
          } else if (!dryRunResult.valid) {
            send('message', { content: `\n\nValidation: ${dryRunResult.errors.join(', ')}` })
          }
        } else {
          send('actions', { actions: [] })
        }
      } catch (e) {
        console.error('[chat/route] Action extraction failed:', e)
        send('actions', { actions: [] })
      }

      send('done', { model: resolvedModel, structured: false })
      return true
    } catch (toolError) {
      // tool_use not supported by this model/backend — fall back to streaming
      console.warn('[chat/route] tool_use failed, falling back to streaming:', (toolError as Error).message)
    }

    // Fallback: streaming without tools (original path)
    const completion = await provider.client.chat.completions.create({
      model: provider.defaultModel ?? resolvedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: true,
    })

    let fullResponseText = ''
    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        send('message', { content, streaming: true })
        fullResponseText += content
      }
    }

    // Extract proposed actions from LLM response
    try {
      const proposedActions = extractActions(fullResponseText)
      if (proposedActions.length > 0) {
        const validator = new ActionValidator(getBasePath())
        const dryRunResult = await validator.dryRun(proposedActions)
        send('actions', { actions: proposedActions })
        if (dryRunResult.valid && dryRunResult.diff) {
          send('diff', { diff: dryRunResult.diff })
        } else if (!dryRunResult.valid) {
          send('message', { content: `\n\nValidation: ${dryRunResult.errors.join(', ')}` })
        }
      } else {
        send('actions', { actions: [] })
      }
    } catch (e) {
      console.error('[chat/route] Action extraction failed:', e)
      send('actions', { actions: [] })
    }

    send('done', { model: resolvedModel })
    return true
```

**Step 2: Run check**

Run: `bun run check`
Expected: typecheck + lint pass

**Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: wire tool_use structured output into chat route with streaming fallback"
```

---

### Task 1.4: Update system prompt to mention tool_use

**Files:**
- Modify: `lib/chat/system-prompt.ts`

**Step 1: Update output format section**

Replace the `## Output Format` section (lines 61-65) with:

```typescript
## Output Format

Use the \`propose_actions\` tool to suggest changes. Each action has a \`command\` and \`args\`:

Example:
\`\`\`json
[{ "command": "step add", "args": { "id": "my-step", "name": "My Step", "type": "base", "model": "claude-code", "prompt_file": "prompts/my-step.md" } }]
\`\`\`

If tool calling is not available, respond with a JSON array in a code fence.
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/chat/system-prompt.ts
git commit -m "feat: update system prompt to reference propose_actions tool"
```

---

## Workstream 2: current-state.md Accuracy

### Context
`docs/product/current-state.md` has stale entries. The "Prototype Only" section lists gate metrics and agent performance as placeholder — both are now wired to real data. The "Partially Implemented" section doesn't reflect the tool_use chat upgrade (WS1). Update after WS1 is done.

### Task 2.1: Update current-state.md

**Files:**
- Modify: `docs/product/current-state.md`

**Step 1: Move gate metrics and agent performance from "Prototype Only" to "Implemented"**

In the "Implemented" section, add:
```markdown
- Agent performance stats are wired to real data. `app/api/agent-stats/route.ts` computes performance from Thread Runner race/run data via `aggregateAgentStats()`, and `components/workbench/sections/AgentSection.tsx` renders runs, pass rate, avg time, and quality from the `useAgentPerformance()` hook.
- Gate quality metrics are wired to real audit data. `lib/gates/metrics.ts` computes approval rate and time-to-approval from audit log entries, `app/api/gate-metrics/route.ts` serves them, and `components/workbench/sections/GateSection.tsx` renders time/quality and pass rate cards via the `useGateMetrics()` hook.
```

In the "Prototype Only" section, remove the two entries about gate metrics and agent performance. If the section becomes empty, remove the heading.

In the "Partially Implemented" section, update the chat entry to mention tool_use:
```markdown
- Chat-assisted orchestration uses structured tool_use (function calling) as the primary output format, with regex-based JSON extraction as a fallback. `app/api/chat/route.ts` passes `CHAT_TOOLS` to the completion call; when the model returns `tool_calls`, actions are parsed directly via `parseToolCallActions()`. When tool_use is unsupported, the route falls back to streaming + `extractActions()`.
```

**Step 2: Commit**

```bash
git add docs/product/current-state.md
git commit -m "docs: update current-state.md — promote gate/agent metrics, note tool_use"
```

---

## Workstream 3: Pack API + UI

### Context
`app/api/packs/route.ts` exists with GET/POST/PATCH using an in-memory `PackRepository`. But there is no file-based persistence (it uses `new PackRepository()` which resets on server restart), no React Query hooks, and no UI section in the workbench. `lib/packs/repository.ts` already has file-backed `readPackState()`/`writePackState()`/`updatePackState()`.

### Task 3.1: Wire packs API to file-backed state — tests

**Files:**
- Create: `test/api/packs-route.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

describe('GET /api/packs', () => {
  const tmpDir = join(import.meta.dir, '..', 'tmp-packs-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.threados', 'state', 'packs.json'),
      JSON.stringify({
        version: 1,
        packs: [{
          id: 'pack-1', type: 'challenger', builderId: 'b1', builderName: 'Builder 1',
          division: 'Frontline', classification: 'Alpha',
          acquiredAt: '2026-01-01T00:00:00Z', highestStatus: 'challenger', statusHistory: [],
        }],
      })
    )
    process.env.THREADOS_BASE_PATH = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.THREADOS_BASE_PATH
  })

  test('returns packs from file state', async () => {
    // Dynamic import to pick up env
    const mod = await import('@/app/api/packs/route')
    const res = await mod.GET()
    const data = await res.json()
    expect(data.packs).toHaveLength(1)
    expect(data.packs[0].id).toBe('pack-1')
  })
})

describe('POST /api/packs', () => {
  const tmpDir = join(import.meta.dir, '..', 'tmp-packs-post-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })
    writeFileSync(join(tmpDir, '.threados', 'state', 'packs.json'), JSON.stringify({ version: 1, packs: [] }))
    process.env.THREADOS_BASE_PATH = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.THREADOS_BASE_PATH
  })

  test('creates a pack and persists to file', async () => {
    const mod = await import('@/app/api/packs/route')
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        builderId: 'b1', builderName: 'Builder', division: 'Frontline',
        classification: 'Alpha', type: 'challenger',
      }),
    })
    const res = await mod.POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.pack.type).toBe('challenger')
  })

  test('rejects missing fields', async () => {
    const mod = await import('@/app/api/packs/route')
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builderId: 'b1' }),
    })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
  })
})
```

**Step 2: Run to verify fails or passes**

Run: `bun test test/api/packs-route.test.ts`
Expected: May fail because current route uses in-memory repo

### Task 3.2: Wire packs API to file-backed state — implementation

**Files:**
- Modify: `app/api/packs/route.ts`

**Step 1: Rewrite to use file-backed state**

```typescript
import { getBasePath } from '@/lib/config'
import { readPackState, updatePackState } from '@/lib/packs/repository'
import type { Pack, PackStatus, PackType } from '@/lib/packs/types'
import { PACK_STATUS_PRIORITY } from '@/lib/packs/types'

const REQUIRED_PACK_FIELDS = ['builderId', 'builderName', 'division', 'classification', 'type'] as const

function validateRequiredPackFields(body: Record<string, unknown>): string | null {
  const missing = REQUIRED_PACK_FIELDS.filter(field => !body[field])
  return missing.length > 0
    ? `Missing required fields: ${REQUIRED_PACK_FIELDS.join(', ')}`
    : null
}

export async function GET() {
  try {
    const state = await readPackState(getBasePath())
    return Response.json({ packs: state.packs })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id, builderId, builderName, division, classification, type } = body as {
      id?: string
      builderId: string
      builderName: string
      division: string
      classification: string
      type: PackType
    }

    const validationError = validateRequiredPackFields(body)
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 })
    }

    const pack: Pack = {
      id: id ?? crypto.randomUUID(),
      type,
      builderId,
      builderName,
      division,
      classification,
      acquiredAt: new Date().toISOString(),
      highestStatus: type,
      statusHistory: [],
    }

    await updatePackState(getBasePath(), (state) => ({
      ...state,
      packs: [...state.packs, pack],
    }))

    return Response.json({ success: true, pack })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { packId, newStatus, context } = body as {
      packId: string
      newStatus: PackStatus
      context: string
    }

    if (!packId || !newStatus || !context) {
      return Response.json({ error: 'Missing required fields: packId, newStatus, context' }, { status: 400 })
    }

    let promoted = false
    let updatedPack: Pack | null = null

    await updatePackState(getBasePath(), (state) => {
      const pack = state.packs.find(p => p.id === packId)
      if (!pack || PACK_STATUS_PRIORITY[newStatus] <= PACK_STATUS_PRIORITY[pack.highestStatus]) {
        return state
      }

      promoted = true
      pack.statusHistory.push({ status: newStatus, achievedAt: new Date().toISOString(), context })
      pack.highestStatus = newStatus
      updatedPack = pack
      return state
    })

    if (!promoted) {
      return Response.json({ error: 'Pack not found or status cannot be promoted (must be unidirectional)' }, { status: 400 })
    }

    return Response.json({ success: true, pack: updatedPack })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 2: Run tests**

Run: `bun test test/api/packs-route.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/packs/route.ts test/api/packs-route.test.ts
git commit -m "feat: wire packs API to file-backed state instead of in-memory repo"
```

---

### Task 3.3: Add pack React Query hooks

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hooks**

Add after the gate metrics section:

```typescript
// ── Pack hooks ────────────────────────────────────────────────────────

export function useListPacks() {
  return useQuery<import('@/lib/packs/types').Pack[]>({
    queryKey: ['packs'],
    queryFn: async () => {
      const res = await fetchJson<{ packs: import('@/lib/packs/types').Pack[] }>('/api/packs')
      return res.packs
    },
    staleTime: 30_000,
  })
}

export function useCreatePack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      builderId: string; builderName: string; division: string;
      classification: string; type: import('@/lib/packs/types').PackType;
    }) => postJson('/api/packs', input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packs'] }) },
  })
}

export function usePromotePack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      packId: string; newStatus: import('@/lib/packs/types').PackStatus; context: string;
    }) => fetchJson('/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packs'] }) },
  })
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Update all test mocks**

Run: `grep -rl "mock.module('@/lib/ui/api'" components/ test/` to find all files that mock this module. Add `useListPacks`, `useCreatePack`, `usePromotePack` to each mock:

```typescript
useListPacks: () => ({ data: [], isLoading: false }),
useCreatePack: () => ({ mutate: () => {}, isPending: false }),
usePromotePack: () => ({ mutate: () => {}, isPending: false }),
```

**Step 4: Run check**

Run: `bun run check`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/ui/api.ts
git add -A components/ test/  # only the mock-updated files
git commit -m "feat: add useListPacks, useCreatePack, usePromotePack hooks + update test mocks"
```

---

### Task 3.4: Create PacksSection UI component

**Files:**
- Create: `components/workbench/sections/PacksSection.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { Package, ChevronUp, Trophy, Shield, Star } from 'lucide-react'
import { useListPacks } from '@/lib/ui/api'
import { PACK_STATUS_PRIORITY } from '@/lib/packs/types'
import type { Pack, PackStatus } from '@/lib/packs/types'

const STATUS_ICON: Record<PackStatus, React.ReactNode> = {
  challenger: <Shield className="h-3.5 w-3.5" />,
  champion: <Trophy className="h-3.5 w-3.5" />,
  hero: <Star className="h-3.5 w-3.5" />,
}

const STATUS_COLOR: Record<PackStatus, string> = {
  challenger: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  champion: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  hero: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
}

function PackCard({ pack }: { pack: Pack }) {
  return (
    <div
      data-testid={`pack-card-${pack.id}`}
      className="border border-slate-800 bg-[#0a101a] px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded border ${STATUS_COLOR[pack.highestStatus]}`}>
            {STATUS_ICON[pack.highestStatus]}
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-200">
            {pack.type}
          </span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${STATUS_COLOR[pack.highestStatus]}`}>
          {pack.highestStatus}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Division:</span> {pack.division}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Classification:</span> {pack.classification}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Builder:</span> {pack.builderName}
        </div>
      </div>
      {pack.statusHistory.length > 0 && (
        <div className="mt-2 border-t border-slate-800/50 pt-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Progression
          </div>
          <div className="mt-1 flex items-center gap-1">
            {pack.statusHistory.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronUp className="h-3 w-3 rotate-90 text-slate-700" />}
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase ${STATUS_COLOR[entry.status]}`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function PacksSection() {
  const { data: packs, isLoading } = useListPacks()

  const sorted = [...(packs ?? [])].sort(
    (a, b) => PACK_STATUS_PRIORITY[b.highestStatus] - PACK_STATUS_PRIORITY[a.highestStatus]
  )

  return (
    <div data-testid="packs-section" className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-slate-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Packs
        </span>
        {packs && (
          <span className="font-mono text-[9px] text-slate-600">
            ({packs.length})
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-center text-xs text-slate-600">Loading packs...</div>
      )}

      {!isLoading && sorted.length === 0 && (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <div className="text-sm text-slate-500">No packs yet</div>
          <div className="mt-1 text-xs text-slate-600">
            Packs are awarded when agents prove themselves in Thread Runner.
          </div>
        </div>
      )}

      {sorted.map(pack => (
        <PackCard key={pack.id} pack={pack} />
      ))}
    </div>
  )
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/workbench/sections/PacksSection.tsx
git commit -m "feat: add PacksSection UI component with pack cards and progression display"
```

---

## Workstream 4: Builder Profile

### Context
There is no `lib/builders/` directory. Builders are referenced by `builderId`/`builderName` on agents and packs, but there is no dedicated builder entity. Need: types, file-backed repository, API endpoint, and a minimal UI section.

### Task 4.1: Create builder types

**Files:**
- Create: `lib/builders/types.ts`

**Step 1: Write types**

```typescript
export interface BuilderProfile {
  id: string
  name: string
  registeredAt: string
  agentIds: string[]
  packIds: string[]
  /** Aggregate stats derived from agent performance */
  stats: BuilderStats
}

export interface BuilderStats {
  totalAgents: number
  totalPacks: number
  highestPackStatus: import('@/lib/packs/types').PackStatus | null
  totalRuns: number
  avgQuality: number
}

export interface BuilderState {
  version: 1
  builders: BuilderProfile[]
}
```

**Step 2: Commit**

```bash
git add lib/builders/types.ts
git commit -m "feat: add builder profile types"
```

---

### Task 4.2: Create builder repository — tests

**Files:**
- Create: `lib/builders/repository.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { readBuilderState, updateBuilderState, deriveBuilderProfile } from './repository'

describe('builder repository', () => {
  const tmpDir = join(import.meta.dir, '..', '..', 'tmp-builder-repo-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns empty state when file does not exist', async () => {
    const state = await readBuilderState(tmpDir)
    expect(state.builders).toEqual([])
  })

  test('reads existing state', async () => {
    writeFileSync(
      join(tmpDir, '.threados', 'state', 'builders.json'),
      JSON.stringify({ version: 1, builders: [{ id: 'b1', name: 'B1', registeredAt: '2026-01-01T00:00:00Z', agentIds: [], packIds: [], stats: { totalAgents: 0, totalPacks: 0, highestPackStatus: null, totalRuns: 0, avgQuality: 0 } }] })
    )
    const state = await readBuilderState(tmpDir)
    expect(state.builders).toHaveLength(1)
    expect(state.builders[0].id).toBe('b1')
  })

  test('updateBuilderState persists changes', async () => {
    await updateBuilderState(tmpDir, (state) => ({
      ...state,
      builders: [...state.builders, {
        id: 'b2', name: 'Builder 2', registeredAt: '2026-01-01T00:00:00Z',
        agentIds: [], packIds: [],
        stats: { totalAgents: 0, totalPacks: 0, highestPackStatus: null, totalRuns: 0, avgQuality: 0 },
      }],
    }))
    const state = await readBuilderState(tmpDir)
    expect(state.builders).toHaveLength(1)
    expect(state.builders[0].id).toBe('b2')
  })
})

describe('deriveBuilderProfile', () => {
  test('aggregates stats from agents and packs', () => {
    const agents = [
      { id: 'a1', builderId: 'b1', name: 'A1', builderName: 'B', registeredAt: '', threadSurfaceIds: [] },
      { id: 'a2', builderId: 'b1', name: 'A2', builderName: 'B', registeredAt: '', threadSurfaceIds: [] },
    ]
    const packs = [
      { id: 'p1', type: 'challenger' as const, builderId: 'b1', builderName: 'B', division: 'D', classification: 'C', acquiredAt: '', highestStatus: 'champion' as const, statusHistory: [] },
    ]
    const profile = deriveBuilderProfile('b1', 'Builder 1', agents as any, packs, { totalRuns: 5, avgQuality: 7 })
    expect(profile.stats.totalAgents).toBe(2)
    expect(profile.stats.totalPacks).toBe(1)
    expect(profile.stats.highestPackStatus).toBe('champion')
    expect(profile.stats.totalRuns).toBe(5)
  })

  test('handles builder with no agents or packs', () => {
    const profile = deriveBuilderProfile('b1', 'Builder 1', [], [], { totalRuns: 0, avgQuality: 0 })
    expect(profile.stats.totalAgents).toBe(0)
    expect(profile.stats.highestPackStatus).toBeNull()
  })
})
```

**Step 2: Run to verify it fails**

Run: `bun test lib/builders/repository.test.ts`
Expected: FAIL — module not found

### Task 4.3: Create builder repository — implementation

**Files:**
- Create: `lib/builders/repository.ts`

**Step 1: Write implementation**

```typescript
import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { BuilderProfile, BuilderState, BuilderStats } from './types'
import type { AgentRegistration } from '@/lib/agents/types'
import type { Pack } from '@/lib/packs/types'
import { PACK_STATUS_PRIORITY } from '@/lib/packs/types'

const BUILDER_STATE_PATH = '.threados/state/builders.json'

const DEFAULT_BUILDER_STATE: BuilderState = {
  version: 1,
  builders: [],
}

export function getBuilderStatePath(basePath: string): string {
  return join(basePath, BUILDER_STATE_PATH)
}

export async function readBuilderState(basePath: string): Promise<BuilderState> {
  const fullPath = getBuilderStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_BUILDER_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<BuilderState>

  return {
    version: 1,
    builders: Array.isArray(raw.builders) ? raw.builders : [],
  }
}

export async function writeBuilderState(basePath: string, state: BuilderState): Promise<void> {
  const fullPath = getBuilderStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updateBuilderState(
  basePath: string,
  updater: (currentState: BuilderState) => BuilderState | Promise<BuilderState>,
): Promise<BuilderState> {
  const currentState = await readBuilderState(basePath)
  const nextState = await updater(currentState)
  await writeBuilderState(basePath, nextState)
  return nextState
}

/**
 * Derive a builder profile by aggregating data from agents and packs.
 */
export function deriveBuilderProfile(
  builderId: string,
  builderName: string,
  agents: AgentRegistration[],
  packs: Pack[],
  runStats: { totalRuns: number; avgQuality: number },
): BuilderProfile {
  const builderAgents = agents.filter(a => a.builderId === builderId)
  const builderPacks = packs.filter(p => p.builderId === builderId)

  let highestPackStatus: import('@/lib/packs/types').PackStatus | null = null
  for (const pack of builderPacks) {
    if (!highestPackStatus || PACK_STATUS_PRIORITY[pack.highestStatus] > PACK_STATUS_PRIORITY[highestPackStatus]) {
      highestPackStatus = pack.highestStatus
    }
  }

  const stats: BuilderStats = {
    totalAgents: builderAgents.length,
    totalPacks: builderPacks.length,
    highestPackStatus,
    totalRuns: runStats.totalRuns,
    avgQuality: runStats.avgQuality,
  }

  return {
    id: builderId,
    name: builderName,
    registeredAt: new Date().toISOString(),
    agentIds: builderAgents.map(a => a.id),
    packIds: builderPacks.map(p => p.id),
    stats,
  }
}
```

**Step 2: Run tests**

Run: `bun test lib/builders/repository.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/builders/types.ts lib/builders/repository.ts lib/builders/repository.test.ts
git commit -m "feat: add builder profile repository with file-backed state and derivation"
```

---

### Task 4.4: Create builder-profile API endpoint

**Files:**
- Create: `app/api/builder-profile/route.ts`

**Step 1: Write implementation**

```typescript
import { getBasePath } from '@/lib/config'
import { readAgentState } from '@/lib/agents/repository'
import { readPackState } from '@/lib/packs/repository'
import { readThreadRunnerState } from '@/lib/thread-runner/repository'
import { aggregateAgentStats } from '@/lib/agents/stats'
import { deriveBuilderProfile } from '@/lib/builders/repository'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const builderId = url.searchParams.get('builderId')

    if (!builderId) {
      return Response.json({ error: 'Missing builderId query parameter' }, { status: 400 })
    }

    const bp = getBasePath()
    const [agentState, packState, runnerState] = await Promise.all([
      readAgentState(bp),
      readPackState(bp),
      readThreadRunnerState(bp),
    ])

    // Find builder name from agents
    const builderAgent = agentState.agents.find(a => a.builderId === builderId)
    if (!builderAgent) {
      return Response.json({ profile: null })
    }

    // Aggregate run stats across all builder's agents
    const builderAgentIds = agentState.agents
      .filter(a => a.builderId === builderId)
      .map(a => a.id)

    let totalRuns = 0
    let qualitySum = 0
    let agentsWithStats = 0

    for (const agentId of builderAgentIds) {
      const stats = aggregateAgentStats(agentId, runnerState.races, runnerState.combatantRuns)
      if (stats.totalRuns > 0) {
        totalRuns += stats.totalRuns
        const quality = stats.avgPlacement > 0
          ? Math.min(10, Math.max(1, Math.round(11 - stats.avgPlacement * 1.5)))
          : 0
        qualitySum += quality
        agentsWithStats++
      }
    }

    const avgQuality = agentsWithStats > 0 ? Math.round(qualitySum / agentsWithStats) : 0

    const profile = deriveBuilderProfile(
      builderId,
      builderAgent.builderName,
      agentState.agents,
      packState.packs,
      { totalRuns, avgQuality },
    )

    return Response.json({ profile })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/builder-profile/route.ts
git commit -m "feat: add builder-profile API endpoint with aggregated stats"
```

---

### Task 4.5: Add builder React Query hook

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hook**

Add after the pack hooks:

```typescript
// ── Builder profile hook ──────────────────────────────────────────────

export function useBuilderProfile(builderId: string | null) {
  return useQuery<import('@/lib/builders/types').BuilderProfile | null>({
    queryKey: ['builder-profile', builderId],
    queryFn: async () => {
      if (!builderId) return null
      const res = await fetchJson<{ profile: import('@/lib/builders/types').BuilderProfile | null }>(
        `/api/builder-profile?builderId=${encodeURIComponent(builderId)}`
      )
      return res.profile
    },
    enabled: !!builderId,
    staleTime: 30_000,
  })
}
```

**Step 2: Update all test mocks**

Add to every file that mocks `@/lib/ui/api`:
```typescript
useBuilderProfile: () => ({ data: null, isLoading: false }),
```

**Step 3: Run check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add lib/ui/api.ts
git add -A components/ test/
git commit -m "feat: add useBuilderProfile hook + update test mocks"
```

---

### Task 4.6: Create BuilderSection UI component

**Files:**
- Create: `components/workbench/sections/BuilderSection.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { User, Bot, Package, Trophy, Activity } from 'lucide-react'
import { useBuilderProfile } from '@/lib/ui/api'
import type { BuilderProfile } from '@/lib/builders/types'

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-600">{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function BuilderCard({ profile }: { profile: BuilderProfile }) {
  return (
    <div data-testid="builder-card" className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center border border-slate-700 bg-slate-900">
          <User className="h-5 w-5 text-slate-400" />
        </div>
        <div>
          <div className="font-mono text-sm text-white">{profile.name}</div>
          <div className="font-mono text-[10px] text-slate-500">ID: {profile.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={<Bot className="h-3 w-3" />}
          label="Agents"
          value={String(profile.stats.totalAgents)}
        />
        <StatCard
          icon={<Package className="h-3 w-3" />}
          label="Packs"
          value={String(profile.stats.totalPacks)}
        />
        <StatCard
          icon={<Trophy className="h-3 w-3" />}
          label="Best Pack"
          value={profile.stats.highestPackStatus ?? '—'}
        />
        <StatCard
          icon={<Activity className="h-3 w-3" />}
          label="Quality"
          value={profile.stats.avgQuality > 0 ? `${profile.stats.avgQuality}/10` : '—'}
        />
      </div>
    </div>
  )
}

export function BuilderSection({ builderId }: { builderId: string | null }) {
  const { data: profile, isLoading } = useBuilderProfile(builderId)

  return (
    <div data-testid="builder-section" className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-slate-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Builder
        </span>
      </div>

      {isLoading && (
        <div className="text-center text-xs text-slate-600">Loading builder profile...</div>
      )}

      {!isLoading && !profile && (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <div className="text-sm text-slate-500">No builder selected</div>
          <div className="mt-1 text-xs text-slate-600">
            Register an agent with a builder identity to see the profile.
          </div>
        </div>
      )}

      {profile && <BuilderCard profile={profile} />}
    </div>
  )
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/workbench/sections/BuilderSection.tsx
git commit -m "feat: add BuilderSection UI component with stats cards"
```

---

## Workstream 5: Thread Runner Eligibility (Data-Driven)

### Context
`lib/thread-runner/repository.ts:68-92` hardcodes `checkEligibility()` to return all requirements as `met: false`. `app/api/thread-runner/eligibility/route.ts` just calls this function. `components/thread-runner/ThreadRunnerGate.tsx` has hardcoded `unlocked: false` for all 3 requirements and doesn't call any API. Need: data-driven eligibility that checks agent, VM, and subscription state, an updated API, and a wired UI.

### Task 5.1: Data-driven eligibility check — tests

**Files:**
- Create: `lib/thread-runner/eligibility.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { checkEligibilityFromState, type EligibilityInput } from './eligibility'

describe('checkEligibilityFromState', () => {
  test('all locked when no agents, no subscription', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: false, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    expect(result.eligible).toBe(false)
    expect(result.requirements.every(r => !r.met)).toBe(true)
  })

  test('verified-identity met when hasVerifiedAgent is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: true, hasVmAccess: false, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'verified-identity')
    expect(req?.met).toBe(true)
    expect(result.eligible).toBe(false)
  })

  test('all met when all inputs true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: true, hasVmAccess: true, hasActiveSubscription: true }
    const result = checkEligibilityFromState(input)
    expect(result.eligible).toBe(true)
    expect(result.requirements.every(r => r.met)).toBe(true)
  })

  test('vm-access met when hasVmAccess is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: true, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'vm-access')
    expect(req?.met).toBe(true)
  })

  test('active-subscription met when hasActiveSubscription is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: false, hasActiveSubscription: true }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'active-subscription')
    expect(req?.met).toBe(true)
  })
})
```

**Step 2: Run to verify it fails**

Run: `bun test lib/thread-runner/eligibility.test.ts`
Expected: FAIL — module not found

### Task 5.2: Data-driven eligibility check — implementation

**Files:**
- Create: `lib/thread-runner/eligibility.ts`

**Step 1: Write implementation**

```typescript
import type { EligibilityStatus } from './types'

export interface EligibilityInput {
  hasVerifiedAgent: boolean
  hasVmAccess: boolean
  hasActiveSubscription: boolean
}

/**
 * Determine eligibility from computed state flags.
 * This replaces the hardcoded checkEligibility() and makes testing straightforward.
 */
export function checkEligibilityFromState(input: EligibilityInput): EligibilityStatus {
  const requirements = [
    {
      key: 'verified-identity',
      label: 'Verified Identity',
      description: 'A verified ThreadOS identity linked to your account.',
      met: input.hasVerifiedAgent,
    },
    {
      key: 'vm-access',
      label: 'VM Access',
      description: 'Managed VM runtime for sandboxed execution environments.',
      met: input.hasVmAccess,
    },
    {
      key: 'active-subscription',
      label: 'Active Subscription',
      description: 'An active paid subscription to the Thread Runner tier.',
      met: input.hasActiveSubscription,
    },
  ]

  return {
    eligible: requirements.every(r => r.met),
    requirements,
  }
}
```

**Step 2: Run tests**

Run: `bun test lib/thread-runner/eligibility.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/thread-runner/eligibility.ts lib/thread-runner/eligibility.test.ts
git commit -m "feat: add data-driven checkEligibilityFromState for Thread Runner"
```

---

### Task 5.3: Update eligibility API to use data-driven check

**Files:**
- Modify: `app/api/thread-runner/eligibility/route.ts`

**Step 1: Wire to real data sources**

```typescript
import { getBasePath } from '@/lib/config'
import { readAgentState } from '@/lib/agents/repository'
import { checkEligibilityFromState } from '@/lib/thread-runner/eligibility'

export async function GET() {
  try {
    const bp = getBasePath()
    const agentState = await readAgentState(bp)

    // hasVerifiedAgent: at least one agent registered with a builder identity
    const hasVerifiedAgent = agentState.agents.some(a => a.builderId && a.builderName)

    // hasVmAccess: currently always false (no VM runtime yet)
    // This will be flipped when the VM integration is implemented.
    const hasVmAccess = false

    // hasActiveSubscription: currently always false (no subscription system yet)
    // This will be flipped when the subscription integration is implemented.
    const hasActiveSubscription = false

    const status = checkEligibilityFromState({
      hasVerifiedAgent,
      hasVmAccess,
      hasActiveSubscription,
    })

    return Response.json(status)
  } catch {
    return Response.json({ eligible: false, requirements: [] }, { status: 500 })
  }
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/thread-runner/eligibility/route.ts
git commit -m "feat: wire eligibility API to data-driven check from agent state"
```

---

### Task 5.4: Add eligibility React Query hook

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hook**

```typescript
// ── Thread Runner eligibility hook ───────────────────────────────────

export function useThreadRunnerEligibility() {
  return useQuery<import('@/lib/thread-runner/types').EligibilityStatus>({
    queryKey: ['thread-runner-eligibility'],
    queryFn: () => fetchJson('/api/thread-runner/eligibility'),
    staleTime: 60_000,
  })
}
```

**Step 2: Update all test mocks**

Add to every file that mocks `@/lib/ui/api`:
```typescript
useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
```

**Step 3: Run check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add lib/ui/api.ts
git add -A components/ test/
git commit -m "feat: add useThreadRunnerEligibility hook + update test mocks"
```

---

### Task 5.5: Wire ThreadRunnerGate to real eligibility data

**Files:**
- Modify: `components/thread-runner/ThreadRunnerGate.tsx`

**Step 1: Replace hardcoded requirements with API data**

```typescript
'use client'

import { LockKeyhole, ShieldCheck, Trophy, Cpu, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThreadRunnerEligibility } from '@/lib/ui/api'
import type { EligibilityRequirement } from '@/lib/thread-runner/types'

const ICON_MAP: Record<string, React.ReactNode> = {
  'verified-identity': <ShieldCheck className="h-4 w-4" />,
  'vm-access': <Cpu className="h-4 w-4" />,
  'active-subscription': <LockKeyhole className="h-4 w-4" />,
}

function RequirementRow({ req }: { req: EligibilityRequirement }) {
  return (
    <div
      data-testid={`requirement-${req.key}`}
      className="flex items-start gap-4 border border-slate-800/90 bg-[#08101d] px-5 py-4"
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border ${
          req.met
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-slate-700 bg-slate-900 text-slate-500'
        }`}
      >
        {ICON_MAP[req.key] ?? <LockKeyhole className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-200">
            {req.label}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${
              req.met
                ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border border-slate-700 bg-slate-900 text-slate-500'
            }`}
          >
            {req.met ? 'Unlocked' : 'Locked'}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{req.description}</p>
      </div>
    </div>
  )
}

export function ThreadRunnerGate() {
  const { data: eligibility, isLoading } = useThreadRunnerEligibility()

  return (
    <div data-testid="thread-runner-gate" className="flex h-full items-center justify-center bg-[#060a12]">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-6 py-12">
        <div className="flex h-14 w-14 items-center justify-center border border-amber-500/35 bg-amber-500/10">
          <Trophy className="h-7 w-7 text-amber-300" />
        </div>

        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Thread Runner</h2>
          <p className="text-sm leading-6 text-slate-400">
            The locked proving layer for verified competitive runs. Meet all requirements below to unlock entry.
          </p>
        </div>

        <div data-testid="thread-runner-requirements" className="w-full space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            </div>
          )}
          {eligibility?.requirements.map(req => (
            <RequirementRow key={req.key} req={req} />
          ))}
        </div>

        <Button
          type="button"
          variant="warning"
          disabled={!eligibility?.eligible}
          className="w-full"
          data-testid="check-eligibility-btn"
        >
          {eligibility?.eligible ? 'Enter Thread Runner' : 'Check Eligibility'}
        </Button>

        <p className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">
          Thread Runner access is gated by verified eligibility
        </p>
      </div>
    </div>
  )
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/thread-runner/ThreadRunnerGate.tsx
git commit -m "feat: wire ThreadRunnerGate to real eligibility data from API"
```

---

## Workstream 6: Thread Runner Race Flow

### Context
`lib/thread-runner/repository.ts` has `ThreadRunnerRepository` with `enrollRace()`, `recordCombatantRun()`, `getResultsForRace()` — all in-memory. `lib/thread-runner/types.ts` defines `Race`, `CombatantRun`, `RaceResult`. File-backed `readThreadRunnerState()`/`writeThreadRunnerState()` exist. No API endpoint for race operations and no race UI.

### Task 6.1: Create race executor — tests

**Files:**
- Create: `lib/thread-runner/race-executor.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { enrollRace, recordRun, getRaceResults, listRaces } from './race-executor'

describe('race-executor', () => {
  const tmpDir = join(import.meta.dir, '..', '..', 'tmp-race-exec-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(tmpDir, '.threados', 'state'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.threados', 'state', 'thread-runner.json'),
      JSON.stringify({ version: 1, races: [], combatantRuns: [] })
    )
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('enrollRace creates a race and persists it', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'Race 1', division: 'Frontline', classification: 'Alpha', maxCombatants: 4,
    })
    expect(race.id).toBeDefined()
    expect(race.status).toBe('open')
    expect(race.combatantRunIds).toEqual([])

    const races = await listRaces(tmpDir)
    expect(races).toHaveLength(1)
  })

  test('recordRun attaches a run to a race', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 4,
    })

    const run = await recordRun(tmpDir, {
      raceId: race.id,
      combatantId: 'agent-1',
      threadSurfaceId: 'ts-1',
    })

    expect(run.id).toBeDefined()
    expect(run.status).toBe('pending')
    expect(run.raceId).toBe(race.id)
  })

  test('getRaceResults returns sorted placements', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 4,
    })

    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a1', threadSurfaceId: 'ts-1' })
    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a2', threadSurfaceId: 'ts-2' })

    const results = await getRaceResults(tmpDir, race.id)
    expect(results.raceId).toBe(race.id)
    // No completed runs yet, so placements should be empty
    expect(results.placements).toEqual([])
  })

  test('recordRun rejects when race is full', async () => {
    const race = await enrollRace(tmpDir, {
      name: 'R', division: 'D', classification: 'C', maxCombatants: 1,
    })
    await recordRun(tmpDir, { raceId: race.id, combatantId: 'a1', threadSurfaceId: 'ts-1' })

    await expect(
      recordRun(tmpDir, { raceId: race.id, combatantId: 'a2', threadSurfaceId: 'ts-2' })
    ).rejects.toThrow('full')
  })

  test('recordRun rejects when race does not exist', async () => {
    await expect(
      recordRun(tmpDir, { raceId: 'nonexistent', combatantId: 'a1', threadSurfaceId: 'ts-1' })
    ).rejects.toThrow('not found')
  })
})
```

**Step 2: Run to verify it fails**

Run: `bun test lib/thread-runner/race-executor.test.ts`
Expected: FAIL — module not found

### Task 6.2: Create race executor — implementation

**Files:**
- Create: `lib/thread-runner/race-executor.ts`

**Step 1: Write implementation**

```typescript
import { readThreadRunnerState, updateThreadRunnerState } from './repository'
import type { CombatantRun, Race, RaceResult } from './types'

interface EnrollRaceInput {
  name: string
  division: string
  classification: string
  maxCombatants: number
}

interface RecordRunInput {
  raceId: string
  combatantId: string
  threadSurfaceId: string
}

export async function enrollRace(basePath: string, input: EnrollRaceInput): Promise<Race> {
  const race: Race = {
    id: `race-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name,
    division: input.division,
    classification: input.classification,
    startAt: new Date().toISOString(),
    endAt: null,
    status: 'open',
    maxCombatants: input.maxCombatants,
    combatantRunIds: [],
  }

  await updateThreadRunnerState(basePath, (state) => ({
    ...state,
    races: [...state.races, race],
  }))

  return race
}

export async function recordRun(basePath: string, input: RecordRunInput): Promise<CombatantRun> {
  const state = await readThreadRunnerState(basePath)
  const race = state.races.find(r => r.id === input.raceId)

  if (!race) {
    throw new Error(`Race ${input.raceId} not found`)
  }

  if (race.combatantRunIds.length >= race.maxCombatants) {
    throw new Error(`Race ${input.raceId} is full (max ${race.maxCombatants})`)
  }

  const run: CombatantRun = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    raceId: input.raceId,
    combatantId: input.combatantId,
    threadSurfaceId: input.threadSurfaceId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'pending',
    verifiedAt: null,
    placement: null,
  }

  await updateThreadRunnerState(basePath, (state) => {
    const raceToUpdate = state.races.find(r => r.id === input.raceId)
    if (raceToUpdate) {
      raceToUpdate.combatantRunIds.push(run.id)
    }
    return {
      ...state,
      combatantRuns: [...state.combatantRuns, run],
    }
  })

  return run
}

export async function listRaces(basePath: string): Promise<Race[]> {
  const state = await readThreadRunnerState(basePath)
  return state.races
}

export async function getRaceResults(basePath: string, raceId: string): Promise<RaceResult> {
  const state = await readThreadRunnerState(basePath)
  const race = state.races.find(r => r.id === raceId)

  if (!race) {
    return { raceId, placements: [] }
  }

  const completedRuns = race.combatantRunIds
    .map(id => state.combatantRuns.find(r => r.id === id))
    .filter((run): run is CombatantRun => run != null && run.status === 'completed' && run.placement != null)
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))

  return {
    raceId,
    placements: completedRuns.map(run => ({
      combatantRunId: run.id,
      combatantId: run.combatantId,
      placement: run.placement!,
      time: run.endedAt && run.startedAt
        ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
        : 0,
      verifiedAt: run.verifiedAt ?? new Date().toISOString(),
    })),
  }
}
```

**Step 2: Run tests**

Run: `bun test lib/thread-runner/race-executor.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/thread-runner/race-executor.ts lib/thread-runner/race-executor.test.ts
git commit -m "feat: add file-backed race executor for Thread Runner"
```

---

### Task 6.3: Create race API endpoint

**Files:**
- Create: `app/api/thread-runner/race/route.ts`

**Step 1: Write implementation**

```typescript
import { getBasePath } from '@/lib/config'
import { enrollRace, recordRun, listRaces, getRaceResults } from '@/lib/thread-runner/race-executor'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const raceId = url.searchParams.get('raceId')
    const bp = getBasePath()

    if (raceId) {
      const results = await getRaceResults(bp, raceId)
      return Response.json({ results })
    }

    const races = await listRaces(bp)
    return Response.json({ races })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body as { action: string }
    const bp = getBasePath()

    if (action === 'enroll') {
      const { name, division, classification, maxCombatants } = body as {
        name: string; division: string; classification: string; maxCombatants?: number
      }
      if (!name || !division || !classification) {
        return Response.json({ error: 'Missing required fields: name, division, classification' }, { status: 400 })
      }
      const race = await enrollRace(bp, { name, division, classification, maxCombatants: maxCombatants ?? 4 })
      return Response.json({ success: true, race }, { status: 201 })
    }

    if (action === 'record-run') {
      const { raceId, combatantId, threadSurfaceId } = body as {
        raceId: string; combatantId: string; threadSurfaceId: string
      }
      if (!raceId || !combatantId || !threadSurfaceId) {
        return Response.json({ error: 'Missing required fields: raceId, combatantId, threadSurfaceId' }, { status: 400 })
      }
      const run = await recordRun(bp, { raceId, combatantId, threadSurfaceId })
      return Response.json({ success: true, run }, { status: 201 })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    const status = message.includes('not found') || message.includes('full') ? 400 : 500
    return Response.json({ error: message }, { status })
  }
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/thread-runner/race/route.ts
git commit -m "feat: add Thread Runner race API (enroll, record-run, list, results)"
```

---

### Task 6.4: Add race React Query hooks

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hooks**

```typescript
// ── Thread Runner race hooks ─────────────────────────────────────────

export function useListRaces() {
  return useQuery<import('@/lib/thread-runner/types').Race[]>({
    queryKey: ['thread-runner-races'],
    queryFn: async () => {
      const res = await fetchJson<{ races: import('@/lib/thread-runner/types').Race[] }>('/api/thread-runner/race')
      return res.races
    },
    staleTime: 10_000,
  })
}

export function useRaceResults(raceId: string | null) {
  return useQuery<import('@/lib/thread-runner/types').RaceResult | null>({
    queryKey: ['thread-runner-race-results', raceId],
    queryFn: async () => {
      if (!raceId) return null
      const res = await fetchJson<{ results: import('@/lib/thread-runner/types').RaceResult }>(
        `/api/thread-runner/race?raceId=${encodeURIComponent(raceId)}`
      )
      return res.results
    },
    enabled: !!raceId,
    staleTime: 5_000,
  })
}

export function useEnrollRace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; division: string; classification: string; maxCombatants?: number }) =>
      postJson('/api/thread-runner/race', { action: 'enroll', ...input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['thread-runner-races'] }) },
  })
}

export function useRecordRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { raceId: string; combatantId: string; threadSurfaceId: string }) =>
      postJson('/api/thread-runner/race', { action: 'record-run', ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-runner-races'] })
      qc.invalidateQueries({ queryKey: ['thread-runner-race-results'] })
    },
  })
}
```

**Step 2: Update all test mocks**

Add to every file that mocks `@/lib/ui/api`:
```typescript
useListRaces: () => ({ data: [], isLoading: false }),
useRaceResults: () => ({ data: null, isLoading: false }),
useEnrollRace: () => ({ mutate: () => {}, isPending: false }),
useRecordRun: () => ({ mutate: () => {}, isPending: false }),
```

**Step 3: Run check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add lib/ui/api.ts
git add -A components/ test/
git commit -m "feat: add Thread Runner race hooks (list, results, enroll, record-run) + update test mocks"
```

---

### Task 6.5: Create RaceView UI component

**Files:**
- Create: `components/thread-runner/RaceView.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { Flag, Timer, Medal, Users } from 'lucide-react'
import { useListRaces, useRaceResults } from '@/lib/ui/api'
import { useState } from 'react'
import type { Race, RaceResult } from '@/lib/thread-runner/types'

const STATUS_COLOR: Record<Race['status'], string> = {
  open: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  running: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  completed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  cancelled: 'text-red-400 border-red-500/30 bg-red-500/10',
}

function RaceCard({ race, onSelect, selected }: { race: Race; onSelect: () => void; selected: boolean }) {
  return (
    <button
      type="button"
      data-testid={`race-card-${race.id}`}
      onClick={onSelect}
      className={`w-full border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-slate-800 bg-[#0a101a] hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-[11px] text-slate-200">{race.name}</span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${STATUS_COLOR[race.status]}`}>
          {race.status}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500">
        <span>{race.division}</span>
        <span className="text-slate-700">|</span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {race.combatantRunIds.length}/{race.maxCombatants}
        </span>
      </div>
    </button>
  )
}

function ResultsPanel({ raceId }: { raceId: string }) {
  const { data: results, isLoading } = useRaceResults(raceId)

  if (isLoading) {
    return <div className="py-4 text-center text-xs text-slate-600">Loading results...</div>
  }

  if (!results || results.placements.length === 0) {
    return (
      <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
        No completed runs yet. Results appear as combatants finish.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Results</div>
      {results.placements.map((p, i) => (
        <div key={p.combatantRunId} className="flex items-center gap-3 border border-slate-800 bg-[#0a101a] px-3 py-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${
            i === 0 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : i <= 2 ? 'border-slate-600 bg-slate-800 text-slate-300'
            : 'border-slate-700 bg-slate-900 text-slate-500'
          }`}>
            {p.placement}
          </div>
          <div className="flex-1">
            <div className="font-mono text-[11px] text-slate-200">{p.combatantId}</div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <Timer className="h-3 w-3" />
            {p.time > 0 ? `${(p.time / 1000).toFixed(1)}s` : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RaceView() {
  const { data: races, isLoading } = useListRaces()
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null)

  return (
    <div data-testid="race-view" className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Medal className="h-4 w-4 text-amber-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Races
        </span>
        {races && (
          <span className="font-mono text-[9px] text-slate-600">({races.length})</span>
        )}
      </div>

      {isLoading && (
        <div className="py-4 text-center text-xs text-slate-600">Loading races...</div>
      )}

      {!isLoading && (!races || races.length === 0) && (
        <div className="border border-dashed border-slate-800 px-3 py-6 text-center">
          <Medal className="mx-auto h-8 w-8 text-slate-700" />
          <div className="mt-2 text-sm text-slate-500">No races yet</div>
          <div className="mt-1 text-xs text-slate-600">
            Races are created when agents compete in Thread Runner proving runs.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {races?.map(race => (
          <RaceCard
            key={race.id}
            race={race}
            selected={selectedRaceId === race.id}
            onSelect={() => setSelectedRaceId(selectedRaceId === race.id ? null : race.id)}
          />
        ))}
      </div>

      {selectedRaceId && <ResultsPanel raceId={selectedRaceId} />}
    </div>
  )
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/thread-runner/RaceView.tsx
git commit -m "feat: add RaceView component with race list, selection, and results panel"
```

---

## Workstream 7: AutoResearch — Optimize Workflow

### Context
Inspired by Karpathy's autoresearch pattern (autonomous experimentation + ratcheting improvements). For ThreadOS, the "code" being optimized is the sequence YAML — an LLM analyzer reads the current sequence structure, identifies optimization opportunities (parallelizable steps, missing gates, redundant dependencies, agent mismatches), and proposes improvements using the existing `ProposedAction[]` format.

**Strategy:** Reuse all existing infrastructure: LLM provider, `ProposedAction` format, `ActionValidator.dryRun()`, and the action card UI. The new code is just the optimization-focused prompt builder, tool schema, and the API endpoint that triggers analysis.

### Task 7.1: Define optimization types

**Files:**
- Create: `lib/autoresearch/types.ts`

**Step 1: Write types**

```typescript
import type { ProposedAction } from '@/lib/chat/validator'

export type OptimizationCategory =
  | 'parallelize'
  | 'add-gate'
  | 'remove-dep'
  | 'reorder'
  | 'reassign-agent'

export interface OptimizationSuggestion {
  id: string
  category: OptimizationCategory
  title: string
  description: string
  confidence: number // 0-1
  impact: 'low' | 'medium' | 'high'
  actions: ProposedAction[]
}

export interface OptimizationResult {
  analyzedAt: string
  suggestions: OptimizationSuggestion[]
  summary: string
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/autoresearch/types.ts
git commit -m "feat: add optimization types for autoresearch workflow analyzer"
```

---

### Task 7.2: Build optimization prompt — tests + implementation

**Files:**
- Create: `lib/autoresearch/build-optimization-prompt.ts`
- Create: `lib/autoresearch/build-optimization-prompt.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { buildOptimizationPrompt } from './build-optimization-prompt'
import type { Sequence } from '@/lib/sequence/schema'

describe('buildOptimizationPrompt', () => {
  const minimalSequence: Sequence = {
    name: 'Test Seq',
    version: 1,
    steps: [
      { id: 'a', name: 'A', type: 'base', model: 'claude-code', prompt_file: 'a.md', depends_on: [], status: 'READY' },
      { id: 'b', name: 'B', type: 'base', model: 'claude-code', prompt_file: 'b.md', depends_on: [], status: 'READY' },
    ],
    gates: [],
    policy: { safe_mode: true, max_parallel: 4 },
  }

  test('includes sequence state', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('Test Seq')
  })

  test('includes optimization categories', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('parallelize')
    expect(prompt).toContain('add-gate')
  })

  test('includes the propose_optimizations tool reference', () => {
    const prompt = buildOptimizationPrompt(minimalSequence)
    expect(prompt).toContain('propose_optimizations')
  })

  test('handles empty sequence', () => {
    const empty: Sequence = { name: 'Empty', version: 1, steps: [], gates: [], policy: { safe_mode: true, max_parallel: 4 } }
    const prompt = buildOptimizationPrompt(empty)
    expect(prompt).toContain('Empty')
  })
})
```

**Step 2: Run to verify it fails**

Run: `bun test lib/autoresearch/build-optimization-prompt.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import type { Sequence } from '@/lib/sequence/schema'
import YAML from 'yaml'

export function buildOptimizationPrompt(sequence: Sequence): string {
  const stateYaml = YAML.stringify({
    name: sequence.name,
    version: sequence.version,
    steps: sequence.steps.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      depends_on: s.depends_on,
      model: s.model,
      assigned_agent_id: s.assigned_agent_id,
    })),
    gates: sequence.gates.map(g => ({
      id: g.id,
      name: g.name,
      status: g.status,
      depends_on: g.depends_on,
    })),
    policy: sequence.policy,
  })

  return `You are the ThreadOS Workflow Optimizer. Analyze the current sequence and propose structural improvements.

## Current Sequence

\`\`\`yaml
${stateYaml}\`\`\`

## Optimization Categories

Analyze the sequence for these optimization opportunities:

- **parallelize** — Steps with no mutual dependency that run sequentially. Convert to parallel (type: 'p') or remove unnecessary deps.
- **add-gate** — Quality checkpoints missing between critical stages.
- **remove-dep** — Redundant or transitive dependencies that slow execution.
- **reorder** — Steps ordered suboptimally. Reorder to minimize critical path length.
- **reassign-agent** — Steps assigned to an agent whose skills don't match the task.

## Rules

1. Only propose changes that improve the sequence.
2. Each suggestion must include concrete actions using ThreadOS commands (step add, step update, dep add, dep remove, group create, etc.).
3. Rate your confidence (0-1) and expected impact (low/medium/high).
4. Provide a clear explanation of WHY each change improves the sequence.
5. Use the propose_optimizations tool to return your analysis.

## Available Commands

step add, step remove, step update, dep add, dep remove, gate approve, gate block, group create, fusion create, run, stop, restart.`
}
```

**Step 4: Run tests**

Run: `bun test lib/autoresearch/build-optimization-prompt.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/autoresearch/build-optimization-prompt.ts lib/autoresearch/build-optimization-prompt.test.ts
git commit -m "feat: add buildOptimizationPrompt for autoresearch workflow analysis"
```

---

### Task 7.3: Build optimization tool schema + parser — tests + implementation

**Files:**
- Create: `lib/autoresearch/optimization-tools.ts`
- Create: `lib/autoresearch/optimization-tools.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { OPTIMIZATION_TOOLS, parseOptimizationToolCall } from './optimization-tools'

describe('OPTIMIZATION_TOOLS', () => {
  test('defines propose_optimizations tool', () => {
    const tool = OPTIMIZATION_TOOLS.find(t => t.function.name === 'propose_optimizations')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
  })
})

describe('parseOptimizationToolCall', () => {
  test('parses valid tool call', () => {
    const args = JSON.stringify({
      suggestions: [{
        category: 'parallelize',
        title: 'Run A and B in parallel',
        description: 'Steps A and B have no dependencies on each other',
        confidence: 0.9,
        impact: 'high',
        actions: [{ command: 'dep remove', args: { from: 'b', to: 'a' } }],
      }],
      summary: 'Found 1 optimization.',
    })
    const result = parseOptimizationToolCall(args)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].category).toBe('parallelize')
    expect(result.summary).toBe('Found 1 optimization.')
  })

  test('returns empty for invalid JSON', () => {
    const result = parseOptimizationToolCall('not json')
    expect(result.suggestions).toEqual([])
  })

  test('filters invalid suggestions', () => {
    const args = JSON.stringify({
      suggestions: [
        { category: 'parallelize', title: 'Valid', description: 'd', confidence: 0.8, impact: 'high', actions: [] },
        { bad: 'data' },
      ],
      summary: 'test',
    })
    const result = parseOptimizationToolCall(args)
    expect(result.suggestions).toHaveLength(1)
  })
})
```

**Step 2: Run to verify it fails**

Run: `bun test lib/autoresearch/optimization-tools.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import type { OptimizationSuggestion, OptimizationResult, OptimizationCategory } from './types'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

const VALID_CATEGORIES: OptimizationCategory[] = ['parallelize', 'add-gate', 'remove-dep', 'reorder', 'reassign-agent']

export const OPTIMIZATION_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_optimizations',
      description: 'Propose structural optimizations for the current ThreadOS sequence',
      parameters: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: VALID_CATEGORIES },
                title: { type: 'string' },
                description: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                impact: { type: 'string', enum: ['low', 'medium', 'high'] },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      command: { type: 'string' },
                      args: { type: 'object' },
                    },
                    required: ['command', 'args'],
                  },
                },
              },
              required: ['category', 'title', 'description', 'confidence', 'impact', 'actions'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['suggestions', 'summary'],
      },
    },
  },
]

function isValidSuggestion(obj: unknown): obj is OptimizationSuggestion {
  if (typeof obj !== 'object' || obj === null) return false
  const s = obj as Record<string, unknown>
  return (
    typeof s.category === 'string' &&
    VALID_CATEGORIES.includes(s.category as OptimizationCategory) &&
    typeof s.title === 'string' &&
    typeof s.description === 'string' &&
    typeof s.confidence === 'number' &&
    typeof s.impact === 'string' &&
    Array.isArray(s.actions)
  )
}

export function parseOptimizationToolCall(argsJson: string): OptimizationResult {
  try {
    const parsed = JSON.parse(argsJson)
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter(isValidSuggestion).map((s: OptimizationSuggestion, i: number) => ({
          ...s,
          id: `opt-${i}`,
        }))
      : []
    return {
      analyzedAt: new Date().toISOString(),
      suggestions,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    }
  } catch {
    return { analyzedAt: new Date().toISOString(), suggestions: [], summary: '' }
  }
}
```

**Step 4: Run tests**

Run: `bun test lib/autoresearch/optimization-tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/autoresearch/optimization-tools.ts lib/autoresearch/optimization-tools.test.ts
git commit -m "feat: add optimization tool schema and parser for autoresearch"
```

---

### Task 7.4: Create optimize API route

**Files:**
- Create: `app/api/optimize/route.ts`

**Step 1: Write implementation**

```typescript
import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { readSequence } from '@/lib/sequence/yaml-io'
import { createConfiguredProvider } from '@/lib/llm/providers'
import { buildOptimizationPrompt } from '@/lib/autoresearch/build-optimization-prompt'
import { OPTIMIZATION_TOOLS, parseOptimizationToolCall } from '@/lib/autoresearch/optimization-tools'
import { ActionValidator } from '@/lib/chat/validator'
import { extractActions } from '@/lib/chat/extract-actions'

export async function POST() {
  try {
    const bp = getBasePath()
    const sequence = await readSequence(bp)

    const provider = createConfiguredProvider(process.env)
    if (!provider.client) {
      return NextResponse.json({ error: 'No LLM provider configured' }, { status: 503 })
    }

    const systemPrompt = buildOptimizationPrompt(sequence)

    const completion = await provider.client.chat.completions.create({
      model: provider.defaultModel ?? 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Analyze this sequence and propose optimizations.' },
      ],
      tools: OPTIMIZATION_TOOLS,
      tool_choice: { type: 'function', function: { name: 'propose_optimizations' } },
    })

    const message = completion.choices[0]?.message
    let result

    // Try tool_calls first (structured output)
    if (message?.tool_calls?.[0]) {
      const toolCall = message.tool_calls[0]
      result = parseOptimizationToolCall(toolCall.function.arguments)
    } else if (message?.content) {
      // Fallback: try to extract from free text
      const actions = extractActions(message.content)
      result = {
        analyzedAt: new Date().toISOString(),
        suggestions: actions.length > 0 ? [{
          id: 'opt-0',
          category: 'parallelize' as const,
          title: 'Suggested changes',
          description: message.content.slice(0, 200),
          confidence: 0.5,
          impact: 'medium' as const,
          actions,
        }] : [],
        summary: message.content.slice(0, 500),
      }
    } else {
      result = { analyzedAt: new Date().toISOString(), suggestions: [], summary: 'No suggestions.' }
    }

    // Validate each suggestion's actions via dryRun
    const validator = new ActionValidator(bp)
    for (const suggestion of result.suggestions) {
      if (suggestion.actions.length > 0) {
        const dryResult = await validator.dryRun(suggestion.actions)
        if (!dryResult.valid) {
          suggestion.confidence = Math.max(0, suggestion.confidence - 0.3)
          suggestion.description += ` (Validation warnings: ${dryResult.errors.join(', ')})`
        }
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Optimization failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add app/api/optimize/route.ts
git commit -m "feat: add /api/optimize endpoint — autoresearch workflow analyzer"
```

---

### Task 7.5: Add optimize React Query hook + update test mocks

**Files:**
- Modify: `lib/ui/api.ts`

**Step 1: Add hook**

```typescript
// ── AutoResearch optimize hooks ─────────────────────────────────────

export function useOptimizeWorkflow() {
  return useMutation<import('@/lib/autoresearch/types').OptimizationResult>({
    mutationFn: () => postJson('/api/optimize', {}),
  })
}
```

**Step 2: Update all test mocks**

Add to every file that mocks `@/lib/ui/api`:
```typescript
useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: () => Promise.resolve({ suggestions: [], summary: '', analyzedAt: '' }), isPending: false }),
```

**Step 3: Run check**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add lib/ui/api.ts
git add -A components/ test/
git commit -m "feat: add useOptimizeWorkflow hook + update test mocks"
```

---

### Task 7.6: Create OptimizeButton UI component

**Files:**
- Create: `components/autoresearch/OptimizeButton.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { Sparkles, Loader2, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useOptimizeWorkflow } from '@/lib/ui/api'
import type { OptimizationSuggestion } from '@/lib/autoresearch/types'

const IMPACT_COLOR: Record<string, string> = {
  low: 'text-slate-400 border-slate-600 bg-slate-800',
  medium: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  high: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
}

const CATEGORY_LABEL: Record<string, string> = {
  parallelize: 'Parallelize',
  'add-gate': 'Add Gate',
  'remove-dep': 'Remove Dep',
  reorder: 'Reorder',
  'reassign-agent': 'Reassign Agent',
}

function SuggestionCard({ suggestion }: { suggestion: OptimizationSuggestion }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      data-testid={`suggestion-${suggestion.id}`}
      className="border border-slate-800 bg-[#0a101a] px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono text-[11px] text-slate-200">{suggestion.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase ${IMPACT_COLOR[suggestion.impact]}`}>
            {suggestion.impact}
          </span>
          <span className="font-mono text-[9px] text-slate-500">
            {Math.round(suggestion.confidence * 100)}%
          </span>
          {expanded ? <ChevronUp className="h-3 w-3 text-slate-600" /> : <ChevronDown className="h-3 w-3 text-slate-600" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-800/50 pt-3">
          <div className="flex items-center gap-2">
            <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[8px] uppercase text-slate-400">
              {CATEGORY_LABEL[suggestion.category] ?? suggestion.category}
            </span>
          </div>
          <p className="text-xs leading-5 text-slate-400">{suggestion.description}</p>
          {suggestion.actions.length > 0 && (
            <div className="rounded border border-slate-800 bg-[#060a12] p-2">
              <div className="font-mono text-[9px] text-slate-600">
                {suggestion.actions.length} action{suggestion.actions.length !== 1 ? 's' : ''}: {suggestion.actions.map(a => a.command).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function OptimizeButton() {
  const optimize = useOptimizeWorkflow()
  const [showResults, setShowResults] = useState(false)

  const handleOptimize = () => {
    optimize.mutate(undefined, {
      onSuccess: () => setShowResults(true),
    })
  }

  return (
    <div data-testid="optimize-workflow">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={optimize.isPending}
        onClick={handleOptimize}
        className="gap-1.5"
      >
        {optimize.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {optimize.isPending ? 'Analyzing...' : 'Optimize Workflow'}
        </span>
      </Button>

      {showResults && optimize.data && (
        <div className="mt-3 space-y-3">
          {optimize.data.summary && (
            <p className="text-xs text-slate-400">{optimize.data.summary}</p>
          )}
          {optimize.data.suggestions.length === 0 && (
            <div className="text-center text-xs text-slate-500">No optimizations found.</div>
          )}
          {optimize.data.suggestions.map(s => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Run check**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add components/autoresearch/OptimizeButton.tsx
git commit -m "feat: add OptimizeButton component — autoresearch workflow optimizer UI"
```

---

## Implementation Order & Dependencies

```
WS1 (Chat)               WS3 (Packs)           WS4 (Builder)        WS5 (Eligibility)     WS7 (AutoResearch)
──────────                ──────────             ──────────           ──────────             ──────────
1.1 tool tests            3.1 API tests          4.1 types            5.1 eligibility tests  7.1 types
  ↓                         ↓                    4.2 repo tests         ↓                    7.2 prompt
1.2 tool impl             3.2 API impl             ↓                 5.2 eligibility impl     ↓
  ↓                         ↓                    4.3 repo impl          ↓                    7.3 tools schema
1.3 wire route            3.3 hooks + mocks        ↓                 5.3 API update           ↓
  ↓                         ↓                    4.4 API                ↓                    7.4 API route
1.4 system prompt         3.4 PacksSection         ↓                 5.4 hook + mocks         ↓
                                                 4.5 hook + mocks       ↓                    7.5 hook + mocks
WS2 (Docs)                                        ↓                 5.5 wire gate UI         ↓
──────────                                       4.6 BuilderSection     ↓                    7.6 OptimizeButton
2.1 update                                                           WS6 (Race)
(after WS1)                                                          ──────────
                                                                     6.1 executor tests
                                                                       ↓
                                                                     6.2 executor impl
                                                                       ↓
                                                                     6.3 API
                                                                       ↓
                                                                     6.4 hooks + mocks
                                                                       ↓
                                                                     6.5 RaceView
```

**Parallelism:** WS1, WS3, WS4, WS5, WS7 can all start in parallel. WS2 waits for WS1. WS6 waits for WS5. Within each WS, tasks are sequential.

**Mock coordination risk:** WS3 (Task 3.3), WS4 (Task 4.5), WS5 (Task 5.4), WS6 (Task 6.4), and WS7 (Task 7.5) all add hooks to `lib/ui/api.ts` and update test mocks. To avoid merge conflicts, assign one agent to own `lib/ui/api.ts` updates. Other agents produce hook code; the owning agent integrates them.

---

## Critical Files

| File | Workstream | Change |
|------|-----------|--------|
| `lib/chat/chat-tools.ts` | WS1 | New — tool schema + parser |
| `app/api/chat/route.ts` | WS1 | Wire tool_use with streaming fallback |
| `lib/chat/system-prompt.ts` | WS1 | Update output format docs |
| `docs/product/current-state.md` | WS2 | Accuracy update |
| `app/api/packs/route.ts` | WS3 | Rewrite to file-backed state |
| `lib/ui/api.ts` | WS3+WS4+WS5+WS6+WS7 | Add 11 new hooks |
| `components/workbench/sections/PacksSection.tsx` | WS3 | New — pack cards UI |
| `lib/builders/types.ts` | WS4 | New — builder types |
| `lib/builders/repository.ts` | WS4 | New — builder state + derivation |
| `app/api/builder-profile/route.ts` | WS4 | New — builder profile API |
| `components/workbench/sections/BuilderSection.tsx` | WS4 | New — builder UI |
| `lib/thread-runner/eligibility.ts` | WS5 | New — data-driven eligibility |
| `app/api/thread-runner/eligibility/route.ts` | WS5 | Wire to data-driven check |
| `components/thread-runner/ThreadRunnerGate.tsx` | WS5 | Wire to API data |
| `lib/thread-runner/race-executor.ts` | WS6 | New — file-backed race operations |
| `app/api/thread-runner/race/route.ts` | WS6 | New — race API |
| `components/thread-runner/RaceView.tsx` | WS6 | New — race UI |
| `lib/autoresearch/types.ts` | WS7 | New — optimization types |
| `lib/autoresearch/build-optimization-prompt.ts` | WS7 | New — optimization prompt builder |
| `lib/autoresearch/optimization-tools.ts` | WS7 | New — tool schema + parser |
| `app/api/optimize/route.ts` | WS7 | New — optimization API endpoint |
| `components/autoresearch/OptimizeButton.tsx` | WS7 | New — optimize workflow UI |

## Existing Code to Reuse

| What | Where | Used By |
|------|-------|---------|
| `extractActions()` | `lib/chat/extract-actions.ts` | WS1+WS7 — fallback parser |
| `ActionValidator.dryRun()` | `lib/chat/validator.ts` | WS1+WS7 — diff computation |
| `buildSystemPrompt()` | `lib/chat/system-prompt.ts` | WS7 — command reference |
| `createConfiguredProvider()` | `lib/llm/providers/index.ts` | WS7 — LLM access |
| `readSequence()` | `lib/sequence/yaml-io.ts` | WS7 — sequence state |
| `readPackState()/updatePackState()` | `lib/packs/repository.ts` | WS3 — file persistence |
| `readAgentState()` | `lib/agents/repository.ts` | WS4+WS5 — agent lookup |
| `aggregateAgentStats()` | `lib/agents/stats.ts` | WS4 — builder stats |
| `PACK_STATUS_PRIORITY` | `lib/packs/types.ts` | WS3+WS4 — pack sorting |
| `readThreadRunnerState()/updateThreadRunnerState()` | `lib/thread-runner/repository.ts` | WS6 — race persistence |
| `getBasePath()` | `lib/config.ts` | All — consistent config |
| `writeFileAtomic()` | `lib/fs/atomic.ts` | WS4 — safe file writes |
| `postJson()/fetchJson()` | `lib/ui/api.ts` | All — API helpers |
| `invalidateRuntimeQueries()` | `lib/ui/api.ts:37-43` | WS6 — query refresh |

---

## Verification

### Per-task
- `bun test <module>.test.ts` after each test+impl pair
- `bun run check` after each commit

### End-to-end
1. **Chat tool_use**: Send "add a research step" → model returns `tool_calls` → action card + YAML diff appear → Apply works
2. **Chat fallback**: With a model that doesn't support tools → streaming text + regex extraction still works
3. **Packs**: Visit API `/api/packs` → see persisted packs → create new pack → survives server restart
4. **Builder**: Query `/api/builder-profile?builderId=X` → see aggregated stats
5. **Eligibility**: Register an agent → eligibility API shows `verified-identity: met` → gate UI updates
6. **Race flow**: Enroll race via API → record runs → results show sorted placements
7. **Optimize Workflow**: Click "Optimize Workflow" → LLM analyzes sequence → suggestions appear with confidence/impact → actions validated via dryRun

### Full suite
```bash
bun run check   # lint + typecheck + tests
bun dev         # manual browser verification
```
