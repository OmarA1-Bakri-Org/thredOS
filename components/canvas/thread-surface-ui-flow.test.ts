import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import type { SequenceStatus } from '@/app/api/status/route'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import { resolveThreadSurfaceCanvasData } from '@/components/canvas/threadSurfaceScaffold'
import { HierarchyView } from '@/components/hierarchy/HierarchyView'
import { useHierarchyGraph } from '@/components/hierarchy/useHierarchyGraph'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import {
  unwrapThreadMergesResponse,
  unwrapThreadRunsResponse,
  unwrapThreadSurfacesResponse,
} from '@/lib/ui/api'
import { useUIStore } from '@/lib/ui/store'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

type ButtonElement = ReactElement<{
  children?: ReactNode
  onClick?: () => void
  'data-thread-surface-id'?: string
}>

type MultiThreadFixture = {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  laneRunIds: string[]
}

const multiThreadState = JSON.parse(
  readFileSync(new URL('../../test/fixtures/thread-surfaces/multi-thread-state.json', import.meta.url), 'utf8'),
) as MultiThreadFixture

const legacyStatus: SequenceStatus = {
  name: 'Legacy Sequence',
  version: '1.0',
  steps: [],
  gates: [],
  summary: {
    total: 0,
    ready: 0,
    running: 0,
    done: 0,
    failed: 0,
    blocked: 0,
    needsReview: 0,
  },
}

function collectButtons(node: ReactNode, acc: ButtonElement[] = []): ButtonElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    collectButtons(render(element.props), acc)
    return acc
  }

  if (element.type === 'button') {
    acc.push(element as ButtonElement)
  }

  collectButtons(element.props.children, acc)
  return acc
}

describe('thread surface canvas flow', () => {
  test('prefers real thread-surface data over the legacy scaffold and opens lane context from hierarchy clicks', () => {
    useUIStore.setState({
      viewMode: 'hierarchy',
      selectedThreadSurfaceId: null,
      selectedRunId: null,
      laneFocusThreadSurfaceId: null,
      laneBoardState: {
        scrollLeft: 0,
        focusedThreadSurfaceId: null,
        focusedRunId: null,
      },
    })

    const threadSurfaceData = resolveThreadSurfaceCanvasData({
      status: legacyStatus,
      threadSurfaces: unwrapThreadSurfacesResponse({ threadSurfaces: multiThreadState.threadSurfaces }),
      runs: unwrapThreadRunsResponse({ runs: multiThreadState.runs }),
      mergeEvents: unwrapThreadMergesResponse({ mergeEvents: multiThreadState.mergeEvents }),
    })

    expect(threadSurfaceData.source).toBe('api')
    expect(threadSurfaceData.threadSurfaces).toHaveLength(5)
    expect(threadSurfaceData.threadSurfaces[0]?.surfaceLabel).toBe('Master')

    const hierarchyGraph = useHierarchyGraph({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      zoom: 1,
    })

    const view = HierarchyView({
      nodes: hierarchyGraph.nodes.map(node => ({
        id: node.id,
        surfaceLabel: node.surfaceLabel,
        depth: node.depth,
        childCount: node.metadata.childCount,
        runStatus: node.metadata.displayRunStatus,
        runSummary: node.metadata.runSummary,
        clickTarget: {
          threadSurfaceId: node.clickTarget.threadSurfaceId,
          runId: node.clickTarget.runId,
        },
      })),
      selectedThreadSurfaceId: null,
      onOpenLane: useUIStore.getState().openLaneViewForThreadSurface,
    })

    const synthesisButton = collectButtons(view).find(button => button.props['data-thread-surface-id'] === 'thread-synthesis')
    expect(synthesisButton).toBeDefined()

    synthesisButton?.props.onClick?.()

    expect(useUIStore.getState()).toMatchObject({
      viewMode: 'lanes',
      selectedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      laneFocusThreadSurfaceId: 'thread-synthesis',
      laneBoardState: {
        focusedThreadSurfaceId: 'thread-synthesis',
        focusedRunId: 'run-synthesis',
      },
    })

    const laneBoard = createLaneBoardModel({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      mergeEvents: threadSurfaceData.mergeEvents,
      runIds: multiThreadState.laneRunIds,
    })

    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-synthesis')).toMatchObject({
      runId: 'run-synthesis',
      surfaceLabel: 'Synthesis',
    })
    expect(laneBoard.mergeGroups).toEqual([
      {
        mergeEventId: 'merge-block-synthesis',
        runId: 'run-synthesis',
        mergeKind: 'block',
        executionIndex: 20,
        destinationThreadSurfaceId: 'thread-synthesis',
        orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
      },
      {
        mergeEventId: 'merge-single-master',
        runId: 'run-master',
        mergeKind: 'single',
        executionIndex: 40,
        destinationThreadSurfaceId: 'thread-master',
        orderedThreadSurfaceIds: ['thread-master', 'thread-review'],
      },
    ])

    const focusedDetail = resolveThreadSurfaceFocusedDetail({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      mergeEvents: threadSurfaceData.mergeEvents,
      rows: laneBoard.rows,
      mergeGroups: laneBoard.mergeGroups,
      focusedThreadSurfaceId: useUIStore.getState().laneFocusThreadSurfaceId,
      selectedRunId: useUIStore.getState().selectedRunId,
    })

    expect(focusedDetail).toMatchObject({
      threadSurfaceId: 'thread-synthesis',
      runId: 'run-synthesis',
      runSummary: 'Synthesis merged research and outreach into a unified brief.',
      incomingMergeGroups: [
        expect.objectContaining({
          mergeEventId: 'merge-block-synthesis',
          destinationThreadSurfaceId: 'thread-synthesis',
        }),
      ],
    })
  })
})
