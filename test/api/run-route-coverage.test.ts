import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

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

  test('POST with stepId blocked by unresolved dependency gate returns failure before dispatch', async () => {
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
    expect(data.status).toBe('READY')
    expect(data.gateReasons).toContain('DEP_MISSING')
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
})
