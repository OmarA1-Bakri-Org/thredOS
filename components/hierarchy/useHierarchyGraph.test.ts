import { describe, expect, test } from 'bun:test'
import type { RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import { useHierarchyGraph } from './useHierarchyGraph'

const threadSurfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    surfaceDescription: 'Top-level orchestrator surface',
    role: 'orchestrator',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-research', 'thread-outreach'],
  },
  {
    id: 'thread-research',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-research',
    depth: 1,
    surfaceLabel: 'Research',
    surfaceDescription: 'Investigates the problem space',
    role: 'specialist',
    createdAt: '2026-03-09T00:01:00.000Z',
    childSurfaceIds: ['thread-review'],
  },
  {
    id: 'thread-outreach',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-outreach',
    depth: 1,
    surfaceLabel: 'Outreach',
    surfaceDescription: 'Handles downstream communication',
    role: 'specialist',
    createdAt: '2026-03-09T00:02:00.000Z',
    childSurfaceIds: [],
  },
  {
    id: 'thread-review',
    parentSurfaceId: 'thread-research',
    parentAgentNodeId: 'spawn-review',
    depth: 2,
    surfaceLabel: 'Review',
    surfaceDescription: 'Checks research quality',
    role: 'qa',
    createdAt: '2026-03-09T00:03:00.000Z',
    childSurfaceIds: [],
  },
]

const runs: RunScope[] = [
  {
    id: 'run-master-success',
    threadSurfaceId: 'thread-master',
    runStatus: 'successful',
    startedAt: '2026-03-09T00:00:00.000Z',
    endedAt: '2026-03-09T00:10:00.000Z',
    executionIndex: 1,
    runSummary: 'Master coordinated the active tree.',
    runNotes: 'Keep the root thread stable.',
    runDiscussion: 'Root surface notes for the AI.',
  },
  {
    id: 'run-research-success',
    threadSurfaceId: 'thread-research',
    runStatus: 'successful',
    startedAt: '2026-03-09T00:01:00.000Z',
    endedAt: '2026-03-09T00:04:00.000Z',
    executionIndex: 2,
    runSummary: 'Research gathered evidence.',
    runNotes: 'Research note.',
    runDiscussion: 'Discuss research branch.',
  },
  {
    id: 'run-research-selected',
    threadSurfaceId: 'thread-research',
    runStatus: 'failed',
    startedAt: '2026-03-09T01:01:00.000Z',
    endedAt: '2026-03-09T01:04:00.000Z',
    executionIndex: 5,
    runSummary: 'Selected failed run for inspection.',
    runNotes: 'Why the branch failed.',
    runDiscussion: 'AI discussion for the selected run.',
  },
  {
    id: 'run-outreach-old',
    threadSurfaceId: 'thread-outreach',
    runStatus: 'failed',
    startedAt: '2026-03-09T00:02:00.000Z',
    endedAt: '2026-03-09T00:03:00.000Z',
    executionIndex: 3,
    runSummary: 'Old outreach attempt.',
  },
  {
    id: 'run-outreach-success',
    threadSurfaceId: 'thread-outreach',
    runStatus: 'successful',
    startedAt: '2026-03-09T02:02:00.000Z',
    endedAt: '2026-03-09T02:05:00.000Z',
    executionIndex: 4,
    runSummary: 'Outreach completed successfully.',
    runNotes: 'Outreach note.',
    runDiscussion: 'AI discussion for outreach.',
  },
]

