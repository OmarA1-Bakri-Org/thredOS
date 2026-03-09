import { describe, expect, test } from 'bun:test'
import type { Step } from '@/lib/sequence/schema'
import type { ThreadSurface } from './types'
import { deriveMergeEventForSuccessfulStep } from './merge-runtime'

const createdAt = '2026-03-09T12:00:00.000Z'

const threadSurfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    createdAt,
    childSurfaceIds: ['thread-research', 'thread-synth'],
  },
  {
    id: 'thread-research',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'research-step',
    depth: 1,
    surfaceLabel: 'Research',
    createdAt,
    childSurfaceIds: [],
  },
  {
    id: 'thread-review',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'review-step',
    depth: 1,
    surfaceLabel: 'Review',
    createdAt,
    childSurfaceIds: [],
  },
  {
    id: 'thread-synth',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'synth-step',
    depth: 1,
    surfaceLabel: 'Synthesis',
    createdAt,
    childSurfaceIds: [],
  },
]

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'base-step',
    name: 'Base step',
    type: 'base',
    model: 'claude-code',
    prompt_file: '.threados/prompts/base-step.md',
    depends_on: [],
    status: 'READY',
    ...overrides,
  }
}

describe('deriveMergeEventForSuccessfulStep', () => {
  test('returns null for successful steps that do not produce merges', () => {
    const step = makeStep({ id: 'research-step', depends_on: ['other-step'] })

    const result = deriveMergeEventForSuccessfulStep({
      step,
      threadSurfaces,
      stepThreadSurfaceIds: {
        'research-step': 'thread-research',
        'other-step': 'thread-review',
      },
      runId: 'run-research-001',
      mergeId: 'merge-001',
      executionIndex: 8,
      createdAt,
    })

    expect(result).toBeNull()
  })

  test('derives a single-source merge for a synth step with one dependency', () => {
    const step = makeStep({
      id: 'synth-step',
      type: 'f',
      fusion_synth: true,
      depends_on: ['research-step'],
    })

    const result = deriveMergeEventForSuccessfulStep({
      step,
      threadSurfaces,
      stepThreadSurfaceIds: {
        'research-step': 'thread-research',
        'synth-step': 'thread-synth',
      },
      runId: 'run-synth-001',
      mergeId: 'merge-single',
      executionIndex: 12,
      createdAt,
    })

    expect(result).toEqual({
      id: 'merge-single',
      runId: 'run-synth-001',
      destinationThreadSurfaceId: 'thread-synth',
      sourceThreadSurfaceIds: ['thread-research'],
      mergeKind: 'single',
      executionIndex: 12,
      createdAt,
    })
  })

  test('derives a block merge for a synth step using depends_on ordering', () => {
    const step = makeStep({
      id: 'synth-step',
      type: 'f',
      fusion_synth: true,
      depends_on: ['review-step', 'research-step'],
    })

    const result = deriveMergeEventForSuccessfulStep({
      step,
      threadSurfaces,
      stepThreadSurfaceIds: {
        'research-step': 'thread-research',
        'review-step': 'thread-review',
        'synth-step': 'thread-synth',
      },
      runId: 'run-synth-002',
      mergeId: 'merge-block',
      executionIndex: 15,
      createdAt,
      summary: 'Fuse review with research',
    })

    expect(result).toEqual({
      id: 'merge-block',
      runId: 'run-synth-002',
      destinationThreadSurfaceId: 'thread-synth',
      sourceThreadSurfaceIds: ['thread-review', 'thread-research'],
      mergeKind: 'block',
      executionIndex: 15,
      createdAt,
      summary: 'Fuse review with research',
    })
  })

  test('throws when a mapped source surface does not exist in current thread-surface state', () => {
    const step = makeStep({
      id: 'synth-step',
      type: 'f',
      fusion_synth: true,
      depends_on: ['missing-step'],
    })

    expect(() =>
      deriveMergeEventForSuccessfulStep({
        step,
        threadSurfaces,
        stepThreadSurfaceIds: {
          'missing-step': 'thread-missing',
          'synth-step': 'thread-synth',
        },
        runId: 'run-synth-003',
        mergeId: 'merge-missing',
        executionIndex: 18,
        createdAt,
      }),
    ).toThrow('Merge source lane must reference an existing thread surface')
  })
})
