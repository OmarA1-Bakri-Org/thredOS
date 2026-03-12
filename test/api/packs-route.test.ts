import { describe, test, expect } from 'bun:test'

const { GET } = await import('@/app/api/packs/route')

describe('GET /api/packs', () => {
  test('returns empty packs list by default', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.packs).toEqual([])
  })

  test('returns JSON content type', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
