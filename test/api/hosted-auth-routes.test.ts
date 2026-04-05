import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import YAML from 'yaml'
import { NextRequest } from 'next/server'

let tempDir: string
let originalEnv: Record<string, string | undefined>

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'threados-hosted-auth-'))
  await mkdir(join(tempDir, '.threados'), { recursive: true })
  await writeFile(join(tempDir, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0',
    name: 'Auth Test Sequence',
    steps: [],
    gates: [],
  }))

  originalEnv = {
    THREDOS_BASE_PATH: process.env.THREDOS_BASE_PATH,
    THREADOS_BASE_PATH: process.env.THREADOS_BASE_PATH,
    THREDOS_HOSTED_MODE: process.env.THREDOS_HOSTED_MODE,
    THREADOS_HOSTED_MODE: process.env.THREADOS_HOSTED_MODE,
    THREDOS_ENABLE_THREAD_RUNNER: process.env.THREDOS_ENABLE_THREAD_RUNNER,
    THREADOS_ENABLE_THREAD_RUNNER: process.env.THREADOS_ENABLE_THREAD_RUNNER,
    THREDOS_SESSION_SECRET: process.env.THREDOS_SESSION_SECRET,
    THREADOS_SESSION_SECRET: process.env.THREADOS_SESSION_SECRET,
  }

  process.env.THREDOS_BASE_PATH = tempDir
  process.env.THREDOS_HOSTED_MODE = 'true'
  process.env.THREDOS_ENABLE_THREAD_RUNNER = 'true'
  process.env.THREDOS_SESSION_SECRET = 'test-session-secret'
  delete process.env.THREADOS_BASE_PATH
  delete process.env.THREADOS_HOSTED_MODE
  delete process.env.THREADOS_ENABLE_THREAD_RUNNER
  delete process.env.THREADOS_SESSION_SECRET
})

afterAll(async () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  delete globalThis.__THREDOS_RATE_LIMITS__
})

const { GET: getSequence, POST: postSequence } = await import('../../app/api/sequence/route')
const { GET: getAudit } = await import('../../app/api/audit/route')
const { POST: postChat } = await import('../../app/api/chat/route')
const { POST: postActivationComplete } = await import('../../app/api/desktop/activation/complete/route')
const { POST: postWorkspace } = await import('../../app/api/desktop/workspace/route')
const { GET: getThreadSurfaces } = await import('../../app/api/thread-surfaces/route')
const { GET: getThreadRuns } = await import('../../app/api/thread-runs/route')
const { GET: getThreadRunnerRace } = await import('../../app/api/thread-runner/race/route')
const { GET: getTraces } = await import('../../app/api/traces/route')
const { POST: postRun } = await import('../../app/api/run/route')
const { GET: getAgentCloudRegistration } = await import('../../app/api/agent-cloud/registration/route')
const { GET: getAgentCloudPerformance } = await import('../../app/api/agent-cloud/performance/route')
const { POST: postStop } = await import('../../app/api/stop/route')
const { createSessionToken, THREDOS_SESSION_COOKIE } = await import('../../lib/auth/session')

function makeRequest(url: string, init?: { method?: string; body?: unknown; token?: string }) {
  const headers = new Headers()
  if (init?.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (init?.token) {
    headers.set('Cookie', `${THREDOS_SESSION_COOKIE}=${init.token}`)
  }

  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    headers,
  })
}

