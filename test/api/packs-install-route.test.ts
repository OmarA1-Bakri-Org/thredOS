import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'packs-install-route-'))
  process.env.THREADOS_BASE_PATH = tempDir
})

afterEach(async () => {
  mock.restore()
  delete process.env.THREADOS_BASE_PATH
  await rm(tempDir, { recursive: true, force: true })
})

describe('POST /api/packs/install', () => {
  test('delegates install to the pack service and returns payload', async () => {
    const installPackMock = mock(async () => ({
      sequence: {
        version: '1.0',
        name: 'Installed API Pack',
        steps: [{ id: 'alpha', name: 'Alpha', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/alpha.md', depends_on: [], status: 'READY', phase: 'phase-one', surface_ref: 'thread-alpha' }],
        gates: [],
        id: 'seq-test',
        deps: [],
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
        pack_id: 'api-pack',
        pack_version: '2.0.0',
        default_policy_ref: 'SAFE',
      },
      threadSurfaces: [{ id: 'thread-root' }, { id: 'thread-alpha' }],
      installedPack: {
        packId: 'api-pack',
        version: '2.0.0',
        stepCount: 1,
        surfaceCount: 2,
      },
    }))

    mock.module('@/lib/packs/install', () => ({
      installPack: installPackMock,
    }))

    const { POST } = await import('@/app/api/packs/install/route')

    const req = new Request('http://localhost/api/packs/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'api-pack',
        version: '2.0.0',
        installName: 'Installed API Pack',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.installedPack.packId).toBe('api-pack')
    expect(body.installedPack.version).toBe('2.0.0')
    expect(body.installedPack.stepCount).toBe(1)
    expect(installPackMock).toHaveBeenCalledWith(tempDir, {
      packId: 'api-pack',
      version: '2.0.0',
      installName: 'Installed API Pack',
    })
  })

  test('validates request bodies', async () => {
    const { POST } = await import('@/app/api/packs/install/route')

    const req = new Request('http://localhost/api/packs/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: '',
        version: '2.0.0',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
