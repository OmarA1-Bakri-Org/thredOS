import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { writeMprocsMap } from '@/lib/mprocs/state'

// Set THREADOS_BASE_PATH before importing routes
let basePath: string

async function setupTestSequence(seq: object) {
  await mkdir(join(basePath, '.threados'), { recursive: true })
  await writeFile(join(basePath, '.threados/sequence.yaml'), YAML.stringify(seq))
  // Create prompts dir
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
}

const baseSequence = {
  version: '1.0',
  name: 'test-seq',
  steps: [
    { id: 'step-a', name: 'Step A', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'READY' },
    { id: 'step-b', name: 'Step B', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-b.md', depends_on: ['step-a'], status: 'READY' },
  ],
  gates: [
    { id: 'gate-1', name: 'Gate 1', depends_on: ['step-a'], status: 'PENDING' },
  ],
}

describe.serial('API Routes', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-api-test-'))
    process.env.THREADOS_BASE_PATH = basePath
    await setupTestSequence(baseSequence)
    // Create prompt files
    await writeFile(join(basePath, '.threados/prompts/step-a.md'), '# Step A')
    await writeFile(join(basePath, '.threados/prompts/step-b.md'), '# Step B')
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('GET /api/sequence returns sequence', async () => {
    const { GET } = await import('@/app/api/sequence/route')
    const res = await GET(new Request('http://localhost/api/sequence'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('test-seq')
    expect(data.steps).toHaveLength(2)
  })

  test('GET /api/status returns status', async () => {
    const { GET } = await import('@/app/api/status/route')
    const res = await GET(new Request('http://localhost/api/status'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.summary.total).toBe(2)
    expect(data.summary.ready).toBe(2)
    expect(data.gates).toHaveLength(1)
  })

  test('GET /api/status leaves non-mprocs RUNNING steps alone', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'reconcile-seq',
      steps: [
        { id: 'step-a', name: 'Step A', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'RUNNING' },
      ],
      gates: [],
    })

    const { GET } = await import('@/app/api/status/route')
    const res = await GET(new Request('http://localhost/api/status'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.summary.running).toBe(1)
    expect(data.summary.failed).toBe(0)
    expect(data.steps).toHaveLength(1)
    expect(data.steps[0]).toMatchObject({
      id: 'step-a',
      status: 'RUNNING',
    })
    expect(data.steps[0].processIndex).toBeUndefined()
  })

  test('GET /api/status reconciles orphaned mprocs-tracked RUNNING steps before returning status', async () => {
    await setupTestSequence({
      version: '1.0',
      name: 'reconcile-seq',
      steps: [
        { id: 'step-a', name: 'Step A', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'RUNNING' },
      ],
      gates: [],
    })
    await writeMprocsMap(basePath, { 'step-a': 0 })

    const { GET } = await import('@/app/api/status/route')
    const res = await GET(new Request('http://localhost/api/status'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.summary.running).toBe(0)
    expect(data.summary.failed).toBe(1)
    expect(data.steps).toHaveLength(1)
    expect(data.steps[0]).toMatchObject({
      id: 'step-a',
      status: 'FAILED',
    })
    expect(data.steps[0].processIndex).toBeUndefined()
  })

  test('POST /api/step add creates step', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'step-c', name: 'Step C' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.stepId).toBe('step-c')
  })

  test('POST /api/step add duplicate returns 409', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  test('POST /api/step rm removes step', async () => {
    const { POST } = await import('@/app/api/step/route')
    // step-b depends on step-a, so remove step-b first
    const req = new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rm', stepId: 'step-b' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/step rm with dependents returns 409', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rm', stepId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  test('POST /api/step clone works', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clone', sourceId: 'step-a', newId: 'step-a-copy' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/dep add works', async () => {
    // First add a step-c with no deps
    const stepRoute = await import('@/app/api/step/route')
    await stepRoute.POST(new Request('http://localhost/api/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'step-c', name: 'Step C' }),
    }))

    const { POST } = await import('@/app/api/dep/route')
    const req = new Request('http://localhost/api/dep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'step-c', depId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/dep rm works', async () => {
    const { POST } = await import('@/app/api/dep/route')
    const req = new Request('http://localhost/api/dep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rm', stepId: 'step-b', depId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  test('POST /api/gate insert works', async () => {
    const { POST } = await import('@/app/api/gate/route')
    const req = new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert', gateId: 'gate-2', name: 'Gate 2' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/gate approve works', async () => {
    const { POST } = await import('@/app/api/gate/route')
    const req = new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', gateId: 'gate-1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  test('POST /api/gate block works', async () => {
    const { POST } = await import('@/app/api/gate/route')
    const req = new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block', gateId: 'gate-1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  test('GET /api/gate returns gates', async () => {
    const { GET } = await import('@/app/api/gate/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.gates).toHaveLength(1)
  })

  test('GET /api/gate-metrics counts dotted audit actions written by /api/gate', async () => {
    const gateRoute = await import('@/app/api/gate/route')
    await gateRoute.POST(new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block', gateId: 'gate-1' }),
    }))
    await gateRoute.POST(new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', gateId: 'gate-1' }),
    }))

    const { GET } = await import('@/app/api/gate-metrics/route')
    const res = await GET(new Request('http://localhost/api/gate-metrics?gateId=gate-1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.metrics).toEqual(expect.objectContaining({
      totalAttempts: 2,
      approvals: 1,
      blocks: 1,
      approvalRate: 50,
      avgTimeToApprovalMs: expect.any(Number),
    }))
  })

  test('GET /api/group returns groups', async () => {
    const { GET } = await import('@/app/api/group/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.groups).toBeDefined()
  })

  test('POST /api/group parallelize works', async () => {
    // Need to add steps without deps to parallelize
    const stepRoute = await import('@/app/api/step/route')
    await stepRoute.POST(new Request('http://localhost/api/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'p-1', name: 'P1' }),
    }))
    await stepRoute.POST(new Request('http://localhost/api/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', stepId: 'p-2', name: 'P2' }),
    }))

    const { POST } = await import('@/app/api/group/route')
    const req = new Request('http://localhost/api/group', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'parallelize', stepIds: ['p-1', 'p-2'] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/fusion create works', async () => {
    const { POST } = await import('@/app/api/fusion/route')
    const req = new Request('http://localhost/api/fusion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', candidates: ['step-a', 'step-b'], synthId: 'synth-1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('GET /api/audit returns entries', async () => {
    const { GET } = await import('@/app/api/audit/route')
    const req = new Request('http://localhost/api/audit?limit=10&offset=0')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.entries)).toBe(true)
  })

  test('POST /api/stop with missing step returns 404', async () => {
    const { POST } = await import('@/app/api/stop/route')
    const req = new Request('http://localhost/api/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'nonexistent' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  test('POST /api/restart with missing step returns 404', async () => {
    const { POST } = await import('@/app/api/restart/route')
    const req = new Request('http://localhost/api/restart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'nonexistent' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  test('POST /api/step with invalid body returns 400', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('POST /api/stop valid step works', async () => {
    const { POST } = await import('@/app/api/stop/route')
    const req = new Request('http://localhost/api/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/restart valid step works', async () => {
    const { POST } = await import('@/app/api/restart/route')
    const req = new Request('http://localhost/api/restart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/step edit works', async () => {
    const { POST } = await import('@/app/api/step/route')
    const req = new Request('http://localhost/api/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', stepId: 'step-a', name: 'Updated A' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  test('POST /api/gate approve nonexistent returns error', async () => {
    const { POST } = await import('@/app/api/gate/route')
    const req = new Request('http://localhost/api/gate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', gateId: 'nonexistent' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })
})
