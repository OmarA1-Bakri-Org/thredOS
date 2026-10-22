import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { normalizeThreadSurface, type MergeEvent, type RunScope, type ThreadSurface } from '@/lib/thread-surfaces/types'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'

let basePath: string

const threadSurfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    surfaceDescription: 'Top-level orchestrator surface',
    role: 'orchestrator',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-research'],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-research',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-research',
    depth: 1,
    surfaceLabel: 'Research',
    surfaceDescription: 'Research branch',
    role: 'specialist',
    createdAt: '2026-03-09T00:01:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
]

const runs: RunScope[] = [
  {
    id: 'run-master-1',
    threadSurfaceId: 'thread-master',
    runStatus: 'successful',
    startedAt: '2026-03-09T00:00:00.000Z',
    endedAt: '2026-03-09T00:03:00.000Z',
    executionIndex: 2,
    runSummary: 'Master completed',
    parentRunId: null,
    childIndex: null,
  },
  {
    id: 'run-research-1',
    threadSurfaceId: 'thread-research',
    runStatus: 'running',
    startedAt: '2026-03-09T00:01:00.000Z',
    endedAt: null,
    executionIndex: 1,
    runSummary: 'Research in progress',
    parentRunId: null,
    childIndex: null,
  },
]

const mergeEvents: MergeEvent[] = [
  {
    id: 'merge-1',
    runId: 'run-master-1',
    destinationThreadSurfaceId: 'thread-master',
    sourceThreadSurfaceIds: ['thread-research'],
    sourceRunIds: ['run-research-1'],
    mergeKind: 'single',
    executionIndex: 2,
    createdAt: '2026-03-09T00:03:00.000Z',
    summary: 'Research merged into master',
  },
]

