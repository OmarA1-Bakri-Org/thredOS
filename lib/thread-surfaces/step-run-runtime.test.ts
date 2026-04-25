import { describe, expect, test } from 'bun:test'
import type { Step } from '@/lib/sequence/schema'
import { emptyThreadSurfaceState, createRootThreadSurfaceRun, createChildThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
import { beginStepRunIfSurfaceExists, finalizeStepRunWithRuntimeEvents } from '@/lib/thread-surfaces/step-run-runtime'
import type { RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'
import type { AgentRegistration } from '../agents/types'

function buildStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-a',
    name: 'Step A',
    type: 'base',
    model: 'codex',
    prompt_file: '.threados/prompts/step-a.md',
    depends_on: [],
    status: 'READY',
    ...overrides,
  }
}

describe('step run runtime helpers', () => {
  const spawnAgent: AgentRegistration = {
    id: 'agt-spawner',
    name: 'Spawner',
    registeredAt: '2026-03-14T00:00:00.000Z',
    builderId: 'omar',
    builderName: 'Omar',
    threadSurfaceIds: [],
    metadata: { skills: [{ id: 'spawn', label: 'Spawn', inherited: false }] },
  }

  test('beginStepRunIfSurfaceExists leaves state unchanged for unseen step surfaces', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const result = beginStepRunIfSurfaceExists(started, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step',
      executionIndex: 2,
    })

    expect(result.stepRun).toBeNull()
    expect(result.state).toEqual(started)
  })

  test('beginStepRunIfSurfaceExists appends a replacement run for existing surfaces only', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state
    const withChild = createChildThreadSurfaceRun(started, {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-a',
      childSurfaceId: 'thread-step-a',
      childSurfaceLabel: 'Step A',
      createdAt: '2026-03-09T10:00:05.000Z',
      runId: 'run-step-seed',
      startedAt: '2026-03-09T10:00:05.000Z',
      executionIndex: 2,
    }).state

    const result = beginStepRunIfSurfaceExists(withChild, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step-next',
      executionIndex: 3,
    })

    expect(result.stepRun).toEqual({
      runId: 'run-step-next',
      startedAt: '2026-03-09T10:01:00.000Z',
      executionIndex: 3,
      threadSurfaceId: 'thread-step-a',
    })
    expect(result.state.runs.filter(run => run.threadSurfaceId === 'thread-step-a')).toHaveLength(2)
    expect(result.state.threadSurfaces).toHaveLength(2)
  })

  test('beginStepRunIfSurfaceExists auto-creates child surface for spawn-skilled agents', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const result = beginStepRunIfSurfaceExists(started, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step',
      executionIndex: 2,
      agent: spawnAgent,
    })

    // Should have auto-created the thread surface
    expect(result.stepRun).not.toBeNull()
    expect(result.stepRun?.threadSurfaceId).toBe('thread-step-a')
    expect(result.state.threadSurfaces.map(s => s.id)).toContain('thread-step-a')
    // The new surface should be a child of thread-root
    expect(result.state.threadSurfaces.find(s => s.id === 'thread-root')?.childSurfaceIds).toContain('thread-step-a')
  })

  test('beginStepRunIfSurfaceExists returns null for non-spawn agents when surface missing', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const noSpawnAgent: AgentRegistration = {
      id: 'agt-worker',
      name: 'Worker',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: { skills: [{ id: 'search', label: 'Search', inherited: false }] },
    }

    const result = beginStepRunIfSurfaceExists(started, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step',
      executionIndex: 2,
      agent: noSpawnAgent,
    })

    expect(result.stepRun).toBeNull()
    expect(result.state).toEqual(started)
  })

  test('finalizeStepRunWithRuntimeEvents materializes missing step surfaces for spawn-child events', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const runtimeEvents: RuntimeDelegationEvent[] = [{
      eventType: 'spawn-child',
      createdAt: '2026-03-09T10:01:05.000Z',
      childStepId: 'child-step',
      childLabel: 'Child Step',
      spawnKind: 'orchestrator',
    }]

    const result = finalizeStepRunWithRuntimeEvents(started, {
      step: buildStep(),
      stepRun: null,
      runStatus: 'successful',
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agent: spawnAgent,
    })

    expect(result.stepRun).toEqual({
      runId: 'run-generated',
      startedAt: '2026-03-09T10:01:10.000Z',
      executionIndex: 2,
      threadSurfaceId: 'thread-step-a',
    })
    expect(result.state.threadSurfaces.map(surface => surface.id)).toEqual([
      'thread-root',
      'thread-step-a',
      'thread-child-step',
    ])
    expect(result.state.threadSurfaces.find(surface => surface.id === 'thread-root')?.childSurfaceIds).toEqual(['thread-step-a'])
    expect(result.state.threadSurfaces.find(surface => surface.id === 'thread-step-a')?.childSurfaceIds).toEqual(['thread-child-step'])
    expect(result.state.runEvents).toEqual([
      expect.objectContaining({
        eventType: 'child-agent-spawned',
        runId: 'run-generated',
        threadSurfaceId: 'thread-step-a',
      }),
    ])
    expect(result.state.runs.find(run => run.id === 'run-generated')).toEqual(
      expect.objectContaining({
        threadSurfaceId: 'thread-step-a',
        runStatus: 'successful',
        runSummary: 'step:step-a',
      }),
    )
    // Verify child surface has sequenceRef set
    const childSurface = result.state.threadSurfaces.find(surface => surface.id === 'thread-child-step')
    expect(childSurface?.sequenceRef).toBe('.threados/sequences/thread-child-step/sequence.yaml')
    expect(childSurface?.spawnedByAgentId).toBe('step-a')

    // Verify pendingChildSequences returned for provisioning
    expect(result.pendingChildSequences).toEqual([{
      surfaceId: 'thread-child-step',
      sequenceRef: '.threados/sequences/thread-child-step/sequence.yaml',
      sequenceName: 'Child Step',
      threadType: 'base',
    }])
  })

  test('finalizeStepRunWithRuntimeEvents records merge events in emitted source order', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state
    const withCandidateA = createChildThreadSurfaceRun(started, {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'candidate-a',
      childSurfaceId: 'thread-candidate-a',
      childSurfaceLabel: 'Candidate A',
      createdAt: '2026-03-09T10:00:01.000Z',
      runId: 'run-a',
      startedAt: '2026-03-09T10:00:01.000Z',
      executionIndex: 2,
    }).state
    const withCandidateB = createChildThreadSurfaceRun(withCandidateA, {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'candidate-b',
      childSurfaceId: 'thread-candidate-b',
      childSurfaceLabel: 'Candidate B',
      createdAt: '2026-03-09T10:00:02.000Z',
      runId: 'run-b',
      startedAt: '2026-03-09T10:00:02.000Z',
      executionIndex: 3,
    }).state

    const runtimeEvents: RuntimeDelegationEvent[] = [{
      eventType: 'merge-into',
      createdAt: '2026-03-09T10:02:00.000Z',
      destinationStepId: 'fusion-synth',
      sourceStepIds: ['candidate-a', 'candidate-b'],
      mergeKind: 'block',
      summary: 'merged summary',
    }]

    const result = finalizeStepRunWithRuntimeEvents(withCandidateB, {
      step: buildStep({ id: 'fusion-synth', name: 'Fusion Synth', type: 'f' }),
      stepRun: null,
      runStatus: 'successful',
      endedAt: '2026-03-09T10:02:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-fusion',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
    })

    expect(result.state.mergeEvents).toEqual([
      expect.objectContaining({
        id: 'merge-generated',
        runId: 'run-fusion',
        destinationThreadSurfaceId: 'thread-fusion-synth',
        sourceThreadSurfaceIds: ['thread-candidate-a', 'thread-candidate-b'],
        sourceRunIds: ['run-a', 'run-b'],
        mergeKind: 'block',
        summary: 'merged summary',
      }),
    ])
    expect(result.state.runs.find(run => run.id === 'run-fusion')).toEqual(
      expect.objectContaining({
        threadSurfaceId: 'thread-fusion-synth',
        runStatus: 'successful',
      }),
    )
    expect(result.pendingChildSequences).toEqual([])
  })

  test('finalizeStepRunWithRuntimeEvents rejects spawn-child events from agents without spawn skill', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const agent: AgentRegistration = {
      id: 'agt-no-spawn',
      name: 'No Spawn Agent',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: { skills: [{ id: 'search', label: 'Search', inherited: false }] },
    }

    const runtimeEvents: RuntimeDelegationEvent[] = [{
      eventType: 'spawn-child',
      createdAt: '2026-03-09T10:01:05.000Z',
      childStepId: 'child-step',
      childLabel: 'Child Step',
      spawnKind: 'orchestrator',
    }]

    const result = finalizeStepRunWithRuntimeEvents(started, {
      step: buildStep(),
      stepRun: null,
      runStatus: 'successful',
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agent,
    })

    // Spawn-child events should be filtered out — no child surface created
    expect(result.state.threadSurfaces.map(s => s.id)).not.toContain('thread-child-step')
    expect(result.pendingChildSequences).toEqual([])
    // A spawn-denied event should be recorded
    expect(result.state.runEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'spawn-denied',
        }),
      ]),
    )
  })

  test('finalizeStepRunWithRuntimeEvents keeps blocked runs pending instead of failed', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state
    const withChild = createChildThreadSurfaceRun(started, {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-a',
      childSurfaceId: 'thread-step-a',
      childSurfaceLabel: 'Step A',
      createdAt: '2026-03-09T10:00:05.000Z',
      runId: 'run-step-seed',
      startedAt: '2026-03-09T10:00:05.000Z',
      executionIndex: 2,
    }).state
    const active = beginStepRunIfSurfaceExists(withChild, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step-blocked',
      executionIndex: 3,
    })

    const result = finalizeStepRunWithRuntimeEvents(active.state, {
      step: buildStep(),
      stepRun: active.stepRun,
      runStatus: 'pending',
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents: [],
      nextRunId: () => 'run-unused',
      nextEventId: () => 'event-unused',
      nextMergeId: () => 'merge-unused',
    })

    expect(result.state.runs.find(run => run.id === 'run-step-blocked')).toEqual(
      expect.objectContaining({
        threadSurfaceId: 'thread-step-a',
        runStatus: 'pending',
        endedAt: null,
        runSummary: 'step:step-a:blocked',
      }),
    )
    expect(result.pendingChildSequences).toEqual([])
  })

  test('finalizeStepRunWithRuntimeEvents uses threadType from spawn event', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Sequence',
      createdAt: '2026-03-09T10:00:00.000Z',
      runId: 'run-root',
      startedAt: '2026-03-09T10:00:00.000Z',
      executionIndex: 1,
    }).state

    const runtimeEvents: RuntimeDelegationEvent[] = [{
      eventType: 'spawn-child',
      createdAt: '2026-03-09T10:01:05.000Z',
      childStepId: 'parallel-child',
      childLabel: 'Parallel Child',
      spawnKind: 'fanout',
      threadType: 'parallel',
    }]

    const result = finalizeStepRunWithRuntimeEvents(started, {
      step: buildStep(),
      stepRun: null,
      runStatus: 'successful',
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agent: spawnAgent,
    })

    expect(result.pendingChildSequences).toEqual([{
      surfaceId: 'thread-parallel-child',
      sequenceRef: '.threados/sequences/thread-parallel-child/sequence.yaml',
      sequenceName: 'Parallel Child',
      threadType: 'parallel',
    }])
  })
})
