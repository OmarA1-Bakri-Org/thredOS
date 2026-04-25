import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { runStep as executeProcess } from '@/lib/runner/wrapper'
import { appendApproval, readApprovals } from '@/lib/approvals/repository'
import { readSequence } from '@/lib/sequence/parser'
import { readTraceEvents } from '@/lib/traces/reader'

let basePath = ''

async function setupTestSequence(seq: object) {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify(seq))
}

async function writePrompt(stepId: string, content = `# ${stepId}`) {
  await writeFile(join(basePath, '.threados', 'prompts', `${stepId}.md`), content)
}

function confirmedBody(payload: Record<string, unknown>) {
  return JSON.stringify({ ...payload, confirmPolicy: true })
}

function createMockRuntime() {
  return {
    dispatch: async (_model: string, opts: {
      stepId: string
      runId: string
      cwd: string
      timeout: number
      runtimeEventLogPath?: string
      runtimeEventEmitterCommand?: string
    }) => ({
      stepId: opts.stepId,
      runId: opts.runId,
      command: 'mock-agent',
      args: [],
      cwd: opts.cwd,
      timeout: opts.timeout,
      env: {
        THREADOS_EVENT_LOG: opts.runtimeEventLogPath ?? '',
        THREADOS_EVENT_EMITTER: opts.runtimeEventEmitterCommand ?? '',
      },
    }),
    runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
      stepId,
      runId,
      exitCode: 0,
      status: 'SUCCESS' as const,
      duration: 10,
      stdout: 'ok',
      stderr: '',
      startTime: new Date('2026-03-10T10:00:00.000Z'),
      endTime: new Date('2026-03-10T10:00:10.000Z'),
    }),
    saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
  }
}

describe.serial('run route coverage — groupId mode', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-run-group-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('POST with groupId runs all runnable steps in the group', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'group-seq',
      steps: [
        { id: 'g-step-a', name: 'GA', type: 'base', model: 'codex', prompt_file: '.threados/prompts/g-step-a.md', depends_on: [], status: 'READY', group_id: 'grp-1' },
        { id: 'g-step-b', name: 'GB', type: 'base', model: 'codex', prompt_file: '.threados/prompts/g-step-b.md', depends_on: [], status: 'READY', group_id: 'grp-1' },
        { id: 'g-step-c', name: 'GC', type: 'base', model: 'codex', prompt_file: '.threados/prompts/g-step-c.md', depends_on: [], status: 'READY', group_id: 'grp-2' },
      ],
      gates: [],
    })
    await writePrompt('g-step-a')
    await writePrompt('g-step-b')
    await writePrompt('g-step-c')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ groupId: 'grp-1' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed).toHaveLength(2)
    expect(data.executed.every((r: { success: boolean }) => r.success)).toBe(true)
  })

  test('POST with groupId that matches no steps returns empty executed array', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'group-seq',
      steps: [
        { id: 'step-x', name: 'SX', type: 'base', model: 'codex', prompt_file: '.threados/prompts/step-x.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('step-x')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ groupId: 'nonexistent-group' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed).toHaveLength(0)
  })

  test('POST with groupId skips steps with unmet dependencies', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'group-dep-seq',
      steps: [
        { id: 'dep-step', name: 'Dep', type: 'base', model: 'codex', prompt_file: '.threados/prompts/dep-step.md', depends_on: [], status: 'READY', group_id: 'grp-dep' },
        { id: 'blocked-step', name: 'Blocked', type: 'base', model: 'codex', prompt_file: '.threados/prompts/blocked-step.md', depends_on: ['dep-step'], status: 'READY', group_id: 'grp-dep' },
      ],
      gates: [],
    })
    await writePrompt('dep-step')
    await writePrompt('blocked-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ groupId: 'grp-dep' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    // Only dep-step is runnable (blocked-step depends on dep-step which isn't DONE yet)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0].stepId).toBe('dep-step')
  })
})