describe('hosted route-local auth', () => {
  test('sequence GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getSequence(makeRequest('http://localhost:3000/api/sequence'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  test('sequence GET allows authenticated access in hosted mode', async () => {
    const token = createSessionToken('founder@example.com')
    const response = await getSequence(makeRequest('http://localhost:3000/api/sequence', { token }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      name: 'Auth Test Sequence',
    })
  })

  test('sequence POST rejects unauthenticated writes in hosted mode', async () => {
    const response = await postSequence(makeRequest('http://localhost:3000/api/sequence', {
      method: 'POST',
      body: { action: 'rename', name: 'Nope' },
    }))
    expect(response.status).toBe(401)
  })

  test('audit GET rejects unauthenticated reads in hosted mode', async () => {
    const response = await getAudit(makeRequest('http://localhost:3000/api/audit?limit=5'))
    expect(response.status).toBe(401)
  })

  test('chat POST rejects unauthenticated access in hosted mode', async () => {
    const response = await postChat(makeRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: { message: 'Hello from hosted mode' },
    }))
    expect(response.status).toBe(401)
  })

  test('thread surfaces GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getThreadSurfaces(makeRequest('http://localhost:3000/api/thread-surfaces'))
    expect(response.status).toBe(401)
  })

  test('thread runs GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getThreadRuns(makeRequest('http://localhost:3000/api/thread-runs'))
    expect(response.status).toBe(401)
  })

  test('traces GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getTraces(makeRequest('http://localhost:3000/api/traces?runId=run-1'))
    expect(response.status).toBe(401)
  })

  test('thread runner race GET rejects unauthenticated access in hosted mode when enabled', async () => {
    const response = await getThreadRunnerRace(makeRequest('http://localhost:3000/api/thread-runner/race'))
    expect(response.status).toBe(401)
  })

  test('run POST rejects unauthenticated execution in hosted mode', async () => {
    const response = await postRun(makeRequest('http://localhost:3000/api/run', {
      method: 'POST',
      body: { mode: 'runnable', confirmPolicy: true },
    }))
    expect(response.status).toBe(401)
  })

  test('agent-cloud registration GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getAgentCloudRegistration(makeRequest('http://localhost:3000/api/agent-cloud/registration?agentId=agent-1'))
    expect(response.status).toBe(401)
  })

  test('agent-cloud performance GET rejects unauthenticated access in hosted mode', async () => {
    const response = await getAgentCloudPerformance(makeRequest('http://localhost:3000/api/agent-cloud/performance?registrationNumber=AG-20260320-0001'))
    expect(response.status).toBe(401)
  })

  test('stop POST is blocked in hosted mode even when authenticated', async () => {
    const token = createSessionToken('founder@example.com')
    const response = await postStop(makeRequest('http://localhost:3000/api/stop', {
      method: 'POST',
      body: { stepId: 'anything' },
      token,
    }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROCESS_CONTROL_DISABLED',
    })
  })

  test('sequence POST is rate limited in hosted mode', async () => {
    const token = createSessionToken('founder@example.com')

    for (let i = 0; i < 30; i += 1) {
      const response = await postSequence(makeRequest('http://localhost:3000/api/sequence', {
        method: 'POST',
        body: { action: 'rename', name: `Renamed ${i}` },
        token,
      }))
      expect(response.status).toBe(200)
    }

    const rateLimited = await postSequence(makeRequest('http://localhost:3000/api/sequence', {
      method: 'POST',
      body: { action: 'rename', name: 'Rate limited' },
      token,
    }))
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('Retry-After')).toBeTruthy()
    await expect(rateLimited.json()).resolves.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  test('desktop workspace POST is rate limited in hosted mode', async () => {
    const token = createSessionToken('founder@example.com')

    for (let i = 0; i < 30; i += 1) {
      const response = await postWorkspace(makeRequest('http://localhost:3000/api/desktop/workspace', {
        method: 'POST',
        body: { label: `Workspace ${i}` },
        token,
      }))
      expect(response.status).toBe(200)
    }

    const rateLimited = await postWorkspace(makeRequest('http://localhost:3000/api/desktop/workspace', {
      method: 'POST',
      body: { label: 'Rate limited workspace' },
      token,
    }))
    expect(rateLimited.status).toBe(429)
    await expect(rateLimited.json()).resolves.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  test('desktop activation complete POST is rate limited in hosted mode', async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await postActivationComplete(makeRequest('http://localhost:3000/api/desktop/activation/complete', {
        method: 'POST',
        body: { token: `invalid-${i}` },
      }))
      expect(response.status).toBe(400)
    }

    const rateLimited = await postActivationComplete(makeRequest('http://localhost:3000/api/desktop/activation/complete', {
      method: 'POST',
      body: { token: 'invalid-rate-limited' },
    }))
    expect(rateLimited.status).toBe(429)
    await expect(rateLimited.json()).resolves.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })
})
