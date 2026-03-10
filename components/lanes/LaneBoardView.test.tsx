import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { LaneBoardView } from './LaneBoardView'

type ElementWithChildren = ReactElement<{ children?: ReactNode; [key: string]: unknown }>

function collectByDataTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByDataTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByDataTestId(element.props.children, target, acc)
  return acc
}

describe('LaneBoardView', () => {
  test('renders workflow phase and execution metadata for focused rows', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-synthesis',
          surfaceLabel: 'Synthesis',
          runId: 'run-synthesis',
          executionIndex: 20,
        },
      ],
      focusedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
      workflowByThreadSurfaceId: {
        'thread-synthesis': {
          stepId: 'post_publish_analytics',
          stepName: 'Post-Publish Analytics',
          phaseLabel: 'Feedback',
          executionLabel: 'sub agent',
          hasCondition: true,
        },
      },
    })

    const workflowBadges = collectByDataTestId(view, 'lane-workflow-badge').map(element => element.props.children)
    expect(workflowBadges).toContain('Feedback')
    expect(workflowBadges).toContain('sub agent')

    const workflowStepLabels = collectByDataTestId(view, 'lane-workflow-step-name').map(element => element.props.children)
    expect(workflowStepLabels).toContain('Post-Publish Analytics')

    const conditionFlags = collectByDataTestId(view, 'lane-workflow-condition-flag').map(element => element.props.children)
    expect(conditionFlags).toContain('conditional')
  })
})
