import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { ThreadSurfaceInspector } from './ThreadSurfaceInspector'
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
    collectByTestId(render(element.props), target, acc)
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

describe('ThreadSurfaceInspector', () => {
  test('renders thread/run/provenance detail before a specific step is selected', () => {
    const panel = ThreadSurfaceInspector({
      detail,
      workflowStep: getWorkflowStepById(contentCreatorWorkflow, 'post_publish_analytics')!,
    })

    expect(collectByTestId(panel, 'thread-surface-inspector')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-summary')).toHaveLength(1)
    expect(collectByTestId(panel, 'thread-surface-provenance')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-step-context-panel')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-blueprint-panel')).toHaveLength(1)
  })
})
