import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'
import YAML from 'yaml'

let tempDir: string
let origBasePath: string | undefined

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'threados-chat-test-'))
  await mkdir(join(tempDir, '.threados'), { recursive: true })
  await writeFile(join(tempDir, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0',
    name: 'Test Sequence',
    steps: [{
      id: 'step-1',
      name: 'Step 1',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/step-1.md',
      depends_on: [],
      status: 'READY',
    }],
    gates: [],
  }))
  origBasePath = process.env.THREADOS_BASE_PATH
  process.env.THREADOS_BASE_PATH = tempDir
})

afterAll(async () => {
  if (origBasePath !== undefined) {
    process.env.THREADOS_BASE_PATH = origBasePath
  } else {
    delete process.env.THREADOS_BASE_PATH
  }
  await rm(tempDir, { recursive: true, force: true })
})

const { POST } = await import('./route')

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function readSSE(response: Response): Promise<string> {
  const text = await response.text()
  return text
}

describe('POST /api/chat', () => {
  test('returns 400 when message is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('message is required')
  })

  test('returns 400 when message is not a string', async () => {
    const res = await POST(makeRequest({ message: 42 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('message is required')
  })

  test('returns 400 when message exceeds max length', async () => {
    const res = await POST(makeRequest({ message: 'x'.repeat(10_001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('exceeds maximum length')
  })

  test('returns SSE stream with message, actions, done events', async () => {
    const res = await POST(makeRequest({ message: 'Hello agent' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await readSSE(res)
    expect(text).toContain('"type":"message"')
    expect(text).toContain('"type":"actions"')
    expect(text).toContain('"type":"done"')
    expect(text).toContain('Hello agent')
    expect(text).toContain('1 steps')
  })

  test('sanitizes angle brackets and quotes from user input', async () => {
    const res = await POST(makeRequest({ message: '<script>"alert"</script>' }))
    const text = await readSSE(res)
    expect(text).not.toContain('<script>')
    expect(text).not.toContain('"alert"')
  })
})
