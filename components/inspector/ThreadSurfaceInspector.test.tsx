import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import { contentCreatorWorkflow, getWorkflowStepById } from '@/lib/workflows'

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>

function collectByTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    try {
      collectByTestId(render(element.props), target, acc)
    } catch {
      // Skip components that require React's render pipeline (e.g. hooks)
    }
    return acc
  }

  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByTestId(element.props.children, target, acc)
  return acc
}

const detail: ThreadSurfaceFocusedDetail = {
  threadSurfaceId: 'thread-synthesis',
  surfaceLabel: 'Synthesis',
  surfaceDescription: 'Consolidates research and outreach into a single publishable thread.',
  role: 'synthesizer',
  surfaceClass: 'sealed',
  visibility: 'self_only',
  isolationLabel: 'THREADOS_SCOPED',
  revealState: 'sealed',
  allowedReadScopes: ['thread-synthesis'],
  allowedWriteScopes: ['thread-synthesis'],
  runId: 'run-synthesis',
  runStatus: 'successful',
  executionIndex: 20,
  runSummary: 'Synthesis merged research and outreach into a unified brief.',
  runNotes: 'Merge quality stayed high after the second pass.',
  runDiscussion: 'Use this lane to centralize publish decisions.',
  laneTerminalState: null,
  mergedIntoThreadSurfaceId: null,
  incomingMergeGroups: [],
  outgoingMergeEvents: [],
}

const { ThreadSurfaceInspector } = await import('./ThreadSurfaceInspector')

afterEach(() => {
  mock.restore()
})

describe('ThreadSurfaceInspector', () => {
  test('renders thread/run/provenance detail and keeps workflow context in the inspector', () => {
    const panel = ThreadSurfaceInspector({
      detail,
      workflowStep: getWorkflowStepById(contentCreatorWorkflow, 'post_publish_analytics')!,
    })

    expect(collectByTestId(panel, 'thread-surface-inspector')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-summary')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-surface-policy')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-thread-context')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-provenance')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-run-context')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-run-notes')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-run-discussion')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-workflow-context')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-step-context-panel')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-blueprint-panel')).toHaveLength(1)
  })

  test('renders role, runStatus, and executionIndex badges', () => {
    const markup = renderToStaticMarkup(ThreadSurfaceInspector({ detail }))
    expect(markup).toContain('synthesizer')
    expect(markup).toContain('successful')
    expect(markup).toContain('idx 20')
  })

  test('renders surfaceDescription when present', () => {
    const markup = renderToStaticMarkup(ThreadSurfaceInspector({ detail }))
    expect(markup).toContain('Consolidates research and outreach')
  })

  test('renders the surface policy card values', () => {
    const markup = renderToStaticMarkup(ThreadSurfaceInspector({ detail }))
    expect(markup).toContain('Surface policy')
    expect(markup).toContain('sealed')
    expect(markup).toContain('self_only')
    expect(markup).toContain('THREADOS_SCOPED')
    expect(markup).toContain('thread-synthesis')
  })

  test('renders laneTerminalState when present', () => {
    const markup = renderToStaticMarkup(ThreadSurfaceInspector({
      detail: { ...detail, laneTerminalState: 'completed' },
    }))
    expect(markup).toContain('Terminal')
    expect(markup).toContain('completed')
  })

  test('renders mergedIntoThreadSurfaceId when present', () => {
    const markup = renderToStaticMarkup(ThreadSurfaceInspector({
      detail: { ...detail, mergedIntoThreadSurfaceId: 'thread-master' },
    }))
    expect(markup).toContain('Merged into')
    expect(markup).toContain('thread-master')
  })

  test('renders incoming merge groups in merge topology', () => {
    const panel = ThreadSurfaceInspector({
      detail: {
        ...detail,
        incomingMergeGroups: [{
          mergeEventId: 'merge-1',
          runId: 'run-1',
          mergeKind: 'block' as const,
          executionIndex: 10,
          destinationThreadSurfaceId: 'thread-synthesis',
          orderedThreadSurfaceIds: ['thread-research', 'thread-synthesis'],
        }],
      },
    })
    expect(collectByTestId(panel, 'thread-surface-merge-detail')).toHaveLength(1)
    const markup = renderToStaticMarkup(panel)
    expect(markup).toContain('block at idx 10')
    expect(markup).toContain('thread-research')
  })

  test('renders outgoing merge events in merge topology', () => {
    const panel = ThreadSurfaceInspector({
      detail: {
        ...detail,
        outgoingMergeEvents: [{
          id: 'merge-out-1',
          runId: 'run-1',
          mergeKind: 'single' as const,
          executionIndex: 30,
          destinationThreadSurfaceId: 'thread-master',
          sourceThreadSurfaceIds: ['thread-synthesis'],
          sourceRunIds: ['run-synthesis'],
          createdAt: '2026-03-09T12:00:00Z',
          summary: 'Final merge',
        }],
      },
    })
    expect(collectByTestId(panel, 'thread-surface-merge-detail')).toHaveLength(1)
    const markup = renderToStaticMarkup(panel)
    expect(markup).toContain('thread-master')
    expect(markup).toContain('Final merge')
  })

  test('renders thread flow plane when hierarchyNodes and onSelectNode provided', () => {
    const nodes = [{
      id: 'thread-root',
      surfaceLabel: 'Root',
      depth: 0,
      childCount: 1,
      runStatus: 'idle',
      runSummary: '',
      clickTarget: { threadSurfaceId: 'thread-root', runId: null },
    }]
    const panel = ThreadSurfaceInspector({
      detail,
      hierarchyNodes: nodes,
      hierarchyEdges: [],
      onSelectNode: () => {},
    })
    expect(collectByTestId(panel, 'thread-surface-flow-plane')).toHaveLength(1)
  })

  test('omits flow plane when no onSelectNode provided', () => {
    const nodes = [{
      id: 'thread-root',
      surfaceLabel: 'Root',
      depth: 0,
      childCount: 1,
      runStatus: 'idle',
      runSummary: '',
      clickTarget: { threadSurfaceId: 'thread-root', runId: null },
    }]
    const panel = ThreadSurfaceInspector({
      detail,
      hierarchyNodes: nodes,
    })
    expect(collectByTestId(panel, 'thread-surface-flow-plane')).toHaveLength(0)
  })

  test('omits runDiscussion section when not present', () => {
    const panel = ThreadSurfaceInspector({
      detail: { ...detail, runDiscussion: null },
    })
    expect(collectByTestId(panel, 'thread-surface-run-discussion')).toHaveLength(0)
  })

  test('omits workflow step context when no workflowStep', () => {
    const panel = ThreadSurfaceInspector({ detail })
    expect(collectByTestId(panel, 'workflow-step-context-panel')).toHaveLength(0)
  })
})
