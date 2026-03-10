import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { FocusedLanePlane } from './FocusedLanePlane'
import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import { contentCreatorWorkflow, resolveWorkflowReferenceStep } from '@/lib/workflows'

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  className?: string
  [key: string]: unknown
}>

const detail: ThreadSurfaceFocusedDetail = {
  threadSurfaceId: 'thread-synthesis',
  surfaceLabel: 'Synthesis',
  surfaceDescription: 'Consolidates approved channel drafts into a unified output plane.',
  role: 'Consolidator',
  runId: 'run-synthesis',
  runStatus: 'successful',
  executionIndex: 20,
  runSummary: 'Synthesis merged research and outreach into a unified brief.',
  runNotes: 'Shifted the final lane onto the brief after both upstream threads passed validation.',
  runDiscussion: 'Keep this lane clean and use the right column for supporting workflow context.',
  laneTerminalState: null,
  mergedIntoThreadSurfaceId: null,
  incomingMergeGroups: [
    {
      mergeEventId: 'merge-block-synthesis',
      runId: 'run-synthesis',
      mergeKind: 'block',
      executionIndex: 20,
      destinationThreadSurfaceId: 'thread-synthesis',
      orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
    },
  ],
  outgoingMergeEvents: [],
}

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

describe('FocusedLanePlane', () => {
  test('splits the lane plane into a primary execution surface and a blue context column', () => {
    const workflowStep = resolveWorkflowReferenceStep(contentCreatorWorkflow, {
      threadSurfaceLabel: detail.surfaceLabel,
      threadRole: detail.role,
      runSummary: detail.runSummary,
    })

    const plane = FocusedLanePlane({
      detail,
      workflowStep,
      sequenceView: <div data-testid="lane-sequence-view">Sequence view</div>,
    })

    expect(collectByTestId(plane, 'focused-lane-plane')).toHaveLength(1)
    expect(collectByTestId(plane, 'focused-lane-primary')).toHaveLength(1)
    const contextColumns = collectByTestId(plane, 'focused-lane-context-column')
    expect(contextColumns).toHaveLength(1)
    expect(contextColumns[0]?.props.className).toContain('bg-[#16417C]/18')
    expect(collectByTestId(plane, 'workflow-step-context-panel')).toHaveLength(1)
    expect(collectByTestId(plane, 'workflow-blueprint-panel')).toHaveLength(1)
    expect(collectByTestId(plane, 'lane-sequence-view')).toHaveLength(1)
  })
})
