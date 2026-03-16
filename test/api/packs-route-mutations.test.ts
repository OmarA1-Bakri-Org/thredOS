import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PackState } from '@/lib/packs/repository'

/**
 * Tests for POST actions (create / promote) on /api/packs route.
 *
 * The route is file-backed via `.threados/state/packs.json`.
 * Each test gets a fresh temp directory.
 */

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'packs-mut-test-'))
  const stateDir = join(tempDir, '.threados', 'state')
  await mkdir(stateDir, { recursive: true })
  const emptyState: PackState = { version: 1, packs: [] }
  await writeFile(join(stateDir, 'packs.json'), JSON.stringify(emptyState, null, 2))
  process.env.THREADOS_BASE_PATH = tempDir
})

afterEach(async () => {
  delete process.env.THREADOS_BASE_PATH
  await rm(tempDir, { recursive: true, force: true })
})

const { POST } = await import('@/app/api/packs/route')

// ── POST create tests ────────────────────────────────────────────────────

describe('POST /api/packs (create)', () => {
  test('creates a new pack with correct fields', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'pack-post-test-1',
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
    expect(body.pack.id).toBe('pack-post-test-1')
    expect(body.pack.type).toBe('challenger')
    expect(body.pack.builderId).toBe('builder-1')
    expect(body.pack.builderName).toBe('Alice')
    expect(body.pack.division).toBe('open')
    expect(body.pack.classification).toBe('qualifier')
    expect(body.pack.highestStatus).toBe('challenger')
    expect(body.pack.statusHistory).toHaveLength(1)
    expect(body.pack.acquiredAt).toBeDefined()
  })

  test('returns 400 for missing required fields', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', id: 'pack-incomplete' }),
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
        type: 'challenger',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('defaults division and classification when not provided', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id: 'pack-defaults',
        type: 'champion',
        builderId: 'builder-2',
        builderName: 'Bob',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.pack.id).toBeDefined()
    expect(body.pack.division).toBe('Unclassified')
    expect(body.pack.classification).toBe('Alpha')
  })
})

// ── POST promote tests ──────────────────────────────────────────────────

describe('POST /api/packs (promote)', () => {
  async function createPack(id: string) {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        id,
        type: 'challenger',
        builderId: 'builder-3',
        builderName: 'Charlie',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  }

  test('promotes pack status successfully (challenger to champion)', async () => {
    await createPack('pack-promote-test')

    const promoteReq = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote',
        packId: 'pack-promote-test',
      }),
    })
    const res = await POST(promoteReq)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pack.highestStatus).toBe('champion')
    expect(body.pack.statusHistory).toHaveLength(2)
  })

  test('returns 400 for non-existent pack', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote',
        packId: 'pack-nonexistent-xyz',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('returns 400 when hero tries to promote beyond max', async () => {
    await createPack('pack-hero-test')

    // Promote challenger -> champion
    await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'pack-hero-test' }),
    }))

    // Promote champion -> hero
    await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'pack-hero-test' }),
    }))

    // Try to promote hero -> ???
    const res = await POST(new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', packId: 'pack-hero-test' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('maximum status')
  })

  test('returns 400 when required fields are missing', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
