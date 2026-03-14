import { describe, test, expect } from 'bun:test'

const { GET } = await import('@/app/api/thread-runner/eligibility/route')

describe('GET /api/thread-runner/eligibility', () => {
  test('returns eligibility status with all requirements locked', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eligible).toBe(false)
    expect(body.requirements).toHaveLength(3)
  })

  test('returns expected requirement structure', async () => {
    const res = await GET()
    const body = await res.json()
    for (const req of body.requirements) {
      expect(req).toHaveProperty('key')
      expect(req).toHaveProperty('label')
      expect(req).toHaveProperty('description')
      expect(req).toHaveProperty('met')
      expect(req.met).toBe(false)
    }
  })

  test('returns JSON content type', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
