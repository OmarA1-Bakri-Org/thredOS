import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

let basePath: string

const surface: ThreadSurface = {
  id: 'thread-research',
  parentSurfaceId: 'thread-master',
  parentAgentNodeId: 'spawn-research',
  depth: 1,
  surfaceLabel: 'Research',
  surfaceDescription: 'Research surface',
  role: 'specialist',
  createdAt: '2026-03-09T00:01:00.000Z',
  childSurfaceIds: [],
  sequenceRef: null,
  spawnedByAgentId: null,
}

const runs: RunScope[] = [
  {
    id: 'run-research-success',
    threadSurfaceId: 'thread-research',
    runStatus: 'successful',
    startedAt: '2026-03-09T00:01:00.000Z',
    endedAt: '2026-03-09T00:04:00.000Z',
    runSummary: 'Research succeeded',
    runNotes: 'Initial note',
    runDiscussion: 'Initial discussion',
    parentRunId: null,
    childIndex: null,
  },
  {
    id: 'run-research-failed',
    threadSurfaceId: 'thread-research',
    runStatus: 'failed',
    startedAt: '2026-03-09T01:01:00.000Z',
    endedAt: '2026-03-09T01:04:00.000Z',
    runSummary: 'Research failed',
    runNotes: 'Failure note',
    runDiscussion: 'Failure discussion',
    parentRunId: null,
    childIndex: null,
  },
]

describe.serial('thread annotation route', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-thread-annotations-'))
    process.env.THREADOS_BASE_PATH = basePath
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [surface],
      runs,
      mergeEvents: [],
      runEvents: [],
    })
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('GET /api/thread-annotations resolves selected and default run payloads', async () => {
    const { GET } = await import('@/app/api/thread-annotations/route')

    const defaultRes = await GET(new Request('http://localhost/api/thread-annotations?surfaceId=thread-research'))
    expect(defaultRes.status).toBe(200)
    expect(await defaultRes.json()).toMatchObject({
      surface: {
        surfaceId: 'thread-research',
        surfaceLabel: 'Research',
      },
      runContext: {
        defaultRunId: 'run-research-success',
        displayRunId: 'run-research-success',
        runSelection: 'default',
      },
      annotations: {
        runSummary: 'Research succeeded',
        runNotes: 'Initial note',
        runDiscussion: 'Initial discussion',
      },
    })

    const selectedRes = await GET(new Request('http://localhost/api/thread-annotations?surfaceId=thread-research&runId=run-research-failed'))
    expect(selectedRes.status).toBe(200)
    expect(await selectedRes.json()).toMatchObject({
      runContext: {
        selectedRunId: 'run-research-failed',
        displayRunId: 'run-research-failed',
        runSelection: 'selected',
      },
      annotations: {
        runSummary: 'Research failed',
        runNotes: 'Failure note',
        runDiscussion: 'Failure discussion',
      },
    })
  })

  test('POST /api/thread-annotations persists run-scoped notes and discussion', async () => {
    const { POST } = await import('@/app/api/thread-annotations/route')
    const req = new Request('http://localhost/api/thread-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surfaceId: 'thread-research',
        runId: 'run-research-failed',
        runSummary: 'Updated failed summary',
        runNotes: 'Updated note',
        runDiscussion: 'Updated discussion',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, runId: 'run-research-failed' })

    const persisted = await readThreadSurfaceState(basePath)
    expect(persisted.runs.find(run => run.id === 'run-research-failed')).toMatchObject({
      runSummary: 'Updated failed summary',
      runNotes: 'Updated note',
      runDiscussion: 'Updated discussion',
    })
  })

  test('POST /api/thread-annotations returns 404 when the surface is missing', async () => {
    const { POST } = await import('@/app/api/thread-annotations/route')
    const req = new Request('http://localhost/api/thread-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surfaceId: 'thread-missing',
        runId: 'run-research-failed',
        runSummary: 'Ignored',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      code: 'NOT_FOUND',
      error: 'Thread surface thread-missing not found',
    })
  })

  test('POST /api/thread-annotations returns 404 when the run is missing for the surface', async () => {
    const { POST } = await import('@/app/api/thread-annotations/route')
    const req = new Request('http://localhost/api/thread-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surfaceId: 'thread-research',
        runId: 'run-missing',
        runSummary: 'Ignored',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      code: 'NOT_FOUND',
      error: 'Run run-missing for surface thread-research not found',
    })
  })
})
