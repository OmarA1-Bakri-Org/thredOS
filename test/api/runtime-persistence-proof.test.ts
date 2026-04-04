import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { saveRunArtifacts } from '@/lib/runner/artifacts'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

let basePath = ''

const timestamp = '2026-04-04T00:00:00.000Z'

function makeSurface(overrides: Partial<ThreadSurface>): ThreadSurface {
  return {
    id: 'surface-a',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Surface A',
    createdAt: timestamp,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: 'sealed',
    visibility: 'self_only',
    isolationLabel: 'THREADOS_SCOPED',
    revealState: 'sealed',
    allowedReadScopes: [],
    allowedWriteScopes: [],
    ...overrides,
  }
}

async function setupWorkspace() {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# Step A\n')
  await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
    mode: 'SAFE',
    export_mode: 'local_bundle',
  }))
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0',
    name: 'runtime-persistence-proof',
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
  }))
  await writeThreadSurfaceState(basePath, {
    version: 1,
    threadSurfaces: [makeSurface({ id: 'surface-a', surfaceLabel: 'Sealed Surface A' })],
    runs: [],
    mergeEvents: [],
    runEvents: [],
  })
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
      duration: 12_000,
      stdout: 'ok',
      stderr: '',
      startTime: new Date('2026-04-04T00:00:00.000Z'),
      endTime: new Date('2026-04-04T00:00:12.000Z'),
    }),
    saveRunArtifacts,
  }
}

describe.serial('runtime persistence proof', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-proof-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()
    await setupWorkspace()
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('SAFE run, reveal, and export remain intact across fresh route reads', async () => {
    const { POST: runStep } = await import('@/app/api/run/route')
    const runResponse = await runStep(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a', confirmPolicy: true }),
    }))

    expect(runResponse.status).toBe(200)
    const runBody = await runResponse.json()
    expect(runBody.success).toBe(true)
    const runId = runBody.runId as string

    const { POST: revealSurface } = await import('@/app/api/surfaces/reveal/route')
    const revealResponse = await revealSurface(new Request('http://localhost/api/surfaces/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surfaceId: 'surface-a', runId }),
    }))
    expect(revealResponse.status).toBe(200)

    const { POST: exportBundle } = await import('@/app/api/exports/run-bundle/route')
    const exportResponse = await exportBundle(new Request('http://localhost/api/exports/run-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    }))
    expect(exportResponse.status).toBe(200)
    const exportBody = await exportResponse.json()

    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__

    const { GET: getApprovals } = await import('@/app/api/approvals/route')
    const { GET: getTraces } = await import('@/app/api/traces/route')
    const { GET: getRuns } = await import('@/app/api/thread-runs/route')
    const { GET: getSurfaces } = await import('@/app/api/thread-surfaces/route')

    const approvalsResponse = await getApprovals(new Request(`http://localhost/api/approvals?runId=${runId}`))
    expect(approvalsResponse.status).toBe(200)
    await expect(approvalsResponse.json()).resolves.toMatchObject({
      approvals: [
        expect.objectContaining({
          action_type: 'run',
          target_ref: 'step:step-a',
          status: 'approved',
          requested_by: 'local@thredos',
          approved_by: 'local@thredos',
        }),
      ],
    })

    const tracesResponse = await getTraces(new Request(`http://localhost/api/traces?runId=${runId}`))
    expect(tracesResponse.status).toBe(200)
    const tracesBody = await tracesResponse.json()
    expect(tracesBody.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'approval-requested',
      'approval-resolved',
      'surface-revealed',
      'barrier-attested',
    ])

    const runsResponse = await getRuns(new Request('http://localhost/api/thread-runs'))
    expect(runsResponse.status).toBe(200)
    const runsBody = await runsResponse.json()
    expect(runsBody.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: runId,
        threadSurfaceId: ROOT_THREAD_SURFACE_ID,
        runStatus: 'successful',
      }),
    ]))

    const surfacesResponse = await getSurfaces(new Request('http://localhost/api/thread-surfaces'))
    expect(surfacesResponse.status).toBe(200)
    const surfacesBody = await surfacesResponse.json()
    expect(surfacesBody.threadSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'surface-a',
        revealState: 'revealed',
        visibility: 'dependency',
      }),
      expect.objectContaining({
        id: ROOT_THREAD_SURFACE_ID,
      }),
    ]))

    const bundlePath = join(basePath, exportBody.exportPath)
    const persistedBundle = JSON.parse(await readFile(bundlePath, 'utf-8'))
    expect(persistedBundle.run_id).toBe(runId)
    expect(persistedBundle.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'surface-a',
        revealState: 'revealed',
      }),
    ]))
    expect(persistedBundle.approvals.map((approval: { status: string }) => approval.status)).toEqual(['pending', 'approved'])
    expect(persistedBundle.artifact_manifests).toContain(`.threados/runs/${runId}/step-a/status.json`)
    expect(persistedBundle.timing_summary).toMatchObject({
      stepCount: 1,
      totalDurationMs: 12_000,
      successfulSteps: 1,
    })
  })
})
