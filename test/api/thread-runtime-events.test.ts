import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import type { ThreadSurfaceState } from '@/lib/thread-surfaces/repository'

let basePath = ''

async function setupSequence(sequence: object) {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify(sequence))
}

async function writePrompt(stepId: string) {
  await writeFile(join(basePath, '.threados', 'prompts', `${stepId}.md`), `# ${stepId}`)
}

async function writeThreadSurfaceState(state: ThreadSurfaceState) {
  await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'state', 'thread-surfaces.json'), JSON.stringify(state, null, 2))
}

async function readThreadSurfaceState(): Promise<ThreadSurfaceState> {
  const content = await readFile(join(basePath, '.threados', 'state', 'thread-surfaces.json'), 'utf-8')
  return JSON.parse(content) as ThreadSurfaceState
}

describe('thread runtime event persistence', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-events-'))
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      runStep: async ({ stepId, runId }: { stepId: string; runId: string }) => ({
        stepId,
        runId,
        exitCode: 0,
        status: 'SUCCESS',
        duration: 15,
        stdout: `ok:${stepId}`,
        stderr: '',
        startTime: new Date('2026-03-09T12:00:00.000Z'),
        endTime: new Date('2026-03-09T12:00:15.000Z'),
      }),
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
    }
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('run step creates a child thread surface and child run beneath the root surface', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Runtime Sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/step-a.md',
          depends_on: [],
          status: 'READY',
        },
      ],
      gates: [],
    })
    await writePrompt('step-a')

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-root',
          childSurfaceIds: ['thread-step-a'],
        }),
        expect.objectContaining({
          id: 'thread-step-a',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'step-a',
          surfaceLabel: 'Step A',
        }),
      ]),
    )
    expect(state.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
        }),
        expect.objectContaining({
          threadSurfaceId: 'thread-step-a',
          runStatus: 'successful',
        }),
      ]),
    )
  })

  test('worker step nests beneath its orchestrator thread surface when that parent exists', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Orchestrated Sequence',
      steps: [
        {
          id: 'orch-orchestrator',
          name: 'Main Orchestrator',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-orchestrator.md',
          depends_on: [],
          status: 'DONE',
          orchestrator: 'orch-orchestrator',
        },
        {
          id: 'orch-worker-1',
          name: 'Worker 1',
          type: 'b',
          model: 'codex',
          prompt_file: '.threados/prompts/orch-worker-1.md',
          depends_on: ['orch-orchestrator'],
          status: 'READY',
          orchestrator: 'orch-orchestrator',
        },
      ],
      gates: [],
    })
    await writePrompt('orch-orchestrator')
    await writePrompt('orch-worker-1')
    await writeThreadSurfaceState({
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Orchestrated Sequence',
          createdAt: '2026-03-09T12:00:00.000Z',
          childSurfaceIds: ['thread-orch-orchestrator'],
        },
        {
          id: 'thread-orch-orchestrator',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'orch-orchestrator',
          depth: 1,
          surfaceLabel: 'Main Orchestrator',
          createdAt: '2026-03-09T12:00:01.000Z',
          childSurfaceIds: [],
        },
      ],
      runs: [
        {
          id: 'run-root-seed',
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:00.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 1,
        },
        {
          id: 'run-orchestrator-seed',
          threadSurfaceId: 'thread-orch-orchestrator',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:01.000Z',
          endedAt: '2026-03-09T12:00:16.000Z',
          executionIndex: 2,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'orch-worker-1' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.threadSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-orch-worker-1',
          parentSurfaceId: 'thread-orch-orchestrator',
          parentAgentNodeId: 'orch-worker-1',
        }),
      ]),
    )
  })

  test('successful fusion synth step records a merge event using dependency order as source order', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Fusion Runtime',
      steps: [
        {
          id: 'candidate-a',
          name: 'Candidate A',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/candidate-a.md',
          depends_on: [],
          status: 'DONE',
          fusion_candidates: true,
        },
        {
          id: 'candidate-b',
          name: 'Candidate B',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/candidate-b.md',
          depends_on: [],
          status: 'DONE',
          fusion_candidates: true,
        },
        {
          id: 'fusion-synth',
          name: 'Fusion Synth',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/fusion-synth.md',
          depends_on: ['candidate-a', 'candidate-b'],
          status: 'READY',
          fusion_synth: true,
        },
      ],
      gates: [],
    })
    await writePrompt('candidate-a')
    await writePrompt('candidate-b')
    await writePrompt('fusion-synth')
    await writeThreadSurfaceState({
      version: 1,
      threadSurfaces: [
        {
          id: 'thread-root',
          parentSurfaceId: null,
          parentAgentNodeId: null,
          depth: 0,
          surfaceLabel: 'Fusion Runtime',
          createdAt: '2026-03-09T12:00:00.000Z',
          childSurfaceIds: ['thread-candidate-a', 'thread-candidate-b'],
        },
        {
          id: 'thread-candidate-a',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'candidate-a',
          depth: 1,
          surfaceLabel: 'Candidate A',
          createdAt: '2026-03-09T12:00:01.000Z',
          childSurfaceIds: [],
        },
        {
          id: 'thread-candidate-b',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'candidate-b',
          depth: 1,
          surfaceLabel: 'Candidate B',
          createdAt: '2026-03-09T12:00:02.000Z',
          childSurfaceIds: [],
        },
      ],
      runs: [
        {
          id: 'run-root-seed',
          threadSurfaceId: 'thread-root',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:00.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 1,
        },
        {
          id: 'run-candidate-a',
          threadSurfaceId: 'thread-candidate-a',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:01.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 2,
        },
        {
          id: 'run-candidate-b',
          threadSurfaceId: 'thread-candidate-b',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:02.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 3,
        },
      ],
      mergeEvents: [],
      runEvents: [],
    })

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'fusion-synth' }),
    }))

    expect(response.status).toBe(200)

    const state = await readThreadSurfaceState()
    expect(state.mergeEvents).toEqual([
      expect.objectContaining({
        destinationThreadSurfaceId: 'thread-fusion-synth',
        sourceThreadSurfaceIds: ['thread-candidate-a', 'thread-candidate-b'],
        mergeKind: 'block',
      }),
    ])
  })
})
