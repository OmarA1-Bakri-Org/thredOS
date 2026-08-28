import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeSequence, readSequence } from '@/lib/sequence/parser'
import { readApprovals } from '@/lib/approvals/repository'
import { readTraceEvents } from '@/lib/traces/reader'
import * as audit from '@/lib/audit/logger'

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

  test('POST applies reviewed chat actions without fabricating approval lifecycle records', async () => {
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
    expect(body.status).toBe('applied')
    expect(body.appliedCount).toBe(1)
    expect(body.rejectedCount).toBe(0)
    expect(body.errors).toEqual([])
    expect(body.runId).toBe(runId)

    const approvals = await readApprovals(basePath, runId)
    expect(approvals).toEqual([])

    const traces = await readTraceEvents(basePath, runId)
    expect(traces).toEqual([])

    const sequence = await readSequence(basePath)
    expect(sequence.steps.some(step => step.id === 'build')).toBe(true)

    expect(await audit.readAll(basePath)).toEqual([
      expect.objectContaining({ action: 'step add', result: 'applied' }),
    ])
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

  test('POST returns a stable failure envelope for runtime control actions and leaves sequence unchanged', async () => {
    const { POST } = await import('@/app/api/apply/route')
    const response = await POST(new Request('http://localhost/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-chat-runtime-control',
        actions: [
          {
            command: 'stop',
            args: { step_id: 'init' },
          },
        ],
      }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.status).toBe('rejected')
    expect(body.appliedCount).toBe(0)
    expect(body.rejectedCount).toBe(1)
    expect(body.runId).toBe('run-chat-runtime-control')
    expect(body.errors).toEqual([
      'Command "stop" is not available in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.',
    ])
    expect(body.results).toEqual([
      {
        action: 'stop',
        status: 'rejected',
        error: 'Command "stop" is not available in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.',
      },
    ])

    const approvals = await readApprovals(basePath, 'run-chat-runtime-control')
    expect(approvals).toEqual([])

    const traces = await readTraceEvents(basePath, 'run-chat-runtime-control')
    expect(traces).toEqual([])

    const sequence = await readSequence(basePath)
    expect(sequence.steps).toEqual([
      expect.objectContaining({
        id: 'init',
        status: 'DONE',
      }),
    ])
  })

  test('POST preserves applied actions with a status-field rejection, returns partial truth in original order, audits both outcomes, and records no approval lifecycle', async () => {
    const runId = 'run-chat-partial-status-batch'
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
          {
            command: 'step update',
            args: { id: 'init', status: 'FAILED' },
          },
        ],
      }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.status).toBe('partial')
    expect(body.appliedCount).toBe(1)
    expect(body.rejectedCount).toBe(1)
    expect(body.runId).toBe(runId)
    expect(body.errors).toEqual(['Invalid update field: status'])
    expect(body.results).toEqual([
      { action: 'step add', status: 'applied' },
      { action: 'step update', status: 'rejected', error: 'Invalid update field: status' },
    ])

    const approvals = await readApprovals(basePath, runId)
    expect(approvals).toEqual([])

    const traces = await readTraceEvents(basePath, runId)
    expect(traces).toEqual([])

    const sequence = await readSequence(basePath)
    expect(sequence.steps).toEqual([
      expect.objectContaining({ id: 'init', status: 'DONE' }),
      expect.objectContaining({ id: 'build', status: 'READY' }),
    ])

    expect(await audit.readAll(basePath)).toEqual([
      expect.objectContaining({ action: 'step add', result: 'applied' }),
      expect.objectContaining({ action: 'step update', result: 'rejected' }),
    ])
  })

  test('POST preserves applied actions with a runtime-control rejection, returns partial truth in original order, audits both outcomes, and records no approval lifecycle', async () => {
    const runId = 'run-chat-partial-runtime-batch'
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
              id: 'verify',
              name: 'Verify',
              type: 'base',
              model: 'claude-code',
              prompt_file: 'prompts/verify.md',
            },
          },
          {
            command: 'stop',
            args: { step_id: 'init' },
          },
        ],
      }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.status).toBe('partial')
    expect(body.appliedCount).toBe(1)
    expect(body.rejectedCount).toBe(1)
    expect(body.runId).toBe(runId)
    expect(body.errors).toEqual([
      'Command "stop" is not available in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.',
    ])
    expect(body.results).toEqual([
      { action: 'step add', status: 'applied' },
      {
        action: 'stop',
        status: 'rejected',
        error: 'Command "stop" is not available in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.',
      },
    ])

    const approvals = await readApprovals(basePath, runId)
    expect(approvals).toEqual([])

    const traces = await readTraceEvents(basePath, runId)
    expect(traces).toEqual([])

    const sequence = await readSequence(basePath)
    expect(sequence.steps).toEqual([
      expect.objectContaining({ id: 'init', status: 'DONE' }),
      expect.objectContaining({ id: 'verify', status: 'READY' }),
    ])

    expect(await audit.readAll(basePath)).toEqual([
      expect.objectContaining({ action: 'step add', result: 'applied' }),
      expect.objectContaining({ action: 'stop', result: 'rejected' }),
    ])
  })
})
