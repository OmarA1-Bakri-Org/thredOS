import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import YAML from 'yaml'
import { eventCommand } from '@/lib/seqctl/commands/event'
import type { ThreadSurfaceState } from '@/lib/thread-surfaces/repository'

let basePath = ''
let runtimeEventLinesByStep: Record<string, string[]> = {}
let runtimeEmitterCommandsByStep: Record<string, { subcommand: string; args: string[] }> = {}
let capturedDispatchPrompt = ''
let capturedDispatchEmitter = ''

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

async function emitRuntimeEventWithCommand(
  command: string | undefined,
  logPath: string | undefined,
  subcommand: string,
  args: string[],
) {
  expect(command).toBe('thread event')
  expect(logPath).toBeTruthy()

  const previousLogPath = process.env.THREADOS_EVENT_LOG
  try {
    process.env.THREADOS_EVENT_LOG = logPath
    await eventCommand(subcommand, args, { json: false, help: false, watch: false })
  } finally {
    if (previousLogPath == null) {
      delete process.env.THREADOS_EVENT_LOG
    } else {
      process.env.THREADOS_EVENT_LOG = previousLogPath
    }
  }
}

describe('thread runtime event persistence', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-events-'))
    runtimeEventLinesByStep = {}
    runtimeEmitterCommandsByStep = {}
    capturedDispatchPrompt = ''
    capturedDispatchEmitter = ''
    process.env.THREADOS_BASE_PATH = basePath
    globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ = {
      dispatch: async (_model: string, opts: {
        stepId: string
        runId: string
        compiledPrompt: string
        cwd: string
        timeout: number
        runtimeEventLogPath?: string
        runtimeEventEmitterCommand?: string
      }) => {
        capturedDispatchPrompt = opts.compiledPrompt
        capturedDispatchEmitter = opts.runtimeEventEmitterCommand ?? ''
        return {
          stepId: opts.stepId,
          runId: opts.runId,
          command: 'mock-agent',
          args: [],
          cwd: opts.cwd,
          timeout: opts.timeout,
          env: {
            THREADOS_EVENT_LOG: opts.runtimeEventLogPath ?? '',
            THREADOS_EVENT_EMITTER: opts.runtimeEventEmitterCommand ?? '',
          },
        }
      },
      runStep: async ({
        stepId,
        runId,
        env,
      }: {
        stepId: string
        runId: string
        env?: Record<string, string>
      }) => {
        const eventLogPath = env?.THREADOS_EVENT_LOG
        const lines = runtimeEventLinesByStep[stepId] ?? []
        if (eventLogPath && lines.length > 0) {
          await mkdir(dirname(eventLogPath), { recursive: true })
          await writeFile(eventLogPath, `${lines.join('\n')}\n`, 'utf-8')
        }
        const emitterCommand = runtimeEmitterCommandsByStep[stepId]
        if (eventLogPath && emitterCommand) {
          await emitRuntimeEventWithCommand(
            env?.THREADOS_EVENT_EMITTER,
            eventLogPath,
            emitterCommand.subcommand,
            emitterCommand.args,
          )
        }

        return {
          stepId,
          runId,
          exitCode: 0,
          status: 'SUCCESS',
          duration: 15,
          stdout: `ok:${stepId}`,
          stderr: '',
          startTime: new Date('2026-03-09T12:00:00.000Z'),
          endTime: new Date('2026-03-09T12:00:15.000Z'),
        }
      },
      saveRunArtifacts: async () => join(basePath, '.threados', 'runs', 'mock'),
    }
  })

  afterEach(async () => {
    delete globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('plain steps do not create child thread surfaces when no delegation metadata exists', async () => {
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
    expect(state.threadSurfaces).toEqual([
      expect.objectContaining({
        id: 'thread-root',
        childSurfaceIds: [],
      }),
    ])
    expect(state.runs).toEqual([
      expect.objectContaining({
        threadSurfaceId: 'thread-root',
        runStatus: 'successful',
      }),
    ])
    expect(state.runEvents).toEqual([])
  })

  test('api runs compile prompts with runtime emitter guidance for model-backed steps', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Compiled Prompt Sequence',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'b',
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
    expect(capturedDispatchEmitter).toBe('thread event')
    expect(capturedDispatchPrompt).toContain('THREADOS_EVENT_EMITTER')
    expect(capturedDispatchPrompt).toContain('thread event spawn-child')
    expect(capturedDispatchPrompt).toContain('thread event merge-into')
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
        },
      ],
      gates: [],
    })
    await writePrompt('candidate-a')
    await writePrompt('candidate-b')
    await writePrompt('fusion-synth')
    runtimeEventLinesByStep['fusion-synth'] = [
      JSON.stringify({
        eventType: 'merge-into',
        createdAt: '2026-03-09T12:00:05.000Z',
        destinationStepId: 'fusion-synth',
        sourceStepIds: ['candidate-a', 'candidate-b'],
        mergeKind: 'block',
        summary: 'Fusion runtime merge',
      }),
    ]
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
        {
          id: 'thread-fusion-synth',
          parentSurfaceId: 'thread-root',
          parentAgentNodeId: 'fusion-synth',
          depth: 1,
          surfaceLabel: 'Fusion Synth',
          createdAt: '2026-03-09T12:00:03.000Z',
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
        {
          id: 'run-fusion-seed',
          threadSurfaceId: 'thread-fusion-synth',
          runStatus: 'successful',
          startedAt: '2026-03-09T12:00:03.000Z',
          endedAt: '2026-03-09T12:00:15.000Z',
          executionIndex: 4,
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

  test('runtime event emitter command can record merge-into events through the api run path', async () => {
    await setupSequence({
      version: '1.0',
      name: 'Emitter Merge Runtime',
      steps: [
        {
          id: 'candidate-a',
          name: 'Candidate A',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/candidate-a.md',
          depends_on: [],
          status: 'DONE',
        },
        {
          id: 'candidate-b',
          name: 'Candidate B',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/candidate-b.md',
          depends_on: [],
          status: 'DONE',
        },
        {
          id: 'fusion-synth',
          name: 'Fusion Synth',
          type: 'f',
          model: 'codex',
          prompt_file: '.threados/prompts/fusion-synth.md',
          depends_on: ['candidate-a', 'candidate-b'],
          status: 'READY',
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
          surfaceLabel: 'Emitter Merge Runtime',
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
    runtimeEmitterCommandsByStep['fusion-synth'] = {
      subcommand: 'merge-into',
      args: ['fusion-synth', '--sources', 'candidate-a,candidate-b', '--kind', 'block', '--summary', 'Emitter merge'],
    }

    const { POST } = await import('@/app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'fusion-synth' }),
    }))

    expect(response.status).toBe(200)
    expect(capturedDispatchEmitter).toBe('thread event')

    const state = await readThreadSurfaceState()
    expect(state.mergeEvents).toEqual([
      expect.objectContaining({
        destinationThreadSurfaceId: 'thread-fusion-synth',
        sourceThreadSurfaceIds: ['thread-candidate-a', 'thread-candidate-b'],
        mergeKind: 'block',
        summary: 'Emitter merge',
      }),
    ])
  })
})
