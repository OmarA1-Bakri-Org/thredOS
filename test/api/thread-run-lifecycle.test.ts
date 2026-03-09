import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

const THREAD_SURFACE_STATE_PATH = ['.threados', 'state', 'thread-surfaces.json']

let basePath = ''

async function setupTestSequence() {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(
    join(basePath, '.threados', 'sequence.yaml'),
    YAML.stringify({
      version: '1.0',
      name: 'Lifecycle Sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/step-a.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    }),
  )
  await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# Step A')
}

async function readThreadSurfaceState() {
  const content = await readFile(join(basePath, ...THREAD_SURFACE_STATE_PATH), 'utf-8')
  return JSON.parse(content) as {
    threadSurfaces: Array<{ id: string }>
    runs: Array<{ id: string; threadSurfaceId: string; runStatus: string; endedAt: string | null }>
    mergeEvents: Array<{ id: string }>
  }
}

describe('thread run lifecycle routes', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-thread-run-lifecycle-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupTestSequence()
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 0,
        status: 'SUCCESS',
        duration: 12,
        stdout: 'ok',
        stderr: '',
        startTime: new Date('2026-03-09T10:00:00.000Z'),
        endTime: new Date('2026-03-09T10:00:12.000Z'),
      }),
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
    }
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('first run initializes root thread surface state when absent', async () => {
    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
      }),
    ])
    expect(state.runs).toHaveLength(1)
    expect(state.runs[0]).toMatchObject({
      threadSurfaceId: 'thread-root',
      runStatus: 'successful',
    })
  })

  test('a new run request creates a new RunScope instead of mutating the old run', async () => {
    const { POST } = await import('@/app/api/run/route')

    await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    const state = await readThreadSurfaceState()
    expect(state.runs).toHaveLength(2)
    expect(state.runs[0].id).not.toBe(state.runs[1].id)
    expect(state.runs[0].runStatus).toBe('successful')
    expect(state.runs[1].runStatus).toBe('successful')
  })

  test('stop marks the current run cancelled', async () => {
    const stateDir = join(basePath, '.threados', 'state')
    await mkdir(stateDir, { recursive: true })
    await writeFile(
      join(stateDir, 'thread-surfaces.json'),
      JSON.stringify({
        version: 1,
        threadSurfaces: [
          {
            id: 'thread-root',
            parentSurfaceId: null,
            parentAgentNodeId: null,
            depth: 0,
            surfaceLabel: 'Lifecycle Sequence',
            createdAt: '2026-03-09T10:00:00.000Z',
            childSurfaceIds: [],
          },
        ],
        runs: [
          {
            id: 'run-active',
            threadSurfaceId: 'thread-root',
            runStatus: 'running',
            startedAt: '2026-03-09T10:00:00.000Z',
            endedAt: null,
          },
        ],
        mergeEvents: [],
      }, null, 2),
    )

    const { POST } = await import('@/app/api/stop/route')
    const response = await POST(new Request('http://localhost/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    expect(response.status).toBe(200)
    const state = await readThreadSurfaceState()
    expect(state.runs).toEqual([
      expect.objectContaining({
        id: 'run-active',
        runStatus: 'cancelled',
      }),
    ])
    expect(state.runs[0].endedAt).not.toBeNull()
  })

  test('restart creates a replacement run and does not mutate the old run into a restart', async () => {
    const stateDir = join(basePath, '.threados', 'state')
    await mkdir(stateDir, { recursive: true })
    await writeFile(
      join(stateDir, 'thread-surfaces.json'),
      JSON.stringify({
        version: 1,
        threadSurfaces: [
          {
            id: 'thread-root',
            parentSurfaceId: null,
            parentAgentNodeId: null,
            depth: 0,
            surfaceLabel: 'Lifecycle Sequence',
            createdAt: '2026-03-09T10:00:00.000Z',
            childSurfaceIds: [],
          },
        ],
        runs: [
          {
            id: 'run-old',
            threadSurfaceId: 'thread-root',
            runStatus: 'successful',
            startedAt: '2026-03-09T10:00:00.000Z',
            endedAt: '2026-03-09T10:00:12.000Z',
          },
        ],
        mergeEvents: [],
      }, null, 2),
    )

    const { POST } = await import('@/app/api/restart/route')
    const response = await POST(new Request('http://localhost/api/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    expect(response.status).toBe(200)
    const state = await readThreadSurfaceState()
    expect(state.runs).toHaveLength(2)
    expect(state.runs[0]).toMatchObject({
      id: 'run-old',
      runStatus: 'successful',
      endedAt: '2026-03-09T10:00:12.000Z',
    })
    expect(state.runs[1]).toMatchObject({
      threadSurfaceId: 'thread-root',
      runStatus: 'running',
      endedAt: null,
    })
  })
})
