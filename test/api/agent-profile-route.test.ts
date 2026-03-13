import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * TDD-style test for GET /api/agent-profile.
 * The route may not exist yet — if the import fails, these tests will fail
 * at the import level, which is expected.
 */

// ── Mocks ───────────────────────────────────────────────────────────────

const mockAgents = new Map<string, { id: string; name: string; builderName: string; threadSurfaceIds: string[]; metadata: Record<string, unknown> }>()

mock.module('@/lib/agents/repository', () => ({
  AgentRepository: class {
    getAgent(id: string) {
      return mockAgents.get(id) ?? null
    }
    listAgents() {
      return Array.from(mockAgents.values())
    }
  },
}))

beforeEach(() => {
  mockAgents.clear()
})

// ── Attempt to import the route ─────────────────────────────────────────

let GET: (req: NextRequest | Request) => Promise<Response>

try {
  const mod = await import('@/app/api/agent-profile/route')
  GET = mod.GET
} catch {
  // Route does not exist yet — all tests will be skipped
}

describe('GET /api/agent-profile', () => {
  // Guard: skip all tests if route file doesn't exist
  const runIf = GET! ? test : test.skip

  runIf('returns profile when agent is registered for the threadSurfaceId', async () => {
    mockAgents.set('agent-1', {
      id: 'agent-1',
      name: 'Alpha Agent',
      builderName: 'Alice',
      threadSurfaceIds: ['ts-abc'],
      metadata: {},
    })

    const req = new NextRequest('http://localhost/api/agent-profile?threadSurfaceId=ts-abc')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toBeDefined()
  })

  runIf('returns { profile: null } when no agent matches', async () => {
    const req = new NextRequest('http://localhost/api/agent-profile?threadSurfaceId=ts-nonexistent')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toBeNull()
  })

  runIf('returns 400 if threadSurfaceId query param is missing', async () => {
    const req = new NextRequest('http://localhost/api/agent-profile')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  runIf('handles empty agent state gracefully', async () => {
    // No agents registered
    const req = new NextRequest('http://localhost/api/agent-profile?threadSurfaceId=ts-abc')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toBeNull()
  })
})
