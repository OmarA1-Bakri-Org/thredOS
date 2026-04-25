import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeSequence, readSequence } from '@/lib/sequence/parser'
import { readApprovals } from '@/lib/approvals/repository'
import { readTraceEvents } from '@/lib/traces/reader'

let basePath = ''

describe.serial('apply route proof', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-apply-route-'))
    process.env.THREADOS_BASE_PATH = basePath
    await mkdir(join(basePath, '.threados'), { recursive: true })
    await writeSequence(basePath, {
      version: '1.0',
      name: 'apply-proof',
      steps: [
        {
          id: 'init',
          name: 'Init',
          type: 'base',
          model: 'claude-code',
          prompt_file: 'prompts/init.md',
          depends_on: [],
          status: 'DONE',
        },
      ],
      gates: [],
    })
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('POST records approval lifecycle and trace events for reviewed chat apply actions', async () => {
    const runId = 'run-chat-apply-proof'
    const { POST } = await import('@/app/api/apply/route')
    const response = await POST(new Request('http://localhost/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        actions: [
          {
            command: 'step add',
            args: {
              id: 'build',
              name: 'Build',
              type: 'base',
              model: 'claude-code',
              prompt_file: 'prompts/build.md',
            },
          },
        ],
      }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.runId).toBe(runId)

    const approvals = await readApprovals(basePath, runId)
    expect(approvals.map(entry => entry.status)).toEqual(['pending', 'approved'])
    expect(approvals[1]).toMatchObject({
      action_type: 'side_effect',
      requested_by: 'local@thredos',
      approved_by: 'local@thredos',
      status: 'approved',
    })
    expect(approvals[1]?.target_ref).toMatch(/^chat-apply:[a-f0-9-]+:1$/)

    const traces = await readTraceEvents(basePath, runId)
    expect(traces.map(entry => entry.event_type)).toEqual(['approval-requested', 'approval-resolved'])
    expect(traces[0]).toMatchObject({
      actor: 'api:apply',
    })
    expect(traces[0]?.surface_id).toMatch(/^chat-apply:[a-f0-9-]+:1$/)

    const sequence = await readSequence(basePath)
    expect(sequence.steps.some(step => step.id === 'build')).toBe(true)
  })

  test('POST returns 400 for invalid chat-apply payloads', async () => {
    const { POST } = await import('@/app/api/apply/route')
    const response = await POST(new Request('http://localhost/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: [] }),
    }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.errors).toEqual(expect.arrayContaining([
      'Too small: expected array to have >=1 items',
    ]))
  })
})
