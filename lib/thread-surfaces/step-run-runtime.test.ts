import { describe, expect, test } from 'bun:test'
import type { Step } from '@/lib/sequence/schema'
import { emptyThreadSurfaceState, createRootThreadSurfaceRun, createChildThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
import { beginStepRunIfSurfaceExists, finalizeStepRunWithRuntimeEvents } from '@/lib/thread-surfaces/step-run-runtime'
import type { RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'

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
  const frozenRegistration = {
    registration_id: 'registered-spawner', registration_version: 2,
    composition_hash: 'a'.repeat(64), builder_id: 'builder',
    registered_at: '2026-03-14T00:00:00.000Z', supersedes_agent_id: 'registered-v1',
    model: 'codex', role: 'orchestrator',
    prompt_ref: { id: 'orchestration', version: 1 },
    skill_refs: [{ id: 'spawn', version: 1, capabilities: ['spawn'] }], tools: [],
    prompt_content_hash: 'b'.repeat(64), skill_content_hashes: [],
  }

  for (const scenario of ['missing', 'no-spawn', 'spoofed-parent'] as const) {
    test(`denies ${scenario} child requests without provisioning child state`, () => {
      const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
        surfaceId: 'thread-root', surfaceLabel: 'Root', createdAt: '2026-03-14T00:00:00.000Z',
        runId: 'run-root', startedAt: '2026-03-14T00:00:00.000Z',
      }).state
      const registration = scenario === 'missing' ? undefined : {
        ...frozenRegistration, skill_refs: scenario === 'no-spawn' ? [] : frozenRegistration.skill_refs,
        metadata: { skills: [{ id: 'spawn', label: 'Untrusted display grant' }] },
      }
      let next = 0
      const result = finalizeStepRunWithRuntimeEvents(started, {
        step: buildStep(), stepRun: null, success: true, endedAt: '2026-03-14T00:00:00.000Z',
        runtimeEvents: [{ eventType: 'spawn-child', createdAt: '2026-03-14T00:00:00.000Z',
          childStepId: 'child', childLabel: 'Child', spawnKind: 'orchestrator',
          ...(scenario === 'spoofed-parent' ? { parentStepId: 'another-agent-step' } : {}),
        }],
        nextRunId: () => `run-${++next}`, nextEventId: () => `event-${++next}`, nextMergeId: () => `merge-${++next}`,
        ...{ agentRegistration: registration },
      })
      expect(result.pendingChildSequences).toEqual([])
      expect(result.state.threadSurfaces.some(surface => surface.id === 'thread-child')).toBe(false)
      expect(result.state.runEvents).toContainEqual(expect.objectContaining({ eventType: 'spawn-denied' }))
    })
  }

  test('frozen spawn capability records the registered origin without assigning the child', () => {
    const started = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root', surfaceLabel: 'Root', createdAt: '2026-03-14T00:00:00.000Z',
      runId: 'run-root', startedAt: '2026-03-14T00:00:00.000Z',
    }).state
    let next = 0
    const result = finalizeStepRunWithRuntimeEvents(started, {
      step: buildStep(), stepRun: null, success: true, endedAt: '2026-03-14T00:00:00.000Z',
      runtimeEvents: [{ eventType: 'spawn-child', createdAt: '2026-03-14T00:00:00.000Z',
        childStepId: 'child', childLabel: 'Child', spawnKind: 'orchestrator', parentStepId: 'step-a' }],
      nextRunId: () => `run-${++next}`, nextEventId: () => `event-${++next}`, nextMergeId: () => `merge-${++next}`,
      ...{ agentRegistration: frozenRegistration },
    })
    const child = result.state.threadSurfaces.find(surface => surface.id === 'thread-child')
    expect(child?.spawnedByAgentId).toBe('registered-spawner')
    expect(child?.registeredAgentId).toBeUndefined()
    expect(result.state.runs.find(run => run.threadSurfaceId === 'thread-child')?.parentRunId).toBe(result.stepRun?.runId)
  })

  const spawnAgent = frozenRegistration

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
      agentRegistration: spawnAgent,
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

    const noSpawnAgent = { ...frozenRegistration, skill_refs: [] }

    const result = beginStepRunIfSurfaceExists(started, buildStep(), {
      now: '2026-03-09T10:01:00.000Z',
      nextRunId: 'run-step',
      executionIndex: 2,
      agentRegistration: noSpawnAgent,
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
      success: true,
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agentRegistration: spawnAgent,
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
    expect(childSurface?.spawnedByAgentId).toBe('registered-spawner')

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
      success: true,
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

    const agent = { ...frozenRegistration, skill_refs: [] }

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
      success: true,
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agentRegistration: agent,
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
      success: true,
      endedAt: '2026-03-09T10:01:10.000Z',
      runtimeEvents,
      nextRunId: () => 'run-generated',
      nextEventId: () => 'event-generated',
      nextMergeId: () => 'merge-generated',
      agentRegistration: spawnAgent,
    })

    expect(result.pendingChildSequences).toEqual([{
      surfaceId: 'thread-parallel-child',
      sequenceRef: '.threados/sequences/thread-parallel-child/sequence.yaml',
      sequenceName: 'Parallel Child',
      threadType: 'parallel',
    }])
  })
})
