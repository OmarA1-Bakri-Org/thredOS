import { describe, expect, test } from 'bun:test'
import type { ThreadSurfaceState } from './repository'
import type { RunScope, ThreadSurface } from './types'
import { createChildThreadSurfaceRun } from './mutations'
import { deriveStepThreadSurfaceId, resolveStepRuntimeState } from './step-runtime'

const timestamp = '2026-03-09T10:00:00.000Z'

interface RuntimeStep {
  id: string
  name: string
  orchestrator?: string
}

function buildRootState(): ThreadSurfaceState {
  const rootSurface: ThreadSurface = {
    id: 'thread-root',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master thread',
    createdAt: timestamp,
    childSurfaceIds: [],
  }

  const rootRun: RunScope = {
    id: 'run-root-001',
    threadSurfaceId: 'thread-root',
    runStatus: 'successful',
    startedAt: timestamp,
    endedAt: '2026-03-09T10:05:00.000Z',
    executionIndex: 1,
  }

  return {
    version: 1,
    threadSurfaces: [rootSurface],
    runs: [rootRun],
    mergeEvents: [],
  }
}

describe('step runtime mapping', () => {
  test('falls back to the root surface when a step has no orchestrator parent', () => {
    const result = resolveStepRuntimeState({
      state: buildRootState(),
      step: {
        id: 'research',
        name: 'Research thread',
      },
      runId: 'run-research-001',
      startedAt: '2026-03-09T10:06:00.000Z',
      executionIndex: 2,
    })

    expect(result.threadSurfaceId).toBe('thread-step-research')
    expect(result.parentSurfaceId).toBe('thread-root')
    expect(result.createdSurface).toBe(true)
    expect(result.surface).toMatchObject({
      id: 'thread-step-research',
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'research',
      depth: 1,
    })
    expect(result.run).toMatchObject({
      id: 'run-research-001',
      threadSurfaceId: 'thread-step-research',
      executionIndex: 2,
    })
  })

  test('nests under the orchestrator step surface when orchestrator is provided', () => {
    const withOrchestrator = createChildThreadSurfaceRun(buildRootState(), {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'research-orchestrator',
      childSurfaceId: deriveStepThreadSurfaceId('research-orchestrator'),
      childSurfaceLabel: 'Research orchestrator',
      createdAt: timestamp,
      runId: 'run-research-orchestrator-001',
      startedAt: timestamp,
      executionIndex: 2,
    }).state

    const result = resolveStepRuntimeState({
      state: withOrchestrator,
      step: {
        id: 'review',
        name: 'Review thread',
        orchestrator: 'research-orchestrator',
      },
      runId: 'run-review-001',
      startedAt: '2026-03-09T10:07:00.000Z',
      executionIndex: 3,
    })

    expect(result.parentSurfaceId).toBe('thread-step-research-orchestrator')
    expect(result.surface).toMatchObject({
      id: 'thread-step-review',
      parentSurfaceId: 'thread-step-research-orchestrator',
      depth: 2,
    })
  })

  test('creates the first child run when the child surface does not exist yet', () => {
    const result = resolveStepRuntimeState({
      state: buildRootState(),
      step: {
        id: 'synthesis',
        name: 'Synthesis thread',
      },
      runId: 'run-synthesis-001',
      startedAt: '2026-03-09T10:08:00.000Z',
      executionIndex: 4,
    })

    expect(result.createdSurface).toBe(true)
    expect(result.replacedRun).toBeNull()
    expect(result.state.threadSurfaces.map(surface => surface.id)).toContain('thread-step-synthesis')
    expect(result.state.runs.find(run => run.id === 'run-synthesis-001')).toMatchObject({
      threadSurfaceId: 'thread-step-synthesis',
      runStatus: 'running',
      endedAt: null,
    })
  })

  test('creates a replacement run when the child surface already exists', () => {
    const initial = resolveStepRuntimeState({
      state: buildRootState(),
      step: {
        id: 'research',
        name: 'Research thread',
      },
      runId: 'run-research-001',
      startedAt: '2026-03-09T10:06:00.000Z',
      executionIndex: 2,
    })

    const replacement = resolveStepRuntimeState({
      state: initial.state,
      step: {
        id: 'research',
        name: 'Research thread',
      },
      runId: 'run-research-002',
      startedAt: '2026-03-09T11:00:00.000Z',
      executionIndex: 5,
    })

    expect(replacement.createdSurface).toBe(false)
    expect(replacement.replacedRun).toMatchObject({
      id: 'run-research-001',
      threadSurfaceId: 'thread-step-research',
      runStatus: 'running',
    })
    expect(replacement.run).toMatchObject({
      id: 'run-research-002',
      threadSurfaceId: 'thread-step-research',
      executionIndex: 5,
    })
    expect(replacement.state.threadSurfaces.filter(surface => surface.id === 'thread-step-research')).toHaveLength(1)
    expect(replacement.state.runs.map(run => run.id)).toEqual(['run-root-001', 'run-research-001', 'run-research-002'])
  })
})
