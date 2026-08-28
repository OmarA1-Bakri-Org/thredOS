import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { NextRequest } from 'next/server'
import YAML from 'yaml'

let tempDir: string
let origBasePath: string | undefined
let origOpenAiKey: string | undefined
let origOpenRouterKey: string | undefined

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
  origOpenAiKey = process.env.OPENAI_API_KEY
  origOpenRouterKey = process.env.OPENROUTER_API_KEY
  process.env.THREADOS_BASE_PATH = tempDir
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY
})

afterAll(async () => {
  if (origBasePath !== undefined) {
    process.env.THREADOS_BASE_PATH = origBasePath
  } else {
    delete process.env.THREADOS_BASE_PATH
  }
  if (origOpenAiKey !== undefined) process.env.OPENAI_API_KEY = origOpenAiKey
  else delete process.env.OPENAI_API_KEY
  if (origOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = origOpenRouterKey
  else delete process.env.OPENROUTER_API_KEY
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

function makeRawRequest(body: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function readSSE(response: Response): Promise<string> {
  const text = await response.text()
  return text
}

function runIsolatedChatRouteCheck(script: string) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15000,
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Subprocess exited with code ${result.status}`)
  }

  return JSON.parse(result.stdout.trim()) as { status: number; text: string }
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

  test('returns 400 when request body is not valid JSON', async () => {
    const res = await POST(makeRawRequest('{not-json'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid JSON body')
  })

  test('returns 400 when model is not a string', async () => {
    const res = await POST(makeRequest({ message: 'Hello agent', model: 42 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('model must be a string')
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

  test('plain-text fallback emits only allowed mutation actions', () => {
    const result = runIsolatedChatRouteCheck(`
      import { mock } from 'bun:test'
      import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
      import { rm } from 'fs/promises'
      import { tmpdir } from 'os'
      import { join } from 'path'
      import YAML from 'yaml'
      import { NextRequest } from 'next/server'

      const tempDir = mkdtempSync(join(tmpdir(), 'threados-chat-fallback-'))
      mkdirSync(join(tempDir, '.threados'), { recursive: true })
      writeFileSync(join(tempDir, '.threados', 'sequence.yaml'), YAML.stringify({
        version: '1.0',
        name: 'Fallback Sequence',
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

      process.env.THREADOS_BASE_PATH = tempDir
      process.env.THREADOS_MODEL = 'gpt-5'
      const fallbackContent = ${JSON.stringify('```json\n[{"command":"run","args":{}},{"command":"step add","args":"bad"},{"command":"dep add","args":{"from":"step-1","to":"step-2"}}]\n```')}

      mock.module('@/lib/llm/providers', () => ({
          createConfiguredProvider: () => ({
            client: {
              chat: {
                completions: {
                  create: (options: { tools?: unknown }) => {
                    if (options.tools) {
                      throw new Error('tool use unavailable')
                    }
                    return (async function* () {
                      yield {
                        choices: [{
                          delta: {
                            content: fallbackContent,
                          },
                        }],
                      }
                    })()
                  },
                },
              },
            },
            defaultModel: 'gpt-5',
            config: { defaultModel: 'gpt-5' },
          }),
          getConfiguredModel: () => 'gpt-5',
      }))

      try {
        const { POST } = await import('./app/api/chat/route.ts?chat-fallback-filter')
        const response = await POST(new NextRequest('http://localhost:3000/api/chat', {
          method: 'POST',
          body: JSON.stringify({ message: 'Suggest a change' }),
          headers: { 'Content-Type': 'application/json' },
        }))
        console.log(JSON.stringify({ status: response.status, text: await response.text() }))
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    `)

    expect(result.status).toBe(200)
    expect(result.text).toContain('"type":"actions"')
    expect(result.text).toContain('"command":"dep add"')
    expect(result.text).not.toContain('"command":"run"')
    expect(result.text).not.toContain('"command":"step add"')
    expect(result.text).toContain('"actions":[{"command":"dep add","args":{"from":"step-1","to":"step-2"}}]')
  })
})
