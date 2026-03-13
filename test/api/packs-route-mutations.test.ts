import { describe, test, expect } from 'bun:test'

/**
 * Tests for POST and PATCH on /api/packs route.
 *
 * The route uses an in-memory PackRepository at module level,
 * so we test against it directly without mocking.
 */

const { POST, PATCH } = await import('@/app/api/packs/route')

// ── POST tests ──────────────────────────────────────────────────────────

describe('POST /api/packs', () => {
  test('creates a new pack with correct fields', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pack-post-test-1',
        type: 'challenger',
        builderId: 'builder-1',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pack).toBeDefined()
    expect(body.pack.id).toBe('pack-post-test-1')
    expect(body.pack.type).toBe('challenger')
    expect(body.pack.builderId).toBe('builder-1')
    expect(body.pack.builderName).toBe('Alice')
    expect(body.pack.division).toBe('open')
    expect(body.pack.classification).toBe('qualifier')
    expect(body.pack.highestStatus).toBe('challenger')
    expect(body.pack.statusHistory).toEqual([])
    expect(body.pack.acquiredAt).toBeDefined()
  })

  test('returns 400 for missing required fields', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'pack-incomplete' }),
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
        type: 'challenger',
        builderName: 'Alice',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('auto-generates id when not provided', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'champion',
        builderId: 'builder-2',
        builderName: 'Bob',
        division: 'elite',
        classification: 'finals',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pack.id).toBeDefined()
    expect(typeof body.pack.id).toBe('string')
    expect(body.pack.id.length).toBeGreaterThan(0)
  })
})

// ── PATCH tests ─────────────────────────────────────────────────────────

describe('PATCH /api/packs', () => {
  test('promotes pack status successfully (challenger → champion)', async () => {
    // First create a pack to promote
    const createReq = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pack-promote-test',
        type: 'challenger',
        builderId: 'builder-3',
        builderName: 'Charlie',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    const createRes = await POST(createReq)
    expect(createRes.status).toBe(200)

    // Now promote
    const patchReq = new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-promote-test',
        newStatus: 'champion',
        context: 'Won qualifier race',
      }),
    })
    const res = await PATCH(patchReq)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pack.highestStatus).toBe('champion')
    expect(body.pack.statusHistory).toHaveLength(1)
  })

  test('returns 400 for non-existent pack', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-nonexistent-xyz',
        newStatus: 'champion',
        context: 'Nope',
      }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('returns 400 for invalid status transition (hero → challenger)', async () => {
    // Create a challenger, promote to champion, then to hero
    const createReq = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pack-hero-downgrade-test',
        type: 'challenger',
        builderId: 'builder-4',
        builderName: 'Diana',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    await POST(createReq)

    // Promote to champion
    await PATCH(new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-hero-downgrade-test',
        newStatus: 'champion',
        context: 'Won qualifier',
      }),
    }))

    // Promote to hero
    await PATCH(new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-hero-downgrade-test',
        newStatus: 'hero',
        context: 'Won finals',
      }),
    }))

    // Try to downgrade hero → challenger
    const downgradeReq = new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-hero-downgrade-test',
        newStatus: 'challenger',
        context: 'Downgrade attempt',
      }),
    })
    const res = await PATCH(downgradeReq)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('cannot be promoted')
  })

  test('returns 400 when required fields are missing', async () => {
    const req = new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: 'some-pack' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  test('returns 400 for same-status promotion (champion → champion)', async () => {
    // Create and promote to champion
    const createReq = new Request('http://localhost/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pack-same-status-test',
        type: 'challenger',
        builderId: 'builder-5',
        builderName: 'Eve',
        division: 'open',
        classification: 'qualifier',
      }),
    })
    await POST(createReq)

    await PATCH(new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-same-status-test',
        newStatus: 'champion',
        context: 'Won qualifier',
      }),
    }))

    // Try same status again
    const res = await PATCH(new Request('http://localhost/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-same-status-test',
        newStatus: 'champion',
        context: 'Again',
      }),
    }))
    expect(res.status).toBe(400)
  })
})