describe.serial('run route coverage — runnable mode', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-run-runnable-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('POST with mode=runnable runs all runnable steps in topological order', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'runnable-seq',
      steps: [
        { id: 'r-a', name: 'RA', type: 'base', model: 'codex', prompt_file: '.threados/prompts/r-a.md', depends_on: [], status: 'READY' },
        { id: 'r-b', name: 'RB', type: 'base', model: 'codex', prompt_file: '.threados/prompts/r-b.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('r-a')
    await writePrompt('r-b')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed).toHaveLength(2)
  })

  test('POST with mode=runnable skips DONE and RUNNING steps', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'runnable-skip-seq',
      steps: [
        { id: 'done-step', name: 'Done', type: 'base', model: 'codex', prompt_file: '.threados/prompts/done-step.md', depends_on: [], status: 'DONE' },
        { id: 'running-step', name: 'Running', type: 'base', model: 'codex', prompt_file: '.threados/prompts/running-step.md', depends_on: [], status: 'RUNNING' },
        { id: 'ready-step', name: 'Ready', type: 'base', model: 'codex', prompt_file: '.threados/prompts/ready-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('done-step')
    await writePrompt('running-step')
    await writePrompt('ready-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0].stepId).toBe('ready-step')
  })

  test('POST with mode=runnable respects gate approval in dependency resolution', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'gate-runnable-seq',
      steps: [
        { id: 'pre-gate', name: 'Pre', type: 'base', model: 'codex', prompt_file: '.threados/prompts/pre-gate.md', depends_on: [], status: 'DONE' },
        { id: 'post-gate', name: 'Post', type: 'base', model: 'codex', prompt_file: '.threados/prompts/post-gate.md', depends_on: ['pre-gate', 'quality-gate'], status: 'READY' },
      ],
      gates: [
        { id: 'quality-gate', name: 'Quality Gate', depends_on: ['pre-gate'], status: 'APPROVED' },
      ],
    })
    await writePrompt('pre-gate')
    await writePrompt('post-gate')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    // post-gate depends on pre-gate (DONE) and quality-gate (APPROVED) — both satisfied
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0].stepId).toBe('post-gate')
    expect(data.executed[0].success).toBe(true)
  })

  test('POST with mode=runnable re-expands runnable frontier within the same invocation', async () => {
    const dispatchOrder: string[] = []
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchOrder.push(args[1].stepId)
        return createMockRuntime().dispatch(...args)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'runnable-chain-seq',
      steps: [
        { id: 'chain-a', name: 'Chain A', type: 'base', model: 'codex', prompt_file: '.threados/prompts/chain-a.md', depends_on: [], status: 'READY' },
        { id: 'chain-b', name: 'Chain B', type: 'base', model: 'codex', prompt_file: '.threados/prompts/chain-b.md', depends_on: ['chain-a'], status: 'READY' },
        { id: 'chain-c', name: 'Chain C', type: 'base', model: 'codex', prompt_file: '.threados/prompts/chain-c.md', depends_on: ['chain-b'], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('chain-a')
    await writePrompt('chain-b')
    await writePrompt('chain-c')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed.map((result: { stepId: string }) => result.stepId)).toEqual(['chain-a', 'chain-b', 'chain-c'])
    expect(dispatchOrder).toEqual(['chain-a', 'chain-b', 'chain-c'])

    const persisted = await readSequence(basePath)
    expect(persisted.steps.map(step => ({ id: step.id, status: step.status }))).toEqual([
      { id: 'chain-a', status: 'DONE' },
      { id: 'chain-b', status: 'DONE' },
      { id: 'chain-c', status: 'DONE' },
    ])
  })

  test('POST with mode=runnable blocks steps behind PENDING gates', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'pending-gate-seq',
      steps: [
        { id: 'gated-step', name: 'Gated', type: 'base', model: 'codex', prompt_file: '.threados/prompts/gated-step.md', depends_on: ['pending-gate'], status: 'READY' },
      ],
      gates: [
        { id: 'pending-gate', name: 'Pending Gate', depends_on: [], status: 'PENDING' },
      ],
    })
    await writePrompt('gated-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.executed).toHaveLength(0)
  })

  test('POST with mode=runnable marks downstream steps waiting when approval action blocks dispatch', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'approval-runnable-seq',
      steps: [
        {
          id: 'approval-step',
          name: 'Approval Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/approval-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{ id: 'native-approval', type: 'approval', description: 'Need approval first' }],
        },
        {
          id: 'dependent-step',
          name: 'Dependent Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/dependent-step.md',
          depends_on: ['approval-step'],
          status: 'READY',
        },
      ],
      gates: [],
    })
    await writePrompt('approval-step')
    await writePrompt('dependent-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'approval-step',
      success: false,
      status: 'BLOCKED',
    })
    expect(data.waiting).toEqual(['dependent-step'])
    expect(data.skipped).toEqual([])
    expect(dispatchCalls).toBe(0)

    const approvals = await readApprovals(basePath, data.executed[0].runId)
    const safeApprovalEntries = approvals.filter(approval => approval.target_ref === 'mode:runnable')
    expect(safeApprovalEntries.map(approval => approval.status)).toEqual(['pending', 'approved'])
    const nativeApprovalEntries = approvals.filter(approval => approval.target_ref === 'step:approval-step')
    expect(nativeApprovalEntries).toEqual([
      expect.objectContaining({
        action_type: 'run',
        target_ref: 'step:approval-step',
        requested_by: 'api:run',
        status: 'pending',
        approved_by: null,
        notes: 'Need approval first',
      }),
    ])
    expect(approvals.at(-1)).toMatchObject({
      action_type: 'run',
      target_ref: 'step:approval-step',
      requested_by: 'api:run',
      status: 'pending',
      approved_by: null,
    })

    const traces = await readTraceEvents(basePath, data.executed[0].runId)
    expect(traces.filter(trace => trace.event_type === 'approval-requested').map(trace => trace.surface_id)).toEqual([
      'mode:runnable',
      'step:approval-step',
    ])

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'approval-step')?.status).toBe('BLOCKED')
    expect(sequence.steps.find(step => step.id === 'dependent-step')?.status).toBe('READY')
  })

  test('POST with mode=runnable evaluates step conditions from runtime context and executes only the selected conditional branch', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(
      join(basePath, '.threados', 'state', 'runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved', 'apollo_discovery'] } }),
    )

    await setupTestSequence({
      version: '1.0',
      name: 'conditional-runnable-seq',
      steps: [
        {
          id: 'conditional-step',
          name: 'Conditional Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/conditional-step.md',
          depends_on: [],
          status: 'READY',
          condition: 'icp_config.sources.length == 2',
          actions: [{
            id: 'conditional-approval',
            type: 'conditional',
            config: {
              condition: "icp_config.sources contains 'apollo_discovery'",
              if_true: [{ id: 'native-approval', type: 'approval', description: 'Conditional approval triggered' }],
              if_false: [{ id: 'unexpected-approval', type: 'approval', description: 'Wrong branch' }],
            },
          }],
        },
        {
          id: 'skipped-by-condition',
          name: 'Skipped By Condition',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/skipped-by-condition.md',
          depends_on: [],
          status: 'READY',
          condition: 'icp_config.sources.length == 3',
        },
      ],
      gates: [],
    })
    await writePrompt('conditional-step')
    await writePrompt('skipped-by-condition')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'conditional-step',
      success: false,
      status: 'BLOCKED',
    })
    expect(dispatchCalls).toBe(0)

    const approvals = await readApprovals(basePath, data.executed[0].runId)
    const nativeApprovalEntries = approvals.filter(approval => approval.target_ref === 'step:conditional-step')
    expect(nativeApprovalEntries).toEqual([
      expect.objectContaining({
        target_ref: 'step:conditional-step',
        requested_by: 'api:run',
        status: 'pending',
        notes: 'Conditional approval triggered',
      }),
    ])
    expect(approvals.some(approval => approval.notes === 'Wrong branch')).toBe(false)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'conditional-step')?.status).toBe('BLOCKED')
    expect(sequence.steps.find(step => step.id === 'skipped-by-condition')?.status).toBe('SKIPPED')
  })

  test('POST with mode=runnable rejects invalid condition-driving runtime value types', async () => {
    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(
      join(basePath, '.threados', 'state', 'runtime-context.json'),
      JSON.stringify({ icp_config: { sources: 'apollo_saved,apollo_discovery' } }),
    )

    await setupTestSequence({
      version: '1.0',
      name: 'invalid-runtime-value-seq',
      steps: [
        {
          id: 'conditional-step',
          name: 'Conditional Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/conditional-step.md',
          depends_on: [],
          status: 'READY',
          condition: 'icp_config.sources.length == 2',
        },
      ],
      gates: [],
    })
    await writePrompt('conditional-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({
      code: 'INTERNAL_ERROR',
      error: "Runtime context value 'icp_config.sources' must be an array of strings",
    })
  })

  test('POST with mode=runnable marks false-condition optional steps SKIPPED and continues downstream mandatory work', async () => {
    const dispatchOrder: string[] = []
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => {
        dispatchOrder.push(stepId)
        return {
          stepId,
          runId,
          exitCode: 0,
          status: 'SUCCESS' as const,
          duration: 10,
          stdout: 'ok',
          stderr: '',
          startTime: new Date('2026-03-10T10:00:00.000Z'),
          endTime: new Date('2026-03-10T10:00:10.000Z'),
        }
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'optional-skip-unblocks-downstream',
      steps: [
        { id: 'optional-branch', name: 'Optional Branch', type: 'base', model: 'codex', prompt_file: '.threados/prompts/optional-branch.md', depends_on: [], status: 'READY', condition: "icp_config.sources contains 'apollo_discovery'" },
        { id: 'mandatory-downstream', name: 'Mandatory Downstream', type: 'base', model: 'codex', prompt_file: '.threados/prompts/mandatory-downstream.md', depends_on: ['optional-branch'], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('optional-branch')
    await writePrompt('mandatory-downstream')
    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'state', 'runtime-context.json'), JSON.stringify({ icp_config: { sources: ['apollo_saved'] } }))

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({ stepId: 'mandatory-downstream', success: true, status: 'DONE' })
    expect(data.skipped).toEqual(['optional-branch'])
    expect(data.waiting).toEqual([])
    expect(dispatchOrder).toEqual(['mandatory-downstream'])

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'optional-branch')?.status).toBe('SKIPPED')
    expect(sequence.steps.find(step => step.id === 'mandatory-downstream')?.status).toBe('DONE')
  })

  test('POST with mode=runnable evaluates first_run as true for native conditional actions on the first execution', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'first-run-conditional-runnable-seq',
      steps: [
        {
          id: 'first-run-conditional-step',
          name: 'First Run Conditional Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/first-run-conditional-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{
            id: 'first-run-gate',
            type: 'conditional',
            config: {
              condition: 'first_run == true',
              if_true: [{ id: 'native-approval', type: 'approval', description: 'Conditional first run approval triggered' }],
              if_false: [{ id: 'unexpected-approval', type: 'approval', description: 'Wrong first run branch' }],
            },
          }],
        },
      ],
      gates: [],
    })
    await writePrompt('first-run-conditional-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'first-run-conditional-step',
      success: false,
      status: 'BLOCKED',
    })
    expect(dispatchCalls).toBe(0)

    const approvals = await readApprovals(basePath, data.executed[0].runId)
    const nativeApprovalEntries = approvals.filter(approval => approval.target_ref === 'step:first-run-conditional-step')
    expect(nativeApprovalEntries).toEqual([
      expect.objectContaining({
        target_ref: 'step:first-run-conditional-step',
        requested_by: 'api:run',
        status: 'pending',
        notes: 'Conditional first run approval triggered',
      }),
    ])
    expect(approvals.some(approval => approval.notes === 'Wrong first run branch')).toBe(false)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'first-run-conditional-step')?.status).toBe('BLOCKED')
  })

  test('POST with mode=runnable fails fast when composio auth is not configured for a composio step', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'composio-auth-runnable-seq',
      steps: [
        {
          id: 'composio-auth-step',
          name: 'Composio Auth Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/composio-auth-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS', arguments: { team: 'growth' } },
            output_key: 'apollo_usage',
          }],
        },
      ],
      gates: [],
    })
    await writePrompt('composio-auth-step')

    const isolatedHome = await mkdtemp(join(tmpdir(), 'threados-route-composio-auth-'))
    const originalHome = process.env.HOME
    process.env.HOME = isolatedHome

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    await rm(isolatedHome, { recursive: true, force: true })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'composio-auth-step',
      success: false,
      status: 'FAILED',
    })
    expect(data.executed[0].error).toContain('Composio auth is not configured')

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'composio-auth-step')?.status).toBe('FAILED')
  })

  test('POST with mode=runnable executes nested composio_tool actions inside native conditional branches and persists output_key', async () => {
    const composioCalls: Array<{ toolSlug: string; arguments: Record<string, unknown> }> = []
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runComposioTool: async ({ toolSlug, arguments: args }: { toolSlug: string; arguments: Record<string, unknown> }) => {
        composioCalls.push({ toolSlug, arguments: args })
        return { team: args.team, branch: 'selected' }
      },
    } as any

    await setupTestSequence({
      version: '1.0',
      name: 'conditional-native-composio-runnable-seq',
      steps: [
        {
          id: 'conditional-composio-step',
          name: 'Conditional Composio Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/conditional-composio-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{
            id: 'choose-branch',
            type: 'conditional',
            config: {
              condition: 'first_run == true',
              if_true: [{
                id: 'selected-source',
                type: 'composio_tool',
                config: {
                  tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
                  arguments: { team: 'growth' },
                },
                output_key: 'selected_branch',
              }],
              if_false: [{
                id: 'fallback-source',
                type: 'composio_tool',
                config: {
                  tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
                  arguments: { team: 'fallback' },
                },
                output_key: 'unselected_branch',
              }],
            },
          }],
        },
      ],
      gates: [],
    })
    await writePrompt('conditional-composio-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'conditional-composio-step',
      success: true,
      status: 'DONE',
    })
    expect(composioCalls).toEqual([{ toolSlug: 'APOLLO_VIEW_API_USAGE_STATS', arguments: { team: 'growth' } }])

    const runtimeContext = JSON.parse(await Bun.file(join(basePath, '.threados/state/runtime-context.json')).text())
    expect(runtimeContext.selected_branch).toEqual({ team: 'growth', branch: 'selected' })
    expect(runtimeContext.unselected_branch).toBeUndefined()
  })

  test('POST with mode=runnable aborts the workflow when a composio action fails with abort_workflow', async () => {
    const executedStepIds: string[] = []
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => {
        executedStepIds.push(stepId)
        return {
          stepId,
          runId,
          exitCode: 0,
          status: 'SUCCESS' as const,
          duration: 10,
          stdout: 'ok',
          stderr: '',
          startTime: new Date('2026-03-10T10:00:00.000Z'),
          endTime: new Date('2026-03-10T10:00:10.000Z'),
        }
      },
      runComposioTool: async () => {
        throw new Error('apollo unavailable')
      },
    } as any

    await setupTestSequence({
      version: '1.0',
      name: 'api-abort-workflow-composio-seq',
      steps: [
        {
          id: 'composio-step',
          name: 'Composio Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/composio-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{
            id: 'apollo-usage',
            type: 'composio_tool',
            config: { tool_slug: 'APOLLO_VIEW_API_USAGE_STATS' },
            on_failure: 'abort_workflow',
          }],
        },
        {
          id: 'later-step',
          name: 'Later Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/later-step.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    })
    await writePrompt('composio-step')
    await writePrompt('later-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ mode: 'runnable' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'composio-step',
      success: false,
      status: 'FAILED',
      error: "Composio action 'apollo-usage' failed: apollo unavailable",
    })
    expect(executedStepIds).toEqual([])

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'composio-step')?.status).toBe('FAILED')
    expect(sequence.steps.find(step => step.id === 'later-step')?.status).toBe('READY')
  })
})