describe.serial('thread surface read routes', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-thread-routes-'))
    process.env.THREADOS_BASE_PATH = basePath
    await mkdir(join(basePath, '.threados'), { recursive: true })
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces,
      runs,
      mergeEvents,
      runEvents: [],
    })
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUNTIME_SERVICE__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('GET /api/thread-surfaces returns persisted surfaces', async () => {
    const { GET } = await import('@/app/api/thread-surfaces/route')
    const res = await GET(new Request('http://localhost/api/thread-surfaces'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.threadSurfaces).toEqual(threadSurfaces.map(normalizeThreadSurface))
  })

  test('GET /api/thread-surfaces reconciles stale root and step labels back to the sequence source of truth', async () => {
    await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
      version: '1.0',
      name: 'Canonical Sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Canonical Step A',
          type: 'base',
          model: 'claude-code',
          prompt_file: '.threados/prompts/step-a.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    }))

    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Stale Sequence',
          createdAt: '2026-03-09T00:00:00.000Z',
          childSurfaceIds: ['thread-step-a'],
          sequenceRef: null,
          spawnedByAgentId: null,
        },
        {
          id: 'thread-step-a',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'step-a',
          depth: 1,
          surfaceLabel: 'Stale Step A',
          createdAt: '2026-03-09T00:01:00.000Z',
          childSurfaceIds: [],
          sequenceRef: null,
          spawnedByAgentId: null,
        },
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const { GET } = await import('@/app/api/thread-surfaces/route')
    const res = await GET(new Request('http://localhost/api/thread-surfaces'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.threadSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-root', surfaceLabel: 'Canonical Sequence' }),
      expect.objectContaining({ id: 'thread-step-a', surfaceLabel: 'Canonical Step A' }),
    ]))
    expect(data.threadSurfaces).toHaveLength(2)

    const persisted = JSON.parse(await readFile(join(basePath, '.threados', 'state', 'thread-surfaces.json'), 'utf-8')) as {
      threadSurfaces: Array<{ id: string; surfaceLabel: string }>
    }
    expect(persisted.threadSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-root', surfaceLabel: 'Canonical Sequence' }),
      expect.objectContaining({ id: 'thread-step-a', surfaceLabel: 'Canonical Step A' }),
    ]))
    expect(persisted.threadSurfaces).toHaveLength(2)
  })

  test('GET /api/thread-runs returns runs and filters by threadSurfaceId', async () => {
    const { GET } = await import('@/app/api/thread-runs/route')

    const allRes = await GET(new Request('http://localhost/api/thread-runs'))
    expect(allRes.status).toBe(200)
    expect((await allRes.json()).runs).toEqual(runs)

    const filteredRes = await GET(new Request('http://localhost/api/thread-runs?threadSurfaceId=thread-research'))
    expect(filteredRes.status).toBe(200)
    expect((await filteredRes.json()).runs).toEqual([runs[1]])
  })

  test('GET /api/thread-runs overlays canonical workflow, attempt, and process truth', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces,
      runs: [{
        ...runs[1],
        id: 'attempt-1',
        workflowRunId: 'workflow-run-1',
        attemptId: 'attempt-1',
        workspaceId: 'workspace-stale',
        snapshotId: 'snapshot-stale',
        provider: 'copy',
        isolationLabel: 'THREADOS_SCOPED',
      }],
      mergeEvents: [],
      runEvents: [],
    })
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      listRuns: async () => [{
        source: 'v2',
        schemaVersion: 2,
        run: {
          id: 'workflow-run-1',
          status: 'interrupted',
        },
        attempts: [{ id: 'attempt-1' }],
      }] as never,
      inspectAttempt: async () => ({
        source: 'v2',
        schemaVersion: 2,
        attempt: {
          id: 'attempt-1',
          workflow_run_id: 'workflow-run-1',
          status: 'interrupted',
          workspace_id: 'workspace-1',
          baseline_snapshot_id: 'snapshot-1',
        },
        process: {
          id: 'process-1',
          status: 'lost',
        },
      }) as never,
    } as unknown as RuntimeServicePort

    const { GET } = await import('@/app/api/thread-runs/route')
    const response = await GET(new Request('http://localhost/api/thread-runs'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      runs: [{
        id: 'attempt-1',
        runStatus: 'failed',
        workflowRunId: 'workflow-run-1',
        attemptId: 'attempt-1',
        runtimeSource: 'v2',
        workflowRunStatus: 'interrupted',
        attemptStatus: 'interrupted',
        processStatus: 'lost',
        workspaceId: 'workspace-1',
        snapshotId: 'snapshot-1',
        provider: 'copy',
        isolationLabel: 'THREADOS_SCOPED',
      }],
    })
  })

  test('GET /api/thread-runs preserves compatibility runs when one attempt reference is stale', async () => {
    const staleRun: RunScope = {
      ...runs[0],
      id: 'legacy-run',
      attemptId: 'missing-attempt',
    }
    const canonicalRun: RunScope = {
      ...runs[1],
      id: 'attempt-1',
      workflowRunId: 'workflow-run-1',
      attemptId: 'attempt-1',
    }
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces,
      runs: [staleRun, canonicalRun],
      mergeEvents: [],
      runEvents: [],
    })
    globalThis.__THREADOS_RUNTIME_SERVICE__ = {
      listRuns: async () => [{
        source: 'v2',
        schemaVersion: 2,
        run: {
          id: 'workflow-run-1',
          status: 'running',
        },
        attempts: [{ id: 'attempt-1' }],
      }] as never,
      inspectAttempt: async (attemptId: string) => {
        if (attemptId === 'missing-attempt') {
          throw Object.assign(new Error('attempt missing-attempt was not found'), {
            code: 'ATTEMPT_NOT_FOUND',
          })
        }
        return {
          source: 'v2',
          schemaVersion: 2,
          attempt: {
            id: 'attempt-1',
            workflow_run_id: 'workflow-run-1',
            status: 'running',
          },
          process: {
            id: 'process-1',
            status: 'running',
          },
        } as never
      },
    } as unknown as RuntimeServicePort

    const { GET } = await import('@/app/api/thread-runs/route')
    const response = await GET(new Request('http://localhost/api/thread-runs'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      runs: [
        staleRun,
        {
          ...canonicalRun,
          runtimeSource: 'v2',
          workflowRunStatus: 'running',
          runStatus: 'running',
          attemptStatus: 'running',
          processStatus: 'running',
        },
      ],
    })
  })

  test('GET /api/thread-merges returns merge events and filters by runId', async () => {
    const { GET } = await import('@/app/api/thread-merges/route')

    const allRes = await GET(new Request('http://localhost/api/thread-merges'))
    expect(allRes.status).toBe(200)
    expect((await allRes.json()).mergeEvents).toEqual(mergeEvents)

    const filteredRes = await GET(new Request('http://localhost/api/thread-merges?runId=run-master-1'))
    expect(filteredRes.status).toBe(200)
    expect((await filteredRes.json()).mergeEvents).toEqual(mergeEvents)

    const emptyRes = await GET(new Request('http://localhost/api/thread-merges?runId=missing'))
    expect(emptyRes.status).toBe(200)
    expect((await emptyRes.json()).mergeEvents).toEqual([])
  })
})
