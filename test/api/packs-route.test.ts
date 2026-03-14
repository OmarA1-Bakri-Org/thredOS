import { describe, test, expect } from 'bun:test'

const { GET } = await import('@/app/api/packs/route')

describe('GET /api/packs', () => {
  test('returns packs list as array', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.packs)).toBe(true)
  })

  test('returns JSON content type', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
