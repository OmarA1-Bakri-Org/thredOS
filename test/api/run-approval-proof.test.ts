import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { readApprovals } from '@/lib/approvals/repository'
import { readTraceEvents } from '@/lib/traces/reader'

let basePath = ''

async function setupSequence(seq: object) {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify(seq))
}

async function writePrompt(stepId: string, content = `# ${stepId}`) {
  await writeFile(join(basePath, '.threados', 'prompts', `${stepId}.md`), content)
}

function createMockRuntime() {
  return {
    dispatch: async (_model: string, opts: { stepId: string; runId: string; cwd: string; timeout: number }) => ({
      stepId: opts.stepId,
      runId: opts.runId,
      command: 'mock-agent',
      args: [],
      cwd: opts.cwd,
      timeout: opts.timeout,
      env: {},
    }),
    runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
      stepId,
      runId,
      exitCode: 0,
      status: 'SUCCESS' as const,
      duration: 10,
      stdout: 'ok',
      stderr: '',
      startTime: new Date('2026-03-10T10:00:00.000Z'),
      endTime: new Date('2026-03-10T10:00:10.000Z'),
    }),
    saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
  }
}

describe.serial('run route approval proof', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-run-approval-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = createMockRuntime()
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('confirmed SAFE run records approval lifecycle and trace events', async () => {
    await setupSequence({
      version: '1.0',
      name: 'approval-proof-seq',
      steps: [
        { id: 'step-safe', name: 'Safe Step', type: 'base', model: 'codex', prompt_file: '.threados/prompts/step-safe.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('step-safe')

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-safe', confirmPolicy: true }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)

    const approvals = await readApprovals(basePath, body.runId)
    expect(approvals.map(entry => entry.status)).toEqual(['pending', 'approved'])
    expect(approvals[1]).toMatchObject({
      action_type: 'run',
      target_ref: 'step:step-safe',
      requested_by: 'local@thredos',
      approved_by: 'local@thredos',
      status: 'approved',
    })

    const traces = await readTraceEvents(basePath, body.runId)
    expect(traces.map(entry => entry.event_type)).toEqual(['approval-requested', 'approval-resolved'])
    expect(traces[0]).toMatchObject({
      actor: 'api:run',
      surface_id: 'step:step-safe',
    })
  })

  test('POWER mode run skips SAFE approval recording', async () => {
    await mkdir(join(basePath, '.threados'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({ mode: 'POWER' }))
    await setupSequence({
      version: '1.0',
      name: 'power-proof-seq',
      steps: [
        { id: 'step-power', name: 'Power Step', type: 'base', model: 'codex', prompt_file: '.threados/prompts/step-power.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })
    await writePrompt('step-power')

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-power', confirmPolicy: true }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    await expect(readApprovals(basePath, body.runId)).resolves.toEqual([])
    await expect(readTraceEvents(basePath, body.runId)).resolves.toEqual([])
  })
})
