import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ExportBundleSchema } from '@/lib/exports/schema'
import { readTraceEvents } from '@/lib/traces/reader'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

let basePath: string

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
    surfaceClass: 'shared',
    visibility: 'dependency',
    isolationLabel: 'NONE',
    revealState: null,
    allowedReadScopes: [],
    allowedWriteScopes: [],
    ...overrides,
  }
}

async function writePolicy(content: string) {
  await writeFile(join(basePath, '.threados/policy.yaml'), content, 'utf-8')
}

async function writeSequence() {
  await writeFile(
    join(basePath, '.threados/sequence.yaml'),
    'version: "1.0"\nname: surface-proof-seq\nsteps: []\n',
    'utf-8',
  )
}

async function writeRunArtifacts(runId: string) {
  const runDir = join(basePath, '.threados/runs', runId)
  await mkdir(runDir, { recursive: true })
  await mkdir(join(runDir, 'step-alpha'), { recursive: true })
  await writeFile(
    join(runDir, 'trace.ndjson'),
    [
      JSON.stringify({
        ts: timestamp,
        run_id: runId,
        surface_id: 'surface-a',
        actor: 'threados',
        event_type: 'step-started',
        payload_ref: null,
        policy_ref: null,
      }),
    ].join('\n') + '\n',
    'utf-8',
  )
  await writeFile(
    join(runDir, 'step-alpha', 'status.json'),
    JSON.stringify({
      stepId: 'step-alpha',
      runId,
      startTime: timestamp,
      endTime: '2026-04-04T00:00:05.000Z',
      duration: 5000,
      exitCode: 0,
      status: 'SUCCESS',
    }, null, 2),
    'utf-8',
  )
}

describe.serial('surface proof routes', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-surface-proof-'))
    process.env.THREADOS_BASE_PATH = basePath
    await mkdir(join(basePath, '.threados'), { recursive: true })
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('GET /api/surfaces/access allows self access on a private surface without explicit scopes', async () => {
    await writePolicy('cross_surface_reads: deny\n')
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        makeSurface({
          id: 'surface-a',
          surfaceLabel: 'Surface A',
          surfaceClass: 'private',
          visibility: 'self_only',
          isolationLabel: 'THREADOS_SCOPED',
          allowedReadScopes: [],
        }),
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const { GET } = await import('@/app/api/surfaces/access/route')
    const res = await GET(new Request('http://localhost/api/surfaces/access?surfaceId=surface-a&requestorSurfaceId=surface-a'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.access.canRead).toBe(true)
    expect(data.access.canReadSemantics).toBe(true)
    expect(data.access.canReadManifest).toBe(true)
    expect(data.access.reason).toBe('private surface: requestor in scope')
  })

  test('GET /api/surfaces/access denies dependency-scoped cross-surface reads without an explicit read scope', async () => {
    await writePolicy('cross_surface_reads: dependency_only\n')
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        makeSurface({
          id: 'surface-a',
          surfaceLabel: 'Surface A',
          surfaceClass: 'shared',
          visibility: 'dependency',
          revealState: 'revealed',
          allowedReadScopes: [],
        }),
        makeSurface({
          id: 'surface-b',
          surfaceLabel: 'Surface B',
        }),
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const { GET } = await import('@/app/api/surfaces/access/route')
    const res = await GET(new Request('http://localhost/api/surfaces/access?surfaceId=surface-a&requestorSurfaceId=surface-b'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.access.canRead).toBe(false)
    expect(data.access.canReadSemantics).toBe(false)
    expect(data.access.canReadManifest).toBe(true)
    expect(data.access.reason).toBe('requestor not in dependency scope')
  })

  test('POST /api/surfaces/reveal requires runId and records attestation for a reveal run', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        makeSurface({
          id: 'surface-a',
          surfaceLabel: 'Sealed Surface A',
          surfaceClass: 'sealed',
          visibility: 'self_only',
          isolationLabel: 'THREADOS_SCOPED',
          revealState: 'sealed',
        }),
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/surfaces/reveal/route')
    const missingRunIdRes = await POST(new Request('http://localhost/api/surfaces/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surfaceId: 'surface-a' }),
    }))
    expect(missingRunIdRes.status).toBe(400)

    const res = await POST(new Request('http://localhost/api/surfaces/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surfaceId: 'surface-a', runId: 'run-reveal-1' }),
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.surface.revealState).toBe('revealed')
    expect(data.surface.visibility).toBe('dependency')
    expect(data.attestation.run_id).toBe('run-reveal-1')
    expect(data.attestation.surface_id).toBe('surface-a')
    expect(data.attestation.reveal_state).toBe('revealed')

    const persisted = await readThreadSurfaceState(basePath)
    expect(persisted.threadSurfaces[0].revealState).toBe('revealed')
    expect(persisted.threadSurfaces[0].visibility).toBe('dependency')

    const traceEvents = await readTraceEvents(basePath, 'run-reveal-1')
    expect(traceEvents.map(event => event.event_type)).toEqual(['surface-revealed', 'barrier-attested'])
  })

  test('POST /api/exports/run-bundle writes a schema-valid bundle when export_mode allows it', async () => {
    await writePolicy('export_mode: local_bundle\n')
    await writeSequence()
    await writeRunArtifacts('run-export-1')
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [
        makeSurface({
          id: 'surface-a',
          surfaceLabel: 'Surface A',
          revealState: 'revealed',
        }),
      ],
      runs: [],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/exports/run-bundle/route')
    const res = await POST(new Request('http://localhost/api/exports/run-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-export-1' }),
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.exportPath).toBe('.threados/exports/run-export-1/bundle.json')
    const parsedBundle = ExportBundleSchema.parse(data.bundle)
    expect(parsedBundle.run_id).toBe('run-export-1')
    expect(parsedBundle.surfaces).toHaveLength(1)
    expect(parsedBundle.artifact_manifests).toContain('.threados/runs/run-export-1/step-alpha/status.json')
    expect(parsedBundle.timing_summary).toMatchObject({
      stepCount: 1,
      totalDurationMs: 5000,
      successfulSteps: 1,
    })

    const writtenBundle = JSON.parse(await readFile(join(basePath, '.threados/exports/run-export-1/bundle.json'), 'utf-8'))
    expect(writtenBundle.run_id).toBe('run-export-1')
    expect(writtenBundle.bundle_version).toBe('1.0')
  })

  test('POST /api/exports/run-bundle is blocked when export_mode is off', async () => {
    await writePolicy('export_mode: off\n')
    await writeSequence()

    const { POST } = await import('@/app/api/exports/run-bundle/route')
    const res = await POST(new Request('http://localhost/api/exports/run-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-export-blocked' }),
    }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.code).toBe('POLICY_DENIED')
    expect(data.error).toBe('Exports are disabled by policy')
  })
})
