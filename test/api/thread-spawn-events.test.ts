import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import YAML from 'yaml'
import type { ThreadSurfaceState } from '@/lib/thread-surfaces/repository'

let basePath = ''
let runtimeEventLinesByStep: Record<string, string[]> = {}

async function setupSequence(sequence: object) {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify(sequence))
}

async function writePrompt(stepId: string) {
  await writeFile(join(basePath, '.threados', 'prompts', `${stepId}.md`), `# ${stepId}`)
}

async function writeThreadSurfaceState(state: ThreadSurfaceState) {
  await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'state', 'thread-surfaces.json'), JSON.stringify(state, null, 2))
}

async function readThreadSurfaceState(): Promise<ThreadSurfaceState> {
  const content = await readFile(join(basePath, '.threados', 'state', 'thread-surfaces.json'), 'utf-8')
  return JSON.parse(content) as ThreadSurfaceState
}

describe.serial('thread spawn event persistence', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-spawn-events-'))
    runtimeEventLinesByStep = {}
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      dispatch: async (_model: string, opts: { stepId: string; runId: string; cwd: string; timeout: number; runtimeEventLogPath?: string; runtimeEventEmitterCommand?: string }) => ({
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
      runStep: async ({
        stepId,
        runId,
        env,
      }: {
        stepId: string
        runId: string
        env?: Record<string, string>
      }) => {
        const eventLogPath = env?.THREADOS_EVENT_LOG
        const lines = runtimeEventLinesByStep[stepId] ?? []
        if (eventLogPath && lines.length > 0) {
          await mkdir(dirname(eventLogPath), { recursive: true })
          await writeFile(eventLogPath, `${lines.join('\n')}\n`, 'utf-8')
        }

        return {
          stepId,
          runId,
          exitCode: 0,
          status: 'SUCCESS',
          duration: 15,
          stdout: `ok:${stepId}`,
          stderr: '',
          startTime: new Date('2026-03-09T12:00:00.000Z'),
          endTime: new Date('2026-03-09T12:00:15.000Z'),
        }
      },
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
    }
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('orchestrator metadata alone does not create delegated child surfaces without runtime events', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Orchestrated Sequence',
      steps: [
        {
          id: 'orch-orchestrator',
          name: 'Main Orchestrator',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-orchestrator.md',
          depends_on: [],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'orch-worker-1',
          name: 'Worker 1',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-worker-1.md',
          depends_on: ['orch-orchestrator'],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'orch-worker-2',
          name: 'Worker 2',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-worker-2.md',
          depends_on: ['orch-orchestrator'],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'other-step',
          name: 'Other Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/other-step.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    })
    await writePrompt('orch-orchestrator')
    await writePrompt('orch-worker-1')
    await writePrompt('orch-worker-2')
    await writePrompt('other-step')

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'orch-orchestrator' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
        childSurfaceIds: [],
      }),
    ])
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-other-step')).toBe(false)
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-orch-orchestrator')).toBe(false)
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-orch-worker-1')).toBe(false)
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-orch-worker-2')).toBe(false)
    expect(state.runEvents).toEqual([])
  })

  test('worker execution with existing surface appends a new run without creating extra child surfaces or spawn events', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Orchestrated Sequence',
      steps: [
        {
          id: 'orch-orchestrator',
          name: 'Main Orchestrator',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-orchestrator.md',
          depends_on: [],
          status: 'DONE',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'orch-worker-1',
          name: 'Worker 1',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-worker-1.md',
          depends_on: ['orch-orchestrator'],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
      ],
      gates: [],
    })
    await writePrompt('orch-orchestrator')
    await writePrompt('orch-worker-1')
    await writeThreadSurfaceState({
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Orchestrated Sequence',
          createdAt: '2026-03-09T12:00:00.000Z',
          childSurfaceIds: ['thread-orch-orchestrator'],
        },
        {
          id: 'thread-orch-orchestrator',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'orch-orchestrator',
          depth: 1,
          surfaceLabel: 'Main Orchestrator',
          createdAt: '2026-03-09T12:00:01.000Z',
          childSurfaceIds: ['thread-orch-worker-1'],
        },
        {
          id: 'thread-orch-worker-1',
          parentSurfaceId: 'thread-orch-orchestrator',
          parentAgentNodeId: 'orch-worker-1',
          depth: 2,
          surfaceLabel: 'Worker 1',
          createdAt: '2026-03-09T12:00:02.000Z',
          childSurfaceIds: [],
        },
      ],
      runs: [
        {
          id: 'run-root-seed',
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:00.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 1,
        },
        {
          id: 'run-worker-seed',
          threadSurfaceId: 'thread-orch-worker-1',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:02.000Z',
          endedAt: '2026-03-09T12:00:16.000Z',
          executionIndex: 2,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'orch-worker-1' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces.filter(surface => surface.id === 'thread-orch-worker-1')).toHaveLength(1)
    expect(state.runs.filter(run => run.threadSurfaceId === 'thread-orch-worker-1')).toHaveLength(2)
    expect(state.runEvents).toEqual([])
  })

  test('repeated orchestrator runs do not fabricate new delegated child runs without runtime events', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Orchestrated Sequence',
      steps: [
        {
          id: 'orch-orchestrator',
          name: 'Main Orchestrator',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-orchestrator.md',
          depends_on: [],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'orch-worker-1',
          name: 'Worker 1',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-worker-1.md',
          depends_on: ['orch-orchestrator'],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
      ],
      gates: [],
    })
    await writePrompt('orch-orchestrator')
    await writePrompt('orch-worker-1')
    await writeThreadSurfaceState({
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Orchestrated Sequence',
          createdAt: '2026-03-09T12:00:00.000Z',
          childSurfaceIds: ['thread-orch-orchestrator'],
        },
        {
          id: 'thread-orch-orchestrator',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'orch-orchestrator',
          depth: 1,
          surfaceLabel: 'Main Orchestrator',
          createdAt: '2026-03-09T12:00:01.000Z',
          childSurfaceIds: ['thread-orch-worker-1'],
        },
        {
          id: 'thread-orch-worker-1',
          parentSurfaceId: 'thread-orch-orchestrator',
          parentAgentNodeId: 'orch-worker-1',
          depth: 2,
          surfaceLabel: 'Worker 1',
          createdAt: '2026-03-09T12:00:02.000Z',
          childSurfaceIds: [],
        },
      ],
      runs: [
        {
          id: 'run-root-seed',
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:00.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 1,
        },
        {
          id: 'run-orchestrator-seed',
          threadSurfaceId: 'thread-orch-orchestrator',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:01.000Z',
          endedAt: '2026-03-09T12:00:16.000Z',
          executionIndex: 2,
        },
        {
          id: 'run-worker-seed',
          threadSurfaceId: 'thread-orch-worker-1',
          runStatus: 'running',
          startedAt: '2026-03-09T12:00:02.000Z',
          endedAt: null,
          executionIndex: 3,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'orch-orchestrator' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces.filter(surface => surface.id === 'thread-orch-worker-1')).toHaveLength(1)
    expect(state.runs.filter(run => run.threadSurfaceId === 'thread-orch-worker-1')).toHaveLength(1)
    expect(state.runs.filter(run => run.threadSurfaceId === 'thread-orch-orchestrator')).toHaveLength(2)
    expect(state.runEvents).toEqual([])
  })

  test('watchdog metadata alone does not create a child lane without runtime events', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Long Sequence',
      steps: [
        {
          id: 'long-main',
          name: 'Long Main',
          type: 'l',
          model: 'codex',
          prompt_file: '.threados/prompts/long-main.md',
          depends_on: [],
          status: 'DONE',
        },
        {
          id: 'long-watchdog',
          name: 'Long Watchdog',
          type: 'l',
          model: 'codex',
          prompt_file: '.threados/prompts/long-watchdog.md',
          depends_on: [],
          status: 'READY',
          watchdog_for: 'long-main',
        },
      ],
      gates: [],
    })
    await writePrompt('long-main')
    await writePrompt('long-watchdog')
    await writeThreadSurfaceState({
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Long Sequence',
          createdAt: '2026-03-09T12:00:00.000Z',
          childSurfaceIds: ['thread-long-main'],
        },
        {
          id: 'thread-long-main',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'long-main',
          depth: 1,
          surfaceLabel: 'Long Main',
          createdAt: '2026-03-09T12:00:01.000Z',
          childSurfaceIds: [],
        },
      ],
      runs: [
        {
          id: 'run-root-seed',
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:00.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 1,
        },
        {
          id: 'run-main-seed',
          threadSurfaceId: 'thread-long-main',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:01.000Z',
          endedAt: '2026-03-09T12:00:16.000Z',
          executionIndex: 2,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'long-watchdog' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-long-main',
          childSurfaceIds: [],
        }),
      ]),
    )
    expect(state.threadSurfaces.some(surface => surface.id === 'thread-long-watchdog')).toBe(false)
    expect(state.runEvents).toEqual([])
  })

  test('runtime-emitted spawn-child events create child surfaces without static orchestrator metadata', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Runtime Spawn Sequence',
      steps: [
        {
          id: 'delegate-step',
          name: 'Delegate Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/delegate-step.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    })
    await writePrompt('delegate-step')
    runtimeEventLinesByStep['delegate-step'] = [
      JSON.stringify({
        eventType: 'spawn-child',
        createdAt: '2026-03-09T12:00:03.000Z',
        childStepId: 'delegate-child-a',
        childLabel: 'Delegate Child A',
        spawnKind: 'orchestrator',
      }),
      JSON.stringify({
        eventType: 'spawn-child',
        createdAt: '2026-03-09T12:00:04.000Z',
        childStepId: 'delegate-child-b',
        childLabel: 'Delegate Child B',
        spawnKind: 'orchestrator',
      }),
    ]

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'delegate-step' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-root',
          childSurfaceIds: ['thread-delegate-step'],
        }),
        expect.objectContaining({
          id: 'thread-delegate-step',
          parentSurfaceId: 'thread-root',
          childSurfaceIds: ['thread-delegate-child-a', 'thread-delegate-child-b'],
        }),
        expect.objectContaining({
          id: 'thread-delegate-child-a',
          parentSurfaceId: 'thread-delegate-step',
          surfaceLabel: 'Delegate Child A',
        }),
        expect.objectContaining({
          id: 'thread-delegate-child-b',
          parentSurfaceId: 'thread-delegate-step',
          surfaceLabel: 'Delegate Child B',
        }),
      ]),
    )
  })
})
