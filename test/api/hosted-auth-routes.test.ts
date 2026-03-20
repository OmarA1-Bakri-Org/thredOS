import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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
    THREDOS_SESSION_SECRET: process.env.THREDOS_SESSION_SECRET,
    THREADOS_SESSION_SECRET: process.env.THREADOS_SESSION_SECRET,
  }

  process.env.THREDOS_BASE_PATH = tempDir
  process.env.THREDOS_HOSTED_MODE = 'true'
  process.env.THREDOS_SESSION_SECRET = 'test-session-secret'
  delete process.env.THREADOS_BASE_PATH
  delete process.env.THREADOS_HOSTED_MODE
  delete process.env.THREADOS_SESSION_SECRET
})

afterAll(async () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempDir, { recursive: true, force: true })
})

const { GET: getSequence, POST: postSequence } = await import('../../app/api/sequence/route')
const { GET: getAudit } = await import('../../app/api/audit/route')
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
})