describe('useHierarchyGraph', () => {
  test('projects thread surfaces into a structural parent-child hierarchy graph', () => {
    const graph = useHierarchyGraph({ threadSurfaces, runs, zoom: 1 })

    expect(graph.nodes.map(node => node.id)).toEqual([
      'thread-master',
      'thread-research',
      'thread-outreach',
      'thread-review',
    ])
    expect(graph.edges).toEqual([
      { source: 'thread-master', target: 'thread-research' },
      { source: 'thread-master', target: 'thread-outreach' },
      { source: 'thread-research', target: 'thread-review' },
    ])
    expect(graph.nodes.find(node => node.id === 'thread-research')).toMatchObject({
      depth: 1,
      parentSurfaceId: 'thread-master',
      childSurfaceIds: ['thread-review'],
    })
  })

  test('derives zoom-band metadata disclosure with surfaced node payloads for macro, meso, and micro views', () => {
    const macroGraph = useHierarchyGraph({ threadSurfaces, runs, zoom: 0.6 })
    const mesoGraph = useHierarchyGraph({ threadSurfaces, runs, zoom: 1 })
    const microGraph = useHierarchyGraph({ threadSurfaces, runs, zoom: 1.8 })

    expect(macroGraph.zoomBand).toBe('macro')
    expect(macroGraph.metadataDisclosure.visibleFields).toEqual(['surfaceLabel', 'runStatus'])
    expect(macroGraph.nodes.find(node => node.id === 'thread-master')).toMatchObject({
      metadata: {
        childCount: 2,
        surfaceDescription: 'Top-level orchestrator surface',
        role: 'orchestrator',
        runSummary: 'Master coordinated the active tree.',
        runNotes: 'Keep the root thread stable.',
        runDiscussion: 'Root surface notes for the AI.',
        displayRunStatus: 'successful',
      },
    })

    expect(mesoGraph.zoomBand).toBe('meso')
    expect(mesoGraph.metadataDisclosure.visibleFields).toEqual([
      'surfaceLabel',
      'runStatus',
      'surfaceDescription',
      'role',
      'runSummary',
      'childCount',
    ])
    expect(mesoGraph.nodes.find(node => node.id === 'thread-research')).toMatchObject({
      metadata: {
        childCount: 1,
        surfaceDescription: 'Investigates the problem space',
        role: 'specialist',
        runSummary: 'Research gathered evidence.',
        runNotes: 'Research note.',
        runDiscussion: 'Discuss research branch.',
        displayRunStatus: 'successful',
      },
    })

    expect(microGraph.zoomBand).toBe('micro')
    expect(microGraph.metadataDisclosure.visibleFields).toEqual([
      'surfaceLabel',
      'runStatus',
      'surfaceDescription',
      'role',
      'runSummary',
      'childCount',
      'runNotes',
      'runDiscussion',
    ])
    expect(microGraph.nodes.find(node => node.id === 'thread-outreach')).toMatchObject({
      metadata: {
        childCount: 0,
        surfaceDescription: 'Handles downstream communication',
        role: 'specialist',
        runSummary: 'Outreach completed successfully.',
        runNotes: 'Outreach note.',
        runDiscussion: 'AI discussion for outreach.',
        displayRunStatus: 'successful',
      },
    })
  })

  test('builds click targets with thread identity plus selected or default run context and surfaced metadata values', () => {
    const graph = useHierarchyGraph({
      threadSurfaces,
      runs,
      zoom: 1.8,
      selectedRunIdBySurfaceId: {
        'thread-research': 'run-research-selected',
      },
    })

    expect(graph.nodes.find(node => node.id === 'thread-research')).toMatchObject({
      runContext: {
        selectedRunId: 'run-research-selected',
        defaultRunId: 'run-research-success',
        displayRunId: 'run-research-selected',
        displayRunStatus: 'failed',
      },
      metadata: {
        childCount: 1,
        surfaceDescription: 'Investigates the problem space',
        role: 'specialist',
        runSummary: 'Selected failed run for inspection.',
        runNotes: 'Why the branch failed.',
        runDiscussion: 'AI discussion for the selected run.',
        displayRunStatus: 'failed',
      },
      clickTarget: {
        threadSurfaceId: 'thread-research',
        runId: 'run-research-selected',
        runSelection: 'selected',
      },
    })

    expect(graph.nodes.find(node => node.id === 'thread-outreach')).toMatchObject({
      runContext: {
        selectedRunId: null,
        defaultRunId: 'run-outreach-success',
        displayRunId: 'run-outreach-success',
        displayRunStatus: 'successful',
      },
      metadata: {
        childCount: 0,
        surfaceDescription: 'Handles downstream communication',
        role: 'specialist',
        runSummary: 'Outreach completed successfully.',
        runNotes: 'Outreach note.',
        runDiscussion: 'AI discussion for outreach.',
        displayRunStatus: 'successful',
      },
      clickTarget: {
        threadSurfaceId: 'thread-outreach',
        runId: 'run-outreach-success',
        runSelection: 'default',
      },
    })

    expect(graph.nodes.find(node => node.id === 'thread-review')).toMatchObject({
      runContext: {
        selectedRunId: null,
        defaultRunId: null,
        displayRunId: null,
        displayRunStatus: null,
      },
      metadata: {
        childCount: 0,
        surfaceDescription: 'Checks research quality',
        role: 'qa',
        runSummary: null,
        runNotes: null,
        runDiscussion: null,
        displayRunStatus: null,
      },
      clickTarget: {
        threadSurfaceId: 'thread-review',
        runId: null,
        runSelection: 'none',
      },
    })
  })
})
