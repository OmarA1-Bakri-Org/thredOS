import { describe, expect, test } from 'bun:test'
import type { RunScope, ThreadSurface } from './types'
import { resolveSurfaceAnnotations } from './annotations'

const surface: ThreadSurface = {
  id: 'thread-research',
  parentSurfaceId: 'thread-master',
  parentAgentNodeId: 'spawn-research',
  depth: 1,
  surfaceLabel: 'Research',
  surfaceDescription: 'Investigates the problem space',
  role: 'specialist',
  createdAt: '2026-03-09T00:01:00.000Z',
  childSurfaceIds: ['thread-review'],
}

const runs: RunScope[] = [
  {
    id: 'run-research-success',
    threadSurfaceId: 'thread-research',
    runStatus: 'successful',
    startedAt: '2026-03-09T00:01:00.000Z',
    endedAt: '2026-03-09T00:04:00.000Z',
    runSummary: 'Research gathered evidence.',
    runNotes: 'Stable evidence set compiled.',
    runDiscussion: 'AI discussion for the successful run.',
  },
  {
    id: 'run-research-failed',
    threadSurfaceId: 'thread-research',
    runStatus: 'failed',
    startedAt: '2026-03-09T01:01:00.000Z',
    endedAt: '2026-03-09T01:04:00.000Z',
    runSummary: 'Research failed after a bad branch.',
    runNotes: 'Failure notes for follow-up.',
    runDiscussion: 'AI discussion for the failed run.',
  },
]

describe('resolveSurfaceAnnotations', () => {
  test('keeps surface labels and descriptions stable across run changes', () => {
    const selectedFailed = resolveSurfaceAnnotations({
      surface,
      runs,
      selectedRunId: 'run-research-failed',
    })

    const selectedDefault = resolveSurfaceAnnotations({
      surface,
      runs,
    })

    expect(selectedFailed.surface).toEqual({
      surfaceId: 'thread-research',
      surfaceLabel: 'Research',
      surfaceDescription: 'Investigates the problem space',
      role: 'specialist',
    })
    expect(selectedDefault.surface).toEqual(selectedFailed.surface)
  })

  test('attaches notes and discussion to the selected run when provided', () => {
    const annotations = resolveSurfaceAnnotations({
      surface,
      runs,
      selectedRunId: 'run-research-failed',
    })

    expect(annotations.runContext).toEqual({
      selectedRunId: 'run-research-failed',
      defaultRunId: 'run-research-success',
      displayRunId: 'run-research-failed',
      runSelection: 'selected',
    })
    expect(annotations.annotations).toEqual({
      runSummary: 'Research failed after a bad branch.',
      runNotes: 'Failure notes for follow-up.',
      runDiscussion: 'AI discussion for the failed run.',
    })
  })

  test('falls back to the default run and changes visible notes when run context changes', () => {
    const defaultAnnotations = resolveSurfaceAnnotations({
      surface,
      runs,
    })
    const selectedAnnotations = resolveSurfaceAnnotations({
      surface,
      runs,
      selectedRunId: 'run-research-failed',
    })

    expect(defaultAnnotations.runContext).toEqual({
      selectedRunId: null,
      defaultRunId: 'run-research-success',
      displayRunId: 'run-research-success',
      runSelection: 'default',
    })
    expect(defaultAnnotations.annotations).toEqual({
      runSummary: 'Research gathered evidence.',
      runNotes: 'Stable evidence set compiled.',
      runDiscussion: 'AI discussion for the successful run.',
    })

    expect(selectedAnnotations.annotations).not.toEqual(defaultAnnotations.annotations)
  })

  test('returns empty run-scoped annotations when the surface has no runs', () => {
    const annotations = resolveSurfaceAnnotations({
      surface: {
        ...surface,
        id: 'thread-review',
        surfaceLabel: 'Review',
        surfaceDescription: 'Checks research quality',
        role: 'qa',
        childSurfaceIds: [],
      },
      runs,
    })

    expect(annotations.runContext).toEqual({
      selectedRunId: null,
      defaultRunId: null,
      displayRunId: null,
      runSelection: 'none',
    })
    expect(annotations.annotations).toEqual({
      runSummary: null,
      runNotes: null,
      runDiscussion: null,
    })
  })
})
