import { describe, expect, test } from 'bun:test'
import type { Sequence, Step } from '@/lib/sequence/schema'
import type { AgentRegistration } from '../agents/types'
import { deriveSpawnSpecsForStep } from './spawn-runtime'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'base-step',
    name: 'Base step',
    type: 'base',
    model: 'codex',
    prompt_file: '.threados/prompts/base-step.md',
    depends_on: [],
    status: 'READY',
    ...overrides,
  }
}

function makeSequence(steps: Step[]): Sequence {
  return {
    version: '1.0',
    name: 'Spawn Sequence',
    steps,
    gates: [],
  }
}

function makeAgent(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    id: 'agt-test',
    name: 'Test Agent',
    registeredAt: '2026-03-14T00:00:00.000Z',
    builderId: 'omar',
    builderName: 'Omar',
    threadSurfaceIds: [],
    ...overrides,
  }
}

const spawnAgent = makeAgent({
  id: 'agt-spawner',
  metadata: { skills: [{ id: 'spawn', label: 'Spawn', inherited: false }] },
})

describe('deriveSpawnSpecsForStep', () => {
  test('orchestrator steps create child spawn specs only for delegated workers', () => {
    const orchestrator = makeStep({
      id: 'orch-orchestrator',
      name: 'Orchestrator',
      type: 'b',
      orchestrator: 'orch-orchestrator',
    })
    const workerA = makeStep({
      id: 'orch-worker-1',
      name: 'Worker 1',
      type: 'b',
      depends_on: ['orch-orchestrator'],
      orchestrator: 'orch-orchestrator',
    })
    const workerB = makeStep({
      id: 'orch-worker-2',
      name: 'Worker 2',
      type: 'b',
      depends_on: ['orch-orchestrator'],
      orchestrator: 'orch-orchestrator',
    })
    const unrelated = makeStep({
      id: 'other-step',
      name: 'Other step',
      type: 'base',
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([orchestrator, workerA, workerB, unrelated]),
      step: orchestrator,
      agent: spawnAgent,
    })

    expect(specs).toEqual([
      expect.objectContaining({
        parentThreadSurfaceId: 'thread-orch-orchestrator',
        childThreadSurfaceId: 'thread-orch-worker-1',
        parentAgentNodeId: 'orch-orchestrator',
        childAgentNodeId: 'orch-worker-1',
      }),
      expect.objectContaining({
        parentThreadSurfaceId: 'thread-orch-orchestrator',
        childThreadSurfaceId: 'thread-orch-worker-2',
        parentAgentNodeId: 'orch-orchestrator',
        childAgentNodeId: 'orch-worker-2',
      }),
    ])
  })

  test('watchdog steps create a dedicated watchdog child spawn tied to the watched thread', () => {
    const main = makeStep({
      id: 'long-main',
      name: 'Main',
      type: 'l',
    })
    const watchdog = makeStep({
      id: 'long-watchdog',
      name: 'Watchdog',
      type: 'l',
      watchdog_for: 'long-main',
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([main, watchdog]),
      step: watchdog,
      agent: spawnAgent,
    })

    expect(specs).toEqual([
      expect.objectContaining({
        parentThreadSurfaceId: 'thread-long-main',
        childThreadSurfaceId: 'thread-long-watchdog',
        parentAgentNodeId: 'long-main',
        childAgentNodeId: 'long-watchdog',
        spawnKind: 'watchdog',
      }),
    ])
  })

  test('plain steps with no delegation metadata produce no spawn specs', () => {
    const step = makeStep({
      id: 'solo-step',
      name: 'Solo step',
      type: 'base',
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([step]),
      step,
      agent: null,
    })

    expect(specs).toEqual([])
  })

  test('fanout metadata expands to ordered child spawn specs', () => {
    const fanoutStep = makeStep({
      id: 'fanout-step',
      name: 'Fanout step',
      type: 'b',
      fanout: 3,
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([fanoutStep]),
      step: fanoutStep,
      agent: spawnAgent,
    })

    expect(specs).toEqual([
      expect.objectContaining({
        childThreadSurfaceId: 'thread-fanout-step-fanout-1',
        childAgentNodeId: 'fanout-step-fanout-1',
        order: 1,
        spawnKind: 'fanout',
      }),
      expect.objectContaining({
        childThreadSurfaceId: 'thread-fanout-step-fanout-2',
        childAgentNodeId: 'fanout-step-fanout-2',
        order: 2,
        spawnKind: 'fanout',
      }),
      expect.objectContaining({
        childThreadSurfaceId: 'thread-fanout-step-fanout-3',
        childAgentNodeId: 'fanout-step-fanout-3',
        order: 3,
        spawnKind: 'fanout',
      }),
    ])
  })

  test('returns empty when agent lacks spawn skill', () => {
    const orchestrator = makeStep({
      id: 'orch-orchestrator',
      name: 'Orchestrator',
      type: 'b',
      orchestrator: 'orch-orchestrator',
    })
    const worker = makeStep({
      id: 'orch-worker-1',
      name: 'Worker 1',
      type: 'b',
      depends_on: ['orch-orchestrator'],
      orchestrator: 'orch-orchestrator',
    })
    const agent = makeAgent({
      id: 'agt-no-spawn',
      metadata: { skills: [{ id: 'search', label: 'Search', inherited: false }] },
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([orchestrator, worker]),
      step: orchestrator,
      agent,
    })

    expect(specs).toEqual([])
  })

  test('returns specs when agent has spawn skill', () => {
    const orchestrator = makeStep({
      id: 'orch-orchestrator',
      name: 'Orchestrator',
      type: 'b',
      orchestrator: 'orch-orchestrator',
    })
    const worker = makeStep({
      id: 'orch-worker-1',
      name: 'Worker 1',
      type: 'b',
      depends_on: ['orch-orchestrator'],
      orchestrator: 'orch-orchestrator',
    })

    const specs = deriveSpawnSpecsForStep({
      sequence: makeSequence([orchestrator, worker]),
      step: orchestrator,
      agent: spawnAgent,
    })

    expect(specs).toHaveLength(1)
    expect(specs[0]).toEqual(expect.objectContaining({
      childAgentNodeId: 'orch-worker-1',
      spawnKind: 'orchestrator',
    }))
  })
})
