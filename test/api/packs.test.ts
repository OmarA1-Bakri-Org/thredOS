import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readPackState } from '@/lib/packs/repository'
import type { PackState } from '@/lib/packs/repository'

/**
 * Tests for the file-backed /api/packs route.
 *
 * Each test runs against a fresh temp directory with `.threados/state/packs.json`.
 * We mock `getBasePath` to point at the temp dir so the route reads/writes there.
 */

let tempDir: string
let GET: typeof import('@/app/api/packs/route').GET
let POST: typeof import('@/app/api/packs/route').POST

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'packs-test-'))
  const stateDir = join(tempDir, '.threados', 'state')
  await mkdir(stateDir, { recursive: true })

  const emptyState: PackState = { version: 1, packs: [] }
  await writeFile(join(stateDir, 'packs.json'), JSON.stringify(emptyState, null, 2))

  // Point the route at our temp directory
  process.env.THREADOS_BASE_PATH = tempDir

  // Re-import route handlers so they pick up the env change
  const routeMod = await import('@/app/api/packs/route')
  GET = routeMod.GET
  POST = routeMod.POST
})

afterEach(async () => {
  delete process.env.THREADOS_BASE_PATH
  await rm(tempDir, { recursive: true, force: true })
})

// ── GET tests ────────────────────────────────────────────────────────────

describe('GET /api/packs (file-backed)', () => {
  test('returns packs from file state', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.packs)).toBe(true)
    expect(body.packs).toHaveLength(0)
  })

  test('returns packs that were previously written to disk', async () => {
    // Seed the file with a pack
    const seeded: PackState = {
      version: 1,
      packs: [
        {
          id: 'seeded-pack',
          type: 'challenger',
          builderId: 'b1',
          builderName: 'Alice',
          division: 'open',
          classification: 'qualifier',
          acquiredAt: '2026-01-01T00:00:00.000Z',
          highestStatus: 'challenger',
          statusHistory: [],
        },
      ],
    }
    await writeFile(
      join(tempDir, '.threados', 'state', 'packs.json'),
      JSON.stringify(seeded, null, 2),
    )

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.packs).toHaveLength(1)
    expect(body.packs[0].id).toBe('seeded-pack')
  })
})

// ── POST create tests ────────────────────────────────────────────────────

describe('POST /api/packs action=create (file-backed)', () => {
  test('creates a pack and persists it to disk', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'pack-1',
        type: 'challenger',
        builderId: 'builder-1',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.pack).toBeDefined()
    expect(body.pack.id).toBe('pack-1')
    expect(body.pack.type).toBe('challenger')
    expect(body.pack.highestStatus).toBe('challenger')
    expect(body.pack.builderId).toBe('builder-1')
    expect(body.pack.builderName).toBe('Alice')
    expect(body.pack.division).toBe('open')
    expect(body.pack.classification).toBe('qualifier')
    expect(body.pack.acquiredAt).toBeDefined()
    expect(body.pack.statusHistory).toHaveLength(1)
    expect(body.pack.statusHistory[0].status).toBe('challenger')

    // Verify persisted to disk
    const diskState = await readPackState(tempDir)
    expect(diskState.packs).toHaveLength(1)
    expect(diskState.packs[0].id).toBe('pack-1')
  })

  test('rejects duplicate pack IDs with 409', async () => {
    const payload = {
      action: 'create',
      id: 'dup-pack',
      type: 'challenger',
      builderId: 'builder-1',
      builderName: 'Alice',
      division: 'open',
      classification: 'qualifier',
    }

    const req1 = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(201)

    const req2 = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const res2 = await POST(req2)
    expect(res2.status).toBe(409)
    const body = await res2.json()
    expect(body.error).toContain('already exists')
  })

  test('returns 400 when required fields are missing', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'missing-fields',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('returns 400 when builderId is missing', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'no-builder',
        type: 'challenger',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('defaults division and classification when omitted', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'defaults-pack',
        type: 'challenger',
        builderId: 'builder-1',
        builderName: 'Alice',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.pack.division).toBe('Unclassified')
    expect(body.pack.classification).toBe('Alpha')
  })
})

// ── POST promote tests ───────────────────────────────────────────────────

describe('POST /api/packs action=promote (file-backed)', () => {
  async function createPack(id: string) {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id,
        type: 'challenger',
        builderId: 'builder-1',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  }

  test('promotes challenger to champion', async () => {
    await createPack('promo-1')

    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote',
        packId: 'promo-1',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pack.highestStatus).toBe('champion')
    expect(body.pack.statusHistory).toHaveLength(2) // challenger + champion

    // Verify persisted
    const diskState = await readPackState(tempDir)
    const pack = diskState.packs.find(p => p.id === 'promo-1')!
    expect(pack.highestStatus).toBe('champion')
  })

  test('promotes champion to hero', async () => {
    await createPack('promo-2')

    // First promote to champion
    const promoteToChampion = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'promo-2' }),
    })
    await POST(promoteToChampion)

    // Then promote to hero
    const promoteToHero = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'promo-2' }),
    })
    const res = await POST(promoteToHero)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pack.highestStatus).toBe('hero')
    expect(body.pack.statusHistory).toHaveLength(3) // challenger + champion + hero
  })

  test('returns 400 when promoting hero (already max)', async () => {
    await createPack('promo-3')
    await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'promo-3' }),
    }))
    await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'promo-3' }),
    }))

    // Try to promote beyond hero
    const res = await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'promo-3' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('maximum status')
  })

  test('returns 400 when packId is missing', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Missing packId')
  })

  test('returns 400 for non-existent pack', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'ghost-pack' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })
})

// ── Unknown action test ──────────────────────────────────────────────────

describe('POST /api/packs unknown action', () => {
  test('returns 400 for unknown action', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nuke' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown action')
  })
})