describe.serial('run route coverage — error handling', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-run-errors-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('POST with invalid body returns 400', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'err-seq',
      steps: [],
      gates: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'payload' }),
    }))

    expect(res.status).toBe(400)
  })

  test('POST with stepId referencing nonexistent step returns 404', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'missing-seq',
      steps: [
        { id: 'step-exists', name: 'Exists', type: 'base', model: 'codex', prompt_file: '.threados/prompts/step-exists.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('step-exists')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'nonexistent-step' }),
    }))

    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('not found')
  })

  test('POST with stepId blocked by unresolved dependency gate returns BLOCKED and persists blocked status', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'blocked-by-gate-seq',
      steps: [
        { id: 'gated-step', name: 'Blocked', type: 'base', model: 'codex', prompt_file: '.threados/prompts/gated-step.md', depends_on: ['quality-gate'], status: 'READY' },
      ],
      gates: [
        { id: 'quality-gate', name: 'Quality Gate', depends_on: [], status: 'PENDING' },
      ],
    })
    await writePrompt('gated-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'gated-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('BLOCKED')
    expect(data.gateReasons).toContain('DEP_MISSING')

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'gated-step')?.status).toBe('BLOCKED')
  })

  test('POST with stepId returns SKIPPED when the targeted step condition resolves false', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(
      join(basePath, '.threados', 'state', 'runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved', 'apollo_discovery'] } }),
    )

    await setupTestSequence({
      version: '1.0',
      name: 'step-condition-false-seq',
      steps: [
        {
          id: 'step-skipped-by-condition',
          name: 'Step Skipped By Condition',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/step-skipped-by-condition.md',
          depends_on: [],
          status: 'READY',
          condition: 'icp_config.sources.length == 3',
        },
      ],
      gates: [],
    })
    await writePrompt('step-skipped-by-condition')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'step-skipped-by-condition' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject({
      success: false,
      stepId: 'step-skipped-by-condition',
      status: 'SKIPPED',
    })
    expect(data.error).toContain('condition evaluated false')
    expect(dispatchCalls).toBe(0)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'step-skipped-by-condition')?.status).toBe('SKIPPED')
  })

  test('POST with stepId does not let approved approval evidence override unresolved dependency blockers', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'approved-does-not-bypass-deps-seq',
      steps: [
        {
          id: 'approved-but-still-blocked-step',
          name: 'Approved But Still Blocked Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/approved-but-still-blocked-step.md',
          depends_on: ['quality-gate'],
          status: 'BLOCKED',
          actions: [{ id: 'native-approval', type: 'approval', description: 'Approval already granted' }],
        },
      ],
      gates: [
        { id: 'quality-gate', name: 'Quality Gate', depends_on: [], status: 'PENDING' },
      ],
    })
    await writePrompt('approved-but-still-blocked-step')

    await appendApproval(basePath, 'prior-approval-run', {
      id: 'apr-approved-but-still-blocked-step',
      action_type: 'run',
      target_ref: 'step:approved-but-still-blocked-step',
      requested_by: 'tester',
      status: 'approved',
      approved_by: 'tester',
      approved_at: '2026-04-22T10:00:00.000Z',
      notes: 'Approved earlier',
    })

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'approved-but-still-blocked-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('BLOCKED')
    expect(data.gateReasons).toContain('DEP_MISSING')
    expect(dispatchCalls).toBe(0)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'approved-but-still-blocked-step')?.status).toBe('BLOCKED')
  })

  test('POST with stepId for step without prompt file returns failure', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'no-prompt-seq',
      steps: [
        { id: 'no-prompt', name: 'No Prompt', type: 'base', model: 'codex', prompt_file: '.threados/prompts/no-prompt.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    // Deliberately NOT writing the prompt file

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'no-prompt' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('FAILED')
    expect(data.error).toContain('Prompt file not found')
  })

  test('POST with stepId respects custom prompt_file paths and action-contract assembly', async () => {
    const dispatchedPrompts: string[] = []
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (_model, opts) => {
        dispatchedPrompts.push(opts.compiledPrompt)
        return createMockRuntime().dispatch(_model, opts)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'custom-prompt-path-seq',
      steps: [
        {
          id: 'custom-prompt-step',
          name: 'Custom Prompt Step',
          type: 'base',
          model: 'shell',
          prompt_file: '.threados/custom-prompts/api/custom-prompt-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{
            id: 'document-contract',
            type: 'conditional',
            config: {
              condition: '1 == 2',
              if_true: [],
              if_false: [],
            },
          }],
        },
      ],
      gates: [],
    })
    await mkdir(join(basePath, '.threados', 'custom-prompts', 'api'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'custom-prompts', 'api', 'custom-prompt-step.md'), 'echo api custom prompt\n')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'custom-prompt-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(dispatchedPrompts).toHaveLength(1)
    expect(dispatchedPrompts[0]).toContain('echo api custom prompt')
    expect(dispatchedPrompts[0]).toContain('## THREADOS ACTION CONTRACT')
  })

  test('POST with stepId where runtime throws returns failure', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'throw-seq',
      steps: [
        { id: 'throw-step', name: 'Throw', type: 'base', model: 'codex', prompt_file: '.threados/prompts/throw-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('throw-step')

    // Override runStep to throw
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async () => { throw new Error('Agent crashed') },
    }

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'throw-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('FAILED')
    expect(data.error).toContain('Agent crashed')
  })

  test('POST with stepId that has exit code 42 returns NEEDS_REVIEW', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'review-seq',
      steps: [
        { id: 'review-step', name: 'Review', type: 'base', model: 'codex', prompt_file: '.threados/prompts/review-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('review-step')

    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 42,
        status: 'FAILED' as const,
        duration: 5,
        stdout: 'needs review',
        stderr: '',
        startTime: new Date('2026-03-10T10:00:00.000Z'),
        endTime: new Date('2026-03-10T10:00:05.000Z'),
      }),
    }

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'review-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('NEEDS_REVIEW')
  })

  test('POST with stepId downgrades zero-exit blocked payloads to NEEDS_REVIEW', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'blocked-output-seq',
      steps: [
        { id: 'blocked-output-step', name: 'Blocked Output', type: 'base', model: 'codex', prompt_file: '.threados/prompts/blocked-output-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('blocked-output-step')

    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 0,
        status: 'SUCCESS' as const,
        duration: 4,
        stdout: 'I cannot complete this because the required tool is unavailable in this environment.',
        stderr: '',
        startTime: new Date('2026-03-10T10:00:00.000Z'),
        endTime: new Date('2026-03-10T10:00:04.000Z'),
      }),
    }

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'blocked-output-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('NEEDS_REVIEW')

    const persisted = await readSequence(basePath)
    expect(persisted.steps.find(step => step.id === 'blocked-output-step')?.status).toBe('NEEDS_REVIEW')
  })

  test('POST with stepId downgrades zero-exit permission denied payloads to NEEDS_REVIEW', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'permission-denied-output-seq',
      steps: [
        { id: 'permission-denied-step', name: 'Permission Denied Output', type: 'base', model: 'codex', prompt_file: '.threados/prompts/permission-denied-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('permission-denied-step')

    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 0,
        status: 'SUCCESS' as const,
        duration: 4,
        stdout: 'Permission denied: cannot access the requested admin tool from this environment.',
        stderr: '',
        startTime: new Date('2026-03-10T10:00:00.000Z'),
        endTime: new Date('2026-03-10T10:00:04.000Z'),
      }),
    }

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'permission-denied-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('NEEDS_REVIEW')

    const persisted = await readSequence(basePath)
    expect(persisted.steps.find(step => step.id === 'permission-denied-step')?.status).toBe('NEEDS_REVIEW')
  })

  test('POST with stepId that has nonzero exit code returns FAILED', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'fail-seq',
      steps: [
        { id: 'fail-step', name: 'Fail', type: 'base', model: 'codex', prompt_file: '.threados/prompts/fail-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('fail-step')

    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 1,
        status: 'FAILED' as const,
        duration: 3,
        stdout: '',
        stderr: 'error output',
        startTime: new Date('2026-03-10T10:00:00.000Z'),
        endTime: new Date('2026-03-10T10:00:03.000Z'),
      }),
    }

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'fail-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('FAILED')
  })

  test('POST with stepId blocks native approval actions before dispatch and records pending approval', async () => {
    let dispatchCalls = 0
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      dispatch: async (...args) => {
        dispatchCalls += 1
        return createMockRuntime().dispatch(...args)
      },
    }

    await setupTestSequence({
      version: '1.0',
      name: 'native-approval-step-seq',
      steps: [
        {
          id: 'native-approval-step',
          name: 'Native Approval Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/native-approval-step.md',
          depends_on: [],
          status: 'READY',
          actions: [{ id: 'approval-gate', type: 'approval', description: 'Approve me' }],
        },
      ],
      gates: [],
    })
    await writePrompt('native-approval-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'native-approval-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('BLOCKED')
    expect(data.error).toContain('Awaiting approval')
    expect(dispatchCalls).toBe(0)

    const approvals = await readApprovals(basePath, data.runId)
    expect(approvals.filter(approval => approval.status === 'pending')).toHaveLength(2)
    expect(approvals.at(-1)).toMatchObject({
      action_type: 'run',
      target_ref: 'step:native-approval-step',
      requested_by: 'api:run',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      notes: 'Approve me',
    })

    const traces = await readTraceEvents(basePath, data.runId)
    expect(traces.some(trace => trace.event_type === 'approval-requested')).toBe(true)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.find(step => step.id === 'native-approval-step')?.status).toBe('BLOCKED')
  })

  test('POST with groupId marks downstream group steps waiting when approval action blocks dispatch', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'approval-group-seq',
      steps: [
        {
          id: 'group-approval-step',
          name: 'Group Approval Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/group-approval-step.md',
          depends_on: [],
          status: 'READY',
          group_id: 'grp-approval',
          actions: [{ id: 'group-approval', type: 'approval', description: 'Group approval needed' }],
        },
        {
          id: 'group-dependent-step',
          name: 'Group Dependent Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/group-dependent-step.md',
          depends_on: ['group-approval-step'],
          status: 'READY',
          group_id: 'grp-approval',
        },
      ],
      gates: [],
    })
    await writePrompt('group-approval-step')
    await writePrompt('group-dependent-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ groupId: 'grp-approval' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.executed).toHaveLength(1)
    expect(data.executed[0]).toMatchObject({
      stepId: 'group-approval-step',
      status: 'BLOCKED',
    })
    expect(data.waiting).toEqual(['group-dependent-step'])
    expect(data.skipped).toEqual([])
  })

  test('POST with shell model step skips prompt compilation', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'shell-seq',
      steps: [
        { id: 'shell-step', name: 'Shell', type: 'base', model: 'shell', prompt_file: '.threados/prompts/shell-step.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('shell-step', 'echo hello')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'shell-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  test('POST with stepId executes native actions end-to-end, including write_file, sub_agent, and rube_tool alias paths', async () => {
    const artifactDir = join(basePath, 'api-artifacts')
    const icpConfigPath = join(artifactDir, 'icp-config.json')
    const qualifiedSegmentPath = join(artifactDir, 'qualified-segment.json')
    const composioCalls: Array<{ toolSlug: string; arguments: Record<string, unknown> }> = []

    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      dispatch: async (_model, opts) => {
        if (opts.stepId.endsWith('spawn-artifact-agent')) {
          const script = `const fs=require('fs');fs.mkdirSync(${JSON.stringify(artifactDir)},{recursive:true});fs.writeFileSync(${JSON.stringify(qualifiedSegmentPath)}, JSON.stringify({segment_name:'API Segment',total_qualified:2}, null, 2));`
          return {
            stepId: opts.stepId,
            runId: opts.runId,
            command: process.execPath,
            args: ['-e', script],
            cwd: opts.cwd,
            timeout: opts.timeout,
            env: {},
          }
        }

        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: opts.cwd,
          timeout: opts.timeout,
          env: {},
        }
      },
      runStep: executeProcess,
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
      runComposioTool: async input => {
        composioCalls.push({ toolSlug: input.toolSlug, arguments: input.arguments })
        return { ok: true, tool: input.toolSlug }
      },
    }

    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(
      join(basePath, '.threados', 'state', 'runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved'], output: { apollo_stage_name: 'API Review' } } }),
    )

    await setupTestSequence({
      version: '1.0',
      name: 'native-action-api-seq',
      steps: [
        {
          id: 'native-api-step',
          name: 'Native API Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/native-api-step.md',
          depends_on: [],
          status: 'READY',
          actions: [
            { id: 'cli-action', type: 'cli', config: { command: "printf 'api-cli'" }, output_key: 'cli_result' },
            { id: 'write-icp', type: 'write_file', config: { file_path: icpConfigPath }, output_key: 'icp_config_file' },
            { id: 'spawn-artifact-agent', type: 'sub_agent', config: { prompt: 'Write the qualified segment artifact JSON.', subagent_type: 'general-purpose' }, output_key: 'sub_agent_result' },
            { id: 'apollo-alias', type: 'rube_tool', config: { tool_slug: 'APOLLO_TEST_TOOL', arguments: { query: 'segment' } }, output_key: 'apollo_tool_result' },
          ],
        },
      ],
      gates: [],
    })
    await writePrompt('native-api-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'native-api-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.status).toBe('DONE')

    const runtimeContext = JSON.parse(await readFile(join(basePath, '.threados', 'state', 'runtime-context.json'), 'utf-8'))
    expect(runtimeContext.cli_result).toMatchObject({ stdout: 'api-cli', exitCode: 0, status: 'success' })
    expect(runtimeContext.icp_config_file).toMatchObject({ path: icpConfigPath, status: 'written', sourceKey: 'icp_config' })
    expect(runtimeContext.sub_agent_result).toMatchObject({ status: 'success', exitCode: 0, subagentType: 'general-purpose' })
    expect(runtimeContext.apollo_tool_result).toEqual({ ok: true, tool: 'APOLLO_TEST_TOOL' })

    expect(JSON.parse(await readFile(icpConfigPath, 'utf-8'))).toEqual({ sources: ['apollo_saved'], output: { apollo_stage_name: 'API Review' } })
    expect(JSON.parse(await readFile(qualifiedSegmentPath, 'utf-8'))).toEqual({ segment_name: 'API Segment', total_qualified: 2 })
    expect(composioCalls).toEqual([{ toolSlug: 'APOLLO_TEST_TOOL', arguments: { query: 'segment' } }])
  })

  test('POST with stepId downgrades contract-bound composio steps when the expected persisted output is missing', async () => {
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      ...createMockRuntime(),
      runComposioTool: async () => null,
    }

    await setupTestSequence({
      version: '1.0',
      name: 'missing-native-evidence-seq',
      steps: [
        {
          id: 'missing-native-evidence-step',
          name: 'Missing Native Evidence Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/missing-native-evidence-step.md',
          depends_on: [],
          status: 'READY',
          output_contract_ref: 'contracts/apollo-usage.json',
          completion_contract: 'contracts/apollo-usage-complete.json',
          actions: [
            {
              id: 'apollo-usage',
              type: 'composio_tool',
              config: {
                tool_slug: 'APOLLO_VIEW_API_USAGE_STATS',
                arguments: { team: 'growth' },
              },
              output_key: 'apollo_usage',
            },
          ],
        },
      ],
      gates: [],
    })
    await writePrompt('missing-native-evidence-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'missing-native-evidence-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('NEEDS_REVIEW')

    const persisted = await readSequence(basePath)
    expect(persisted.steps.find(step => step.id === 'missing-native-evidence-step')?.status).toBe('NEEDS_REVIEW')
  })

  test('POST with stepId rejects native action outputs that target protected runtime approval keys', async () => {
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()

    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(
      join(basePath, '.threados', 'state', 'runtime-context.json'),
      JSON.stringify({ icp_config: { sources: ['apollo_saved'] } }),
    )

    await setupTestSequence({
      version: '1.0',
      name: 'protected-runtime-api-seq',
      steps: [
        {
          id: 'protected-runtime-api-step',
          name: 'Protected Runtime API Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/protected-runtime-api-step.md',
          depends_on: [],
          status: 'READY',
          actions: [
            { id: 'overwrite-approval-input', type: 'cli', config: { command: "printf 'api-oops'" }, output_key: 'icp_config.sources' },
          ],
        },
      ],
      gates: [],
    })
    await writePrompt('protected-runtime-api-step')

    const { POST } = await import('@/app/api/run/route')
    const res = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: confirmedBody({ stepId: 'protected-runtime-api-step' }),
    }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.status).toBe('FAILED')
    expect(data.error).toContain("Protected runtime key root 'icp_config' cannot be written by native_action_output")

    const runtimeContext = JSON.parse(await readFile(join(basePath, '.threados/state/runtime-context.json'), 'utf-8'))
    expect(runtimeContext.icp_config).toEqual({ sources: ['apollo_saved'] })

    const persisted = await readSequence(basePath)
    expect(persisted.steps.find(step => step.id === 'protected-runtime-api-step')?.status).toBe('FAILED')
  })
})
